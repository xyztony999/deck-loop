import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { DeleteSign } from '../common/enums';
import { inClause, type TxSession } from '../common/persistence';

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
 * deck 域跨聚合只读聚合查询（v1 DeckStatsMapper 语义平移；ADR-016 SQL 版）。
 *
 * 背景：api-deck 声明 deck 域「无出站服务调用」，但列表/详情需要版本与任务统计、
 * 定稿/归档守卫需要「进行中任务」计数、INV-1/INV-7 需要归属校验。单服务单库（ADR-006）
 * 下以 deck 域内的只读直查实现——**直查他域表的只读投影**（dl_deck_version /
 * dl_generation_task / dl_export_task / dl_brand_kit / dl_deck 取号），不复制他域 entity、
 * 不引入他域 Service 依赖（deck 零出站，domain-manifest §1④）。
 *
 * 查询安全（NR-03）：SQL 服务端静态构造，入参仅作绑定值；状态/类型字面量由调用方以
 * 共享枚举 code 传参，本类不硬编码业务状态值（DeleteSign 公共枚举除外）。
 * 跨表字段名沿各域契约 §5.3 snake_case 口径（v1 列平移）。
 */
@Injectable()
export class DeckStatsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /** 各 deck 的版本总数（dl_deck_version 只插入、无逻辑删除，直接全计） */
  async countVersions(deckIds: string[]): Promise<Map<string, number>> {
    return this.groupCountByDeck('dl_deck_version', deckIds, []);
  }

  /** 各 deck 的调整次数（成功完成的整稿/定向调整任务数） */
  async countAdjustTasks(
    deckIds: string[],
    taskTypes: string[],
    succeededStatus: string,
  ): Promise<Map<string, number>> {
    return this.groupCountByDeck('dl_generation_task', deckIds, [
      { column: 'delete_sign', op: 'eq', values: [DeleteSign.NOT_DELETED] },
      { column: 'task_status', op: 'eq', values: [succeededStatus] },
      { column: 'task_type', op: 'in', values: taskTypes },
    ]);
  }

  /** 各 deck 的进行中任务数（QUEUED/RUNNING，finalize/archive 守卫与 operList 标志） */
  async countRunningTasks(deckIds: string[], statuses: string[]): Promise<Map<string, number>> {
    return this.groupCountByDeck('dl_generation_task', deckIds, [
      { column: 'delete_sign', op: 'eq', values: [DeleteSign.NOT_DELETED] },
      { column: 'task_status', op: 'in', values: statuses },
    ]);
  }

  /** 单 deck 进行中任务数 */
  async countRunningTasksOfDeck(deckId: string, statuses: string[]): Promise<number> {
    if (statuses.length === 0) {
      return 0;
    }
    // 绑定序严格对齐参数位次：$1=delete_sign, $2=deck_id, 状态值自 $3 起。
    // （占位符序号错位会与 deck_id 撞号——IN (deckId,'QUEUED') 永不含 RUNNING，守卫恒放行）
    const placeholders = statuses.map((_, i) => `$${i + 3}`).join(',');
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_generation_task WHERE delete_sign = $1 AND deck_id = $2 AND task_status IN (${placeholders})`,
      [DeleteSign.NOT_DELETED, deckId, ...statuses],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** 各 deck 的导出记录数（SUCCEEDED 终态即导出记录） */
  async countExports(deckIds: string[], succeededStatus: string): Promise<Map<string, number>> {
    return this.groupCountByDeck('dl_export_task', deckIds, [
      { column: 'delete_sign', op: 'eq', values: [DeleteSign.NOT_DELETED] },
      { column: 'export_status', op: 'eq', values: [succeededStatus] },
    ]);
  }

  /** 版本序号映射（versionId → version_seq），列表行 currentVersionSeq 回填用 */
  async findVersionSeqs(versionIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (versionIds.length === 0) {
      return result;
    }
    const inc = inClause('version_id', versionIds, 1);
    const rows = await this.dataSource.query(
      `SELECT version_id, version_seq FROM dl_deck_version WHERE ${inc.sql}`,
      inc.params,
    );
    for (const row of rows) {
      result.set(String(row.version_id), Number(row.version_seq));
    }
    return result;
  }

  /** deck 最近一次任务（详情 withLatestTask 开关；created_time desc 取 1） */
  async findLatestTask(deckId: string): Promise<DeckLatestTaskRow | null> {
    const rows = await this.dataSource.query(
      `SELECT task_id, task_type, task_status FROM dl_generation_task WHERE delete_sign = 0 AND deck_id = $1 ORDER BY created_time DESC LIMIT 1`,
      [deckId],
    );
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
    const rows = await this.dataSource.query(
      `SELECT kit_name FROM dl_brand_kit WHERE brand_kit_id = $1 AND delete_sign = 0`,
      [brandKitId],
    );
    const row = rows[0];
    return row != null && typeof row.kit_name === 'string' ? row.kit_name : null;
  }

  /** INV-7 守卫：默认品牌规范存在且未删除（属主隔离一并校验；启用态=未删除，v1 口径） */
  async countValidBrandKit(brandKitId: string, userId: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_brand_kit WHERE delete_sign = 0 AND brand_kit_id = $1 AND user_id = $2`,
      [brandKitId, userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** INV-1 守卫：版本归属于该 deck（dl_deck_version 主键点查；session 透传，单事务可见新插入版本） */
  async countVersionInDeck(
    versionId: string,
    deckId: string,
    session?: TxSession,
  ): Promise<number> {
    const rows = await this.manager(session).query(
      `SELECT COUNT(*)::int AS cnt FROM dl_deck_version WHERE version_id = $1 AND deck_id = $2`,
      [versionId, deckId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /**
   * 规则编码取号：当日前缀下最大 deck_code（v1 selectMaxDeckCodeForUpdate 对齐；
   * 事务内读 + 同事务插入收窄并发窗口，deck_code 无唯一索引为 v1 既有口径）。
   */
  async findMaxDeckCode(prefix: string, session?: TxSession): Promise<string | null> {
    const rows = await this.manager(session).query(
      `SELECT deck_code FROM dl_deck WHERE deck_code LIKE $1 ORDER BY deck_code DESC LIMIT 1`,
      [`${prefix}%`],
    );
    const row = rows[0];
    return row != null && typeof row.deck_code === 'string' ? row.deck_code : null;
  }

  /** 分组计数静态 SQL（绑定值 ← 调用方枚举 code/服务端加载 id，无用户输入直拼） */
  private async groupCountByDeck(
    table: string,
    deckIds: string[],
    extra: Array<{ column: string; op: 'eq' | 'in'; values: unknown[] }>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (deckIds.length === 0) {
      return result;
    }
    const inc = inClause('deck_id', deckIds, 1);
    let nextIndex = 1 + deckIds.length;
    const conditions: string[] = [inc.sql];
    const params: unknown[] = [...inc.params];
    for (const seg of extra) {
      if (seg.column === 'delete_sign') {
        // 内联服务端常量（NR-03：非用户输入）——规避 pg-mem 整型绑定参数类型推断缺陷
        conditions.push(`delete_sign = ${Number(seg.values[0]) === DeleteSign.DELETED ? 1 : 0}`);
      } else if (seg.op === 'in') {
        const sub = inClause(seg.column, seg.values, nextIndex);
        conditions.push(sub.sql);
        params.push(...sub.params);
        nextIndex += seg.values.length;
      } else {
        conditions.push(`${seg.column} = $${nextIndex}`);
        params.push(seg.values[0]);
        nextIndex += 1;
      }
    }
    const rows = await this.dataSource.query(
      `SELECT deck_id, COUNT(*)::int AS cnt FROM ${table} WHERE ${conditions.join(' AND ')} GROUP BY deck_id`,
      params,
    );
    for (const row of rows) {
      result.set(String(row.deck_id), Number(row.cnt));
    }
    return result;
  }
}