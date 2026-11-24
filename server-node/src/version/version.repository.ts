import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { DeleteSign } from '../common/enums';
import { BizException } from '../common/exceptions';
import { cursorCondition, inClause, isDuplicateKeyError, type CursorTiebreak, type TxSession } from '../common/persistence';
import { DeckVersion, type DeckVersionDocument } from './schemas/dl_deck_version.schema';
import { VERSION_BRANCH_EXISTS } from './version.errors';

/** VERSION 聚合同步扫描行（投影，无 _id，NR-08） */
export interface DeckVersionSyncRow {
  version_id: string;
  deck_id?: string;
  version_seq?: number;
  branch_name?: string;
  source_type?: string;
  created_time?: Date;
}

/**
 * 版本聚合根仓储（dl_deck_version，v1 DeckVersionMapper + VersionQueryMapper 对齐；ADR-016 TypeORM）。
 *
 * **不可变红线（INV-11，api-version §3.2/§5.3）**：本仓储**只有 insert 写路径**，
 * 不提供任何 update/delete/软删方法；「禁止任何 update content 的接口存在」由
 * 类型层落实（无方法可调）。
 *
 * 查询安全（NR-02/NR-05）：全部 filter/sort/projection 键为代码级白名单；userId 隔离
 * 字段服务端注入。findTaskStatuses 为跨表只读投影（dl_generation_task）。
 * seq 分配（事务内 MAX+1 FOR UPDATE）与 branch 冲突预检/锁内复查共用 findMaxVersionSeq/
 * findBranchNames，session 可选传入加入外层事务。
 */
@Injectable()
export class VersionRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /* ------------------------------------------------------------------ */
  /* 写路径（唯一：insert，INV-11）                                       */
  /* ------------------------------------------------------------------ */

  /**
   * 插入版本（唯一写路径；雪花 id/seq/审计由调用方组装）。
   * uk_deck_branch{deck_id,branch_name,version_seq} 复合唯一索引兜底并发取号：
   * 23505 映射为分支冲突业务码。
   */
  async insert(doc: DeckVersion, session?: TxSession): Promise<DeckVersionDocument> {
    try {
      await this.manager(session).getRepository(DeckVersion).insert(doc);
      return doc;
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
   * 事务内 FOR UPDATE 锁 deck 维度最大 seq 行 + uk_deck_branch 唯一索引兜底并发取号。
   */
  async findMaxVersionSeq(deckId: string, session?: TxSession): Promise<number | null> {
    const lock = session != null ? ' FOR UPDATE' : '';
    const rows = await this.manager(session).query(
      `SELECT version_seq FROM dl_deck_version WHERE deck_id = $1 ORDER BY version_seq DESC LIMIT 1${lock}`,
      [deckId],
    );
    const row = rows[0];
    return row == null ? null : Number(row.version_seq);
  }

  /** deck 下已存在分支名清单（fork 冲突预检 + 事务内锁内复查，INV-12） */
  async findBranchNames(deckId: string, session?: TxSession): Promise<string[]> {
    const rows = (await this.manager(session).query(
      `SELECT DISTINCT branch_name FROM dl_deck_version WHERE deck_id = $1`,
      [deckId],
    )) as Array<{ branch_name?: string }>;
    return [...new Set(rows.map((row) => String(row.branch_name ?? '')))].filter(
      (name) => name.length > 0,
    );
  }

  /* ------------------------------------------------------------------ */
  /* 读路径（tree/detail/compare/scanner）                                */
  /* ------------------------------------------------------------------ */

  /** deck 全量版本（树查询=deck_id 全量取回内存组树；version_seq 升序） */
  findByDeckId(deckId: string, session?: TxSession): Promise<DeckVersionDocument[]> {
    return this.manager(session).getRepository(DeckVersion).find({
      where: { deck_id: deckId },
      order: { version_seq: 'ASC' },
    });
  }

  /** 业务主键点查（detail 级联/compare 双版本取回/INV-13 父版本校验） */
  findById(versionId: string, session?: TxSession): Promise<DeckVersionDocument | null> {
    return this.manager(session).getRepository(DeckVersion).findOne({ where: { version_id: versionId } });
  }

  /** 来源任务状态映射（树节点 taskStatusOfSource 回填；只读投影他域表） */
  async findTaskStatuses(taskIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (taskIds.length === 0) {
      return result;
    }
    const inc = inClause('task_id', taskIds, 1);
    const rows = await this.dataSource.query(
      `SELECT task_id, task_status FROM dl_generation_task WHERE delete_sign = 0 AND ${inc.sql}`,
      [...inc.params],
    );
    for (const row of rows) {
      result.set(String(row.task_id), String(row.task_status));
    }
    return result;
  }

  /** deck 版本总数（countByDeck versionCount；insert-only 无 delete_sign 直接全计） */
  async countByDeck(deckId: string): Promise<number> {
    return this.dataSource.getRepository(DeckVersion).count({ where: { deck_id: deckId } });
  }

  /** deck 指定来源类型的版本数（countByDeck adjustCount 口径） */
  async countByDeckAndSourceTypes(deckId: string, sourceTypes: string[]): Promise<number> {
    if (sourceTypes.length === 0) {
      return 0;
    }
    const inc = inClause('source_type', sourceTypes, 2);
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_deck_version WHERE deck_id = $1 AND ${inc.sql}`,
      [deckId, ...inc.params],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /**
   * VERSION 聚合同步扫描：user_id + created_time 复合游标（展开 OR 式），
   * (created_time, version_id) 升序稳定排序（06 §3.6；不可变聚合插入即变更）。
   * cursor=0 时不过滤时间（全量起始）。
   */
  async scanCreatedAfter(
    userId: string,
    cursorMs: number,
    limit: number,
    tiebreak?: CursorTiebreak | null,
  ): Promise<DeckVersionSyncRow[]> {
    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (cursorMs > 0) {
      const cur = cursorCondition('created_time', 'version_id', cursorMs, tiebreak, 2);
      conditions.push(cur.sql);
      params.push(...cur.params);
    }
    const limitIndex = params.length + 1;
    params.push(limit);
    return this.dataSource.query(
      `SELECT version_id, deck_id, version_seq, branch_name, source_type, created_time FROM dl_deck_version WHERE ${conditions.join(' AND ')} ORDER BY created_time ASC, version_id ASC LIMIT $${limitIndex}`,
      params,
    );
  }
}