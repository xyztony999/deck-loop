import type { SyncChangeOpCode } from '../../common/enums/sync-change-op';

/**
 * 同步变更扫描器 SPI（P-02 增量同步，D3 单调游标；v1 SyncChangeScanner 平移 +
 * 06 §3.6 Mongo 复合游标语义）。
 *
 * ## 复合游标（功能核查 F07：同毫秒 >200 条漏行修复）
 * lastCursor（毫秒）+ lastPosition（`AGGREGATE:id`，api-platform §4.4 增量可选字段）
 * 组成可续传复合游标：页边界可切在同一毫秒内，续传按 (cursor, aggregate, id)
 * 全序推进，不再依赖「毫秒边界裁剪 + at-least-once 退化」。
 *
 * ## 注册方式（各域 NestModule provide）
 * 各业务域在自有 module 的 providers 中登记（无需 export，platform 经容器发现）：
 * ```ts
 * providers: [{ provide: SYNC_CHANGE_SCANNER, useClass: DeckSyncChangeScanner }]
 * ```
 * 不注册的聚合在 /auth/sync/pull 结果中缺席（并行生成期优雅降级）。
 * TASK 聚合由 platform 内置实现（dl_generation_task 同表共治，D1）。
 *
 * ## 游标口径（06 §3.6）
 * - cursor = 本聚合行 updated_time 的**毫秒值**（写时分配，不做秒级截断）；
 * - 扫描查询：`{ user_id（服务端注入）, updated_time: { $gt: lastCursor } }` +
 *   `sort { updated_time: 1, 业务id: 1 }` + limit——(cursor,id) 字典序复合推进
 *   （$gt [cursor,id] 等效实现：SyncPullService 毫秒边界裁剪保证页不切在同一毫秒内，
 *   故严格 $gt cursor 不漏行、不重行）；
 * - DELETE 型变更以 delete_sign=1 的软删文档承载，op 映射 SyncChangeOp.DELETE；
 * - 禁止跨请求 skip 跳页：以 newCursor 推进。
 *
 * ## limit 语义
 * 调用方按单页上限分配（200）；实现方取 limit+1 探测是否还有更多，
 * **须做毫秒边界裁剪**：返回的 items 不得以「截断在某一毫秒中间」收尾
 * （若第 limit+1 行与第 limit 行同毫秒，丢弃尾部同毫秒组，hasMore=true），
 * 否则下一请求严格 $gt cursor 会漏掉同毫秒剩余行。
 */
export interface SyncChangeScanner {
  /** 聚合标识：DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT */
  readonly aggregate: string;

  /**
   * 扫描某用户在复合游标 (lastCursor, boundary) 之后的变更。
   *
   * @param userId     属主（数据隔离 ADR-005，必须过滤）
   * @param lastCursor 上次游标毫秒（首次 0）
   * @param boundary   上页末条位置（aggregate:id；null=无位置续传，纯 $gt 毫秒）
   * @param limit      单聚合最多返回条数（调用方按单页上限分配）
   * @return 变更列表（(cursor,id) 升序）+ 本聚合是否还有更多
   */
  scan(
    userId: string,
    lastCursor: number,
    boundary: SyncBoundary | null,
    limit: number,
  ): Promise<SyncScanResult> | SyncScanResult;
}

/** 复合游标位置（上页末条；跨聚合按 (cursor, aggregate, id) 全序续传） */
export interface SyncBoundary {
  aggregate: string;
  id: string;
}

/** 仓储扫描续传参数（tiebreakFor 按聚合名与边界聚合的排序关系推导） */
export interface CursorTiebreak {
  /** 含边界毫秒行（聚合名排序在边界聚合之后，或即边界聚合本尊） */
  includeCursorRow: boolean;
  /** 仅边界聚合有效：同毫秒内仅取业务 id 之后的行 */
  afterId?: string;
}

/**
 * 本聚合的续传口径（F07）：
 * - 聚合名 < 边界聚合：该毫秒的行已随上页按全序下发 → 纯 $gt 毫秒；
 * - 聚合名 = 边界聚合：含边界毫秒行，但仅取业务 id 之后 → $gt (ms,id)；
 * - 聚合名 > 边界聚合：该毫秒行均未下发 → $gte 毫秒。
 */
export function tiebreakFor(aggregate: string, boundary: SyncBoundary | null): CursorTiebreak | null {
  if (boundary === null) {
    return null;
  }
  if (boundary.aggregate === aggregate) {
    return { includeCursorRow: true, afterId: boundary.id };
  }
  return aggregate < boundary.aggregate ? null : { includeCursorRow: true };
}

/** 扫描结果（items + 本聚合是否可能还有更多行） */
export interface SyncScanResult {
  items: SyncChangeItem[];
  hasMore: boolean;
}

/** 单条变更（/auth/sync/pull changes[] 元素的服务端形态） */
export interface SyncChangeItem {
  /** 聚合标识（DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT） */
  aggregate: string;
  /** 变更类型：SyncChangeOp（UPSERT/DELETE） */
  op: SyncChangeOpCode;
  /** 聚合行业务主键 */
  id: string;
  /** 该行游标（updated_time 毫秒，单调） */
  cursor: number;
  /** 载荷摘要/全量（JSON 字符串，扫描器组装；_id 不入载荷） */
  payload: string;
}

/** DI token（字符串 token；各域 provide，SyncPullService 经容器发现聚合） */
export const SYNC_CHANGE_SCANNER = 'SYNC_CHANGE_SCANNER';
