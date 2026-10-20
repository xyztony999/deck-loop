import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { DeleteSign } from '../common/enums';
import { BizException } from '../common/exceptions';
import {
  DECK_VERSION_MODEL,
  type DeckVersion,
  type DeckVersionDocument,
} from './schemas/dl_deck_version.schema';
import { VERSION_BRANCH_EXISTS } from './version.errors';

/** VERSION 聚合同步扫描行（lean 投影，_id 不出仓储） */
export interface DeckVersionSyncRow {
  version_id: string;
  deck_id?: string;
  version_seq?: number;
  branch_name?: string;
  source_type?: string;
  created_time?: Date;
}

/**
 * 版本聚合根仓储（dl_deck_version，v1 DeckVersionMapper + VersionQueryMapper 对齐）。
 *
 * **不可变红线（INV-11，api-version §3.2/§5.3）**：本仓储**只有 insert 写路径**，
 * 不提供任何 update/delete/软删方法；「禁止任何 update content 的接口存在」由
 * 类型层落实（无方法可调）。
 *
 * 查询安全（NR-02/NR-05）：
 * - 全部 filter/sort/projection 键为代码级白名单（deck_id/version_id/user_id/
 *   created_time 等固定字段），请求体键名永不直接成为查询键；userId 隔离字段服务端注入
 * - findTaskStatuses 为跨 collection 只读投影（dl_generation_task，树节点
 *   taskStatusOfSource 回填；v1 VersionQueryMapper#selectTaskStatuses 语义，
 *   deck 域 DeckStatsRepository 同先例）：taskIds 来自本域文档（服务端数据），
 *   管道/查询服务端静态构造
 * - seq 分配（事务内 MAX+1）与 branch 冲突预检/锁内复查共用 findMaxVersionSeq/
 *   findBranchNames，session 可选传入加入外层事务（快照读口径）
 */
@Injectable()
export class VersionRepository {
  /** dl_generation_task（generation/adjustment 域，只读投影消费） */
  private static readonly COL_TASK = 'dl_generation_task';

  constructor(
    @InjectModel(DECK_VERSION_MODEL) private readonly model: Model<DeckVersionDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /* ------------------------------------------------------------------ */
  /* 写路径（唯一：insert，INV-11）                                       */
  /* ------------------------------------------------------------------ */

  /**
   * 插入版本（唯一写路径；雪花 id/seq/审计由调用方组装）。
   * uk_deck_branch{deck_id,branch_name,version_seq} 复合唯一索引兜底并发取号
   * （v1「uk_deck_branch 兜底异常插入」对齐）：E11000 映射为分支冲突业务码。
   */
  async insert(doc: DeckVersion, session?: ClientSession): Promise<DeckVersionDocument> {
    try {
      const [created] = await this.model.create([doc], { session });
      return created;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BizException(
          VERSION_BRANCH_EXISTS,
          '并发写入冲突（分支/序号唯一键），请重试',
        );
      }
      throw error;
    }
  }

  /* ------------------------------------------------------------------ */
  /* seq 分配 / branch 守卫（v1 VersionQueryMapper 对齐）                 */
  /* ------------------------------------------------------------------ */

  /**
   * seq 分配输入：deck 维度当前最大 version_seq（空谱系返回 null → 从 1 起）。
   * v1 SELECT MAX FOR UPDATE 锁 deck_id 索引范围；Mongo 事务快照读 + 同事务插入
   * 收窄并发窗口 + uk_deck_branch 唯一索引兜底（deck_code 取号同口径）。
   */
  findMaxVersionSeq(deckId: string, session?: ClientSession): Promise<number | null> {
    return this.model
      .findOne({ deck_id: deckId }, { version_seq: 1 })
      .sort({ version_seq: -1 })
      .session(session ?? null)
      .then((row) => (row == null ? null : row.version_seq));
  }

  /** deck 下已存在分支名清单（fork 冲突预检 + 事务内锁内复查，INV-12） */
  async findBranchNames(deckId: string, session?: ClientSession): Promise<string[]> {
    const rows = await this.model
      .find({ deck_id: deckId }, { branch_name: 1 })
      .session(session ?? null)
      .lean<{ branch_name?: string }[]>()
      .exec();
    return [...new Set(rows.map((row) => String(row.branch_name ?? '')))].filter(
      (name) => name.length > 0,
    );
  }

  /* ------------------------------------------------------------------ */
  /* 读路径（tree/detail/compare/scanner）                                */
  /* ------------------------------------------------------------------ */

  /** deck 全量版本（树查询=deck_id 全量取回内存组树，api-version §4.5；version_seq 升序） */
  findByDeckId(deckId: string, session?: ClientSession): Promise<DeckVersionDocument[]> {
    return this.model
      .find({ deck_id: deckId })
      .sort({ version_seq: 1 })
      .session(session ?? null)
      .exec();
  }

  /** 业务主键点查（detail 级联/compare 双版本取回/INV-13 父版本校验） */
  findById(versionId: string, session?: ClientSession): Promise<DeckVersionDocument | null> {
    return this.model.findOne({ version_id: versionId }).session(session ?? null).exec();
  }

  /** 来源任务状态映射（树节点 taskStatusOfSource 回填；只读投影他域 collection） */
  async findTaskStatuses(taskIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (taskIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(VersionRepository.COL_TASK)
      .find({ delete_sign: DeleteSign.NOT_DELETED, task_id: { $in: taskIds } })
      .project({ task_id: 1, task_status: 1 })
      .toArray();
    for (const row of rows) {
      result.set(String(row.task_id), String(row.task_status));
    }
    return result;
  }

  /** deck 版本总数（countByDeck versionCount；insert-only 无 delete_sign 直接全计） */
  countByDeck(deckId: string): Promise<number> {
    return this.model.countDocuments({ deck_id: deckId }).exec();
  }

  /** deck 指定来源类型的版本数（countByDeck adjustCount 口径：整稿/定向调整留档数） */
  countByDeckAndSourceTypes(deckId: string, sourceTypes: string[]): Promise<number> {
    return this.model
      .countDocuments({ deck_id: deckId, source_type: { $in: sourceTypes } })
      .exec();
  }

  /**
   * VERSION 聚合同步扫描：user_id（服务端注入）+ created_time 严格 $gt cursor，
   * (created_time, version_id) 升序稳定排序（06 §3.6 复合游标；不可变聚合无
   * updated_time，插入即变更——created_time 即变更时间，v1 DeckVersionSyncScanner 同口径）。
   * cursor=0 时不过滤时间（全量起始）。
   */
  scanCreatedAfter(
    userId: string,
    cursorMs: number,
    limit: number,
    tiebreak?: { includeCursorRow: boolean; afterId?: string } | null,
  ): Promise<DeckVersionSyncRow[]> {
    const filter: FilterQuery<DeckVersionDocument> =
      cursorMs > 0
        ? { user_id: userId, ...cursorTimeFilter('created_time', cursorMs, 'version_id', tiebreak) }
        : { user_id: userId };
    return this.model
      .find(filter, {
        _id: 0,
        version_id: 1,
        deck_id: 1,
        version_seq: 1,
        branch_name: 1,
        source_type: 1,
        created_time: 1,
      })
      .sort({ created_time: 1, version_id: 1 })
      .limit(limit)
      .lean<DeckVersionSyncRow[]>()
      .exec();
  }
}

/** E11000 重复键判定（鸭子类型判别，避免直接依赖 mongodb 包；asset 域同款） */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * 复合游标时间过滤（F07）：tiebreak=null → 严格 $gt；含边界行且有 afterId →
 * $or [>$ms, =ms 且业务 id>afterId]；含边界行无 afterId → $gte。
 * （platform/generation-task-core.repository 同款；version 聚合变体 created_time）
 */
function cursorTimeFilter(
  timeField: string,
  cursorMs: number,
  idField: string,
  tiebreak: { includeCursorRow: boolean; afterId?: string } | null | undefined,
): Record<string, unknown> {
  const at = new Date(cursorMs);
  if (tiebreak != null && tiebreak.includeCursorRow) {
    if (tiebreak.afterId !== undefined) {
      return {
        $or: [
          { [timeField]: { $gt: at } },
          { [timeField]: at, [idField]: { $gt: tiebreak.afterId } },
        ],
      };
    }
    return { [timeField]: { $gte: at } };
  }
  return { [timeField]: { $gt: at } };
}
