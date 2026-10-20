import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';
import { DeleteSign } from '../common/enums';

/** 计数行（deck_id → cnt，v1 DeckCountRow 对齐） */
export interface DeckCountRow {
  deckId: string;
  cnt: number;
}

/** 版本序号行（versionId → version_seq，v1 DeckVersionSeqRow 对齐） */
export interface DeckVersionSeqRow {
  versionId: string;
  versionSeq: number;
}

/** 最近任务行（v1 DeckLatestTaskRow 对齐，dl_generation_task 只读投影） */
export interface DeckLatestTaskRow {
  taskId: string;
  taskType: string;
  taskStatus: string;
}

/**
 * deck 域跨聚合只读聚合查询（v1 DeckStatsMapper 语义平移，Mongo raw collection 版）。
 *
 * 背景：api-deck 声明 deck 域「无出站服务调用」，但列表/详情需要版本与任务统计、
 * 定稿/归档守卫需要「进行中任务」计数、INV-1/INV-7 需要归属校验（api-deck §4.4/§2.2）。
 * 单服务单库（ADR-006）下以 deck 域内的只读直查实现——**直查他域 collection 的
 * 只读投影**（dl_deck_version / dl_generation_task / dl_export_task / dl_brand_kit /
 * dl_deck 取号），不复制他域 schema、不注册重复 model、不引入他域 Service 依赖
 * （deck 零出站，domain-manifest §1④）。
 *
 * 查询安全（NR-03）：聚合管道服务端静态构造，入参仅作 $match 值；状态/类型字面量
 * 由调用方以共享枚举 code 传参，本类不硬编码业务状态值（DeleteSign 公共枚举除外）。
 * 跨 collection 字段名沿各域契约 §5.3 snake_case 口径（v1 列平移）。
 */
@Injectable()
export class DeckStatsRepository {
  /** dl_deck_version（version 域，insert-only 无 delete_sign） */
  private static readonly COL_VERSION = 'dl_deck_version';
  /** dl_generation_task（generation/adjustment 域四类任务共表） */
  private static readonly COL_TASK = 'dl_generation_task';
  /** dl_export_task（deliver 域） */
  private static readonly COL_EXPORT = 'dl_export_task';
  /** dl_brand_kit（asset 域） */
  private static readonly COL_BRAND_KIT = 'dl_brand_kit';
  /** dl_deck（本域主表，取号 MAX 查询走 raw 以复用事务 session） */
  private static readonly COL_DECK = 'dl_deck';

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** 各 deck 的版本总数（dl_deck_version 只插入、无逻辑删除，直接全计） */
  async countVersions(deckIds: string[]): Promise<Map<string, number>> {
    return this.groupCountByDeck(DeckStatsRepository.COL_VERSION, deckIds, {});
  }

  /** 各 deck 的调整次数（成功完成的整稿/定向调整任务数） */
  async countAdjustTasks(
    deckIds: string[],
    taskTypes: string[],
    succeededStatus: string,
  ): Promise<Map<string, number>> {
    return this.groupCountByDeck(DeckStatsRepository.COL_TASK, deckIds, {
      delete_sign: DeleteSign.NOT_DELETED,
      task_status: succeededStatus,
      task_type: { $in: taskTypes },
    });
  }

  /** 各 deck 的进行中任务数（QUEUED/RUNNING，finalize/archive 守卫与 operList 标志） */
  async countRunningTasks(deckIds: string[], statuses: string[]): Promise<Map<string, number>> {
    return this.groupCountByDeck(DeckStatsRepository.COL_TASK, deckIds, {
      delete_sign: DeleteSign.NOT_DELETED,
      task_status: { $in: statuses },
    });
  }

  /** 单 deck 进行中任务数 */
  countRunningTasksOfDeck(deckId: string, statuses: string[]): Promise<number> {
    return this.connection
      .collection(DeckStatsRepository.COL_TASK)
      .countDocuments({
        delete_sign: DeleteSign.NOT_DELETED,
        deck_id: deckId,
        task_status: { $in: statuses },
      });
  }

  /** 各 deck 的导出记录数（SUCCEEDED 终态即导出记录） */
  async countExports(deckIds: string[], succeededStatus: string): Promise<Map<string, number>> {
    return this.groupCountByDeck(DeckStatsRepository.COL_EXPORT, deckIds, {
      delete_sign: DeleteSign.NOT_DELETED,
      export_status: succeededStatus,
    });
  }

  /** 版本序号映射（versionId → version_seq），列表行 currentVersionSeq 回填用 */
  async findVersionSeqs(versionIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (versionIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(DeckStatsRepository.COL_VERSION)
      .find({ version_id: { $in: versionIds } })
      .project({ version_id: 1, version_seq: 1 })
      .toArray();
    for (const row of rows) {
      result.set(String(row.version_id), Number(row.version_seq));
    }
    return result;
  }

  /** deck 最近一次任务（详情 withLatestTask 开关；created_time desc 取 1） */
  async findLatestTask(deckId: string): Promise<DeckLatestTaskRow | null> {
    const rows = await this.connection
      .collection(DeckStatsRepository.COL_TASK)
      .find({ delete_sign: DeleteSign.NOT_DELETED, deck_id: deckId })
      .project({ task_id: 1, task_type: 1, task_status: 1 })
      .sort({ created_time: -1 })
      .limit(1)
      .toArray();
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      taskId: String(row.task_id),
      taskType: String(row.task_type),
      taskStatus: String(row.task_status),
    };
  }

  /** 品牌规范名称（冗余展示；已删除的不返回） */
  async findBrandKitName(brandKitId: string): Promise<string | null> {
    const row = await this.connection
      .collection(DeckStatsRepository.COL_BRAND_KIT)
      .findOne(
        { brand_kit_id: brandKitId, delete_sign: DeleteSign.NOT_DELETED },
        { projection: { kit_name: 1 } },
      );
    return row != null && typeof row.kit_name === 'string' ? row.kit_name : null;
  }

  /** INV-7 守卫：默认品牌规范存在且未删除（属主隔离一并校验；dl_brand_kit 启用态=未删除，v1 口径） */
  countValidBrandKit(brandKitId: string, userId: string): Promise<number> {
    return this.connection.collection(DeckStatsRepository.COL_BRAND_KIT).countDocuments({
      delete_sign: DeleteSign.NOT_DELETED,
      brand_kit_id: brandKitId,
      user_id: userId,
    });
  }

  /** INV-1 守卫：版本归属于该 deck（dl_deck_version 主键点查） */
  countVersionInDeck(
    versionId: string,
    deckId: string,
    session?: ClientSession,
  ): Promise<number> {
    return this.connection
      .collection(DeckStatsRepository.COL_VERSION)
      .countDocuments({ version_id: versionId, deck_id: deckId }, { session });
  }

  /**
   * 规则编码取号：当日前缀下最大 deck_code（v1 selectMaxDeckCodeForUpdate 对齐；
   * Mongo 事务快照读 + 同事务插入收窄并发窗口，deck_code 无唯一索引为 v1 既有口径）。
   */
  async findMaxDeckCode(prefix: string, session?: ClientSession): Promise<string | null> {
    const row = await this.connection.collection(DeckStatsRepository.COL_DECK).findOne(
      { deck_code: { $regex: `^${prefix}` } },
      { projection: { deck_code: 1 }, sort: { deck_code: -1 }, session },
    );
    return row != null && typeof row.deck_code === 'string' ? row.deck_code : null;
  }

  /** 分组计数静态管道（$match 值 ← 调用方枚举 code/服务端加载 id，无用户输入直拼） */
  private async groupCountByDeck(
    collectionName: string,
    deckIds: string[],
    extraMatch: Record<string, unknown>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (deckIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(collectionName)
      .aggregate<{ _id: string; cnt: number }>([
        { $match: { deck_id: { $in: deckIds }, ...extraMatch } },
        { $group: { _id: '$deck_id', cnt: { $sum: 1 } } },
      ])
      .toArray();
    for (const row of rows) {
      result.set(String(row._id), Number(row.cnt));
    }
    return result;
  }
}
