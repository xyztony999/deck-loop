import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { DeleteSign, ExportStatus } from '../common/enums';
import {
  EXPORT_TASK_MODEL,
  type ExportTask,
  type ExportTaskDocument,
} from './schemas/dl_export_task.schema';

/**
 * deliver 域列表查询白名单输入（NR-02：AO 字段→查询字段的显式映射表专用类型；
 * 请求体键名不得成为 filter/sort/projection 键——由 repository 内固定映射，
 * Service 只传值；userId 隔离字段服务端注入 NR-05）。
 */
export interface ExportListQueryInput {
  userId: string;
  /** 归属创作物精确匹配（→deck_id） */
  deckId?: string | null;
  /** 导出格式精确匹配（→export_format，ExportFormat code） */
  exportFormat?: string | null;
  /** 导出状态精确匹配（→export_status，ExportStatus code） */
  exportStatus?: string | null;
  /** 创建时间起（服务端已解析为 Date，→created_time $gte） */
  createdTimeStart?: Date | null;
  /** 创建时间止（服务端已解析为 Date，→created_time $lte） */
  createdTimeEnd?: Date | null;
  pageNum: number;
  pageSize: number;
}

/** 状态机条件更新参数（filter 固定携带 export_status 期望前置集合，幂等键=exportId+前置状态） */
export interface ExportTransitionInput {
  exportId: string;
  /** 期望前置状态集合（状态机守卫条件化：filter 含 export_status $in 期望值） */
  fromStatuses: string[];
  /** 目标状态（export_status $set 值） */
  toStatus: string;
  /** 额外 $set 业务字段（file_key/file_size/error_msg 等终态字段，白名单由调用方构造） */
  setFields?: Record<string, unknown>;
  /** 操作人（审计 updated_by/updated_name） */
  operatorId: string;
}

/** EXPORT 聚合同步扫描行（lean 投影，_id 不出仓储） */
export interface ExportTaskSyncRow {
  export_id: string;
  deck_id?: string;
  version_id?: string;
  export_format?: string;
  export_status?: string;
  updated_time?: Date;
}

/** dl_deck 只读冗余行（列表 deckName / 下载附件名 deck_code；v1 DeckRefRow 对齐） */
export interface DeckRefRow {
  deckId: string;
  deckCode: string | null;
  deckName: string | null;
}

/** dl_deck_version 只读冗余行（versionSeq 冗余展示 / 附件名 seq / INV-14 防御校验） */
export interface VersionRefRow {
  versionId: string;
  versionSeq: number | null;
  deckId: string | null;
}

/**
 * 导出任务聚合根仓储（dl_export_task，v1 ExportTaskMapper + ExportQueryMapper 对齐）。
 *
 * - 提交（insert）/ 终态幂等更新（条件 updateOne，前置状态守卫）/ 分页（find）
 *   ——api-delivery §4.5 仓储契约
 * - EX 取号：当日前缀下 MAX+1，**事务内**（session 透传，与插入同事务收窄并发窗口，
 *   v1 SELECT MAX FOR UPDATE 的 Mongo 快照读口径，deck 域同模式）
 * - 跨聚合只读冗余（deckName/deck_code/version_seq）：直查 dl_deck / dl_deck_version
 *   只读投影（deck 域 DeckStatsRepository 同先例，ADR-006 单库；不复制他域 schema、
 *   不引入他域 Service 依赖）；v1 selectDeckRows 不带 delete_sign 过滤（软删 deck
 *   的历史导出行仍能回显名称），此处保持同口径
 */
@Injectable()
export class ExportTaskRepository {
  /** dl_deck（deck 域，只读投影消费） */
  private static readonly COL_DECK = 'dl_deck';
  /** dl_deck_version（version 域，只读投影消费） */
  private static readonly COL_VERSION = 'dl_deck_version';

  constructor(
    @InjectModel(EXPORT_TASK_MODEL) private readonly model: Model<ExportTaskDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /* ------------------------------------------------------------------ */
  /* 写路径                                                              */
  /* ------------------------------------------------------------------ */

  /** 插入（提交；雪花 id/export_code/审计字段由调用方组装） */
  async insert(task: ExportTask, session?: ClientSession): Promise<ExportTaskDocument> {
    const [created] = await this.model.create([task], { session });
    return created;
  }

  /**
   * 状态机条件终态更新（幂等键=exportId+前置状态）：
   * filter = export_id + delete_sign=0 + export_status $in 期望前置；
   * update = $set（业务字段 + export_status/updated_by/updated_name/updated_time）
   * + $inc data_version。
   *
   * @returns 更新后的行（findOneAndUpdate new:true，事件载荷直接可用）；
   *          null=0 行（已取消/已终态/重复投递），由调用方按幂等空转解释
   */
  async conditionalTransition(
    input: ExportTransitionInput,
  ): Promise<ExportTaskDocument | null> {
    const filter: FilterQuery<ExportTaskDocument> = {
      export_id: input.exportId,
      delete_sign: DeleteSign.NOT_DELETED,
      export_status: { $in: input.fromStatuses },
    };
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        filter,
        {
          $set: {
            ...(input.setFields ?? {}),
            export_status: input.toStatus,
            updated_by: input.operatorId,
            updated_name: input.operatorId,
            updated_time: now,
          },
          $inc: { data_version: 1 },
        },
        { new: true },
      )
      .exec();
  }

  /**
   * 规则编码取号：当日前缀下最大 export_code（v1 selectMaxExportCodeForUpdate 对齐；
   * Mongo 事务快照读 + 同事务插入收窄并发窗口）。EX+yyMMdd+4 位序列。
   */
  async findMaxExportCode(prefix: string, session?: ClientSession): Promise<string | null> {
    const row = await this.model
      .findOne({ export_code: { $regex: `^${prefix}` } }, { export_code: 1 })
      .sort({ export_code: -1 })
      .session(session ?? null)
      .exec();
    return row != null ? row.export_code : null;
  }

  /* ------------------------------------------------------------------ */
  /* 读路径                                                              */
  /* ------------------------------------------------------------------ */

  /** 业务主键点查（下载凭证校验路径：属主由 HMAC 凭证绑定 task.user_id 验证，仓储不做属主过滤） */
  findById(exportId: string): Promise<ExportTaskDocument | null> {
    return this.model
      .findOne({ export_id: exportId, delete_sign: DeleteSign.NOT_DELETED })
      .exec();
  }

  /** 属主加载（user_id 隔离，cancel/download-ticket 用；不存在/非属主返回 null） */
  findByIdOwned(exportId: string, userId: string): Promise<ExportTaskDocument | null> {
    return this.model
      .findOne({
        export_id: exportId,
        user_id: userId,
        delete_sign: DeleteSign.NOT_DELETED,
      })
      .exec();
  }

  /**
   * 分页查询（白名单映射固定于此：deckId→deck_id、exportFormat→export_format、
   * exportStatus→export_status、timeRange→created_time；userId 服务端注入）。
   * 排序 created_time desc + export_id desc（同步游标同构的稳定排序，分页确定性）。
   */
  async pageList(
    input: ExportListQueryInput,
  ): Promise<{ records: ExportTaskDocument[]; total: number }> {
    const filter = this.buildListFilter(input);
    const pageNum = Number.isInteger(input.pageNum) && input.pageNum >= 1 ? input.pageNum : 1;
    const pageSize =
      Number.isInteger(input.pageSize) && input.pageSize >= 1 ? input.pageSize : 20;
    const [records, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ created_time: -1, export_id: -1 })
        .skip((pageNum - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { records, total };
  }

  /** 构造列表 filter（固定白名单映射，请求体键名不进 filter） */
  private buildListFilter(input: ExportListQueryInput): FilterQuery<ExportTaskDocument> {
    const filter: FilterQuery<ExportTaskDocument> = {
      user_id: input.userId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    if (this.isNotBlank(input.deckId)) {
      filter.deck_id = input.deckId!;
    }
    if (this.isNotBlank(input.exportFormat)) {
      filter.export_format = input.exportFormat!;
    }
    if (this.isNotBlank(input.exportStatus)) {
      filter.export_status = input.exportStatus!;
    }
    if (input.createdTimeStart != null) {
      filter.created_time = { $gte: input.createdTimeStart };
    }
    if (input.createdTimeEnd != null) {
      filter.created_time = { ...(filter.created_time as object), $lte: input.createdTimeEnd };
    }
    return filter;
  }

  /**
   * deck 维度成功导出数（manifest §10 deliver.ExportService#countByDeck 契约的
   * 仓储承载；SUCCEEDED 终态即「导出记录」）。
   */
  countSucceededByDeck(deckId: string, userId: string): Promise<number> {
    return this.model
      .countDocuments({
        deck_id: deckId,
        user_id: userId,
        delete_sign: DeleteSign.NOT_DELETED,
        export_status: ExportStatus.SUCCEEDED,
      })
      .exec();
  }

  /**
   * EXPORT 聚合同步扫描：user_id（服务端注入）+ updated_time 严格 $gt cursor，
   * (updated_time, export_id) 升序稳定排序（06 §3.6 复合游标；提交/状态推进/取消
   * 均触碰 updated_time）。cursor=0 时不过滤时间（全量起始）。
   */
  scanUpdatedAfter(
    userId: string,
    cursorMs: number,
    limit: number,
    tiebreak?: { includeCursorRow: boolean; afterId?: string } | null,
  ): Promise<ExportTaskSyncRow[]> {
    const filter: FilterQuery<ExportTaskDocument> =
      cursorMs > 0
        ? { user_id: userId, ...cursorTimeFilter('updated_time', cursorMs, 'export_id', tiebreak) }
        : { user_id: userId };
    return this.model
      .find(filter, {
        _id: 0,
        export_id: 1,
        deck_id: 1,
        version_id: 1,
        export_format: 1,
        export_status: 1,
        updated_time: 1,
      })
      .sort({ updated_time: 1, export_id: 1 })
      .limit(limit)
      .lean<ExportTaskSyncRow[]>()
      .exec();
  }

  /* ------------------------------------------------------------------ */
  /* 跨聚合只读冗余（v1 ExportQueryMapper#selectDeckRows/selectVersionSeqRows） */
  /* ------------------------------------------------------------------ */

  /** deck 冗余行（deckId/deckCode/deckName；下载附件名用 deck_code；v1 同口径不带删除过滤） */
  async findDeckRefs(deckIds: string[]): Promise<Map<string, DeckRefRow>> {
    const result = new Map<string, DeckRefRow>();
    if (deckIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(ExportTaskRepository.COL_DECK)
      .find({ deck_id: { $in: deckIds } })
      .project({ deck_id: 1, deck_code: 1, deck_name: 1 })
      .toArray();
    for (const row of rows) {
      result.set(String(row.deck_id), {
        deckId: String(row.deck_id),
        deckCode: typeof row.deck_code === 'string' ? row.deck_code : null,
        deckName: typeof row.deck_name === 'string' ? row.deck_name : null,
      });
    }
    return result;
  }

  /** 版本冗余行（versionId → version_seq/deck_id；versionSeq 展示 + INV-14 防御校验） */
  async findVersionRefs(versionIds: string[]): Promise<Map<string, VersionRefRow>> {
    const result = new Map<string, VersionRefRow>();
    if (versionIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(ExportTaskRepository.COL_VERSION)
      .find({ version_id: { $in: versionIds } })
      .project({ version_id: 1, version_seq: 1, deck_id: 1 })
      .toArray();
    for (const row of rows) {
      result.set(String(row.version_id), {
        versionId: String(row.version_id),
        versionSeq: row.version_seq == null ? null : Number(row.version_seq),
        deckId: typeof row.deck_id === 'string' ? row.deck_id : null,
      });
    }
    return result;
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}

/**
 * 复合游标时间过滤（F07）：tiebreak=null → 严格 $gt；含边界行且有 afterId →
 * $or [>$ms, =ms 且业务 id>afterId]；含边界行无 afterId → $gte。
 * （platform/generation-task-core.repository 同款）
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
