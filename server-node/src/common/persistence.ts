/**
 * 持久层公共工具（ADR-016：MongoDB → PostgreSQL / TypeORM）。
 *
 * - TxSession：跨聚合事务句柄 = TypeORM EntityManager（替代 mongoose ClientSession）。
 *   仓储/领域服务尾参 `session?: TxSession` 加入外层 DataSource.transaction；
 *   缺省回落 dataSource.manager（独立自动提交）。
 * - isDuplicateKeyError：PG unique_violation（23505）判定（替代 Mongo 11000）。
 * - cursorCondition：复合游标（ADR-013/F07）展开 OR 式 SQL 片段（pg-mem 兼容，
 *   等价 row-value 比较）；入参仅作绑定值（NR-02/NR-03）。
 */
import type { EntityManager } from 'typeorm';

/** 跨聚合事务句柄（TypeORM EntityManager；替代 mongoose ClientSession） */
export type TxSession = EntityManager;

/** PG 重复键判定（unique_violation=23505；鸭子类型判别，沿 Mongo 11000 口径） */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/** 复合游标 tiebreak（F07：含边界毫秒行时同毫秒按业务 id 续传） */
export interface CursorTiebreak {
  includeCursorRow: boolean;
  afterId?: string;
}

/**
 * 复合游标时间过滤 SQL 片段（展开 OR 式，等价 `(t,id) > (cursor,afterId)`）：
 * - tiebreak=null → 严格 `t > $n`；
 * - includeCursorRow && afterId → `(t > $n) OR (t = $n AND id > $n+1)`；
 * - includeCursorRow && !afterId → `t >= $n`。
 *
 * @param timeField 时间列（代码级常量，如 updated_time/created_time）
 * @param idField   业务 id 列（代码级常量）
 * @param cursorMs  游标毫秒
 * @param tiebreak  边界行归属
 * @param startIndex 绑定参数起始序号（$n）
 * @returns sql 片段（不含前导 AND）+ 绑定值数组
 */
export function cursorCondition(
  timeField: string,
  idField: string,
  cursorMs: number,
  tiebreak: CursorTiebreak | null | undefined,
  startIndex: number,
): { sql: string; params: unknown[] } {
  const at = new Date(cursorMs);
  const p = `$${startIndex}`;
  if (tiebreak != null && tiebreak.includeCursorRow) {
    if (tiebreak.afterId !== undefined) {
      const p2 = `$${startIndex + 1}`;
      return {
        sql: `(${timeField} > ${p} OR (${timeField} = ${p} AND ${idField} > ${p2}))`,
        params: [at, tiebreak.afterId],
      };
    }
    return { sql: `${timeField} >= ${p}`, params: [at] };
  }
  return { sql: `${timeField} > ${p}`, params: [at] };
}

/**
 * LIKE/ILIKE 字面量转义（keyword 作子串匹配值，转义 %/_/\ 防通配符语义；
 * 配合绑定参数 `ILIKE '%' || $n || '%'` 或 ESCAPE '\'，等价 Mongo escapeRegex + $options:i）。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * IN 子句展开（绑定值逐个占位，避免 = ANY($array) 数组绑定——pg-mem 不支持数组参数；
 * 生产 PG 亦兼容）。空集合返回恒假片段（`1=0`），沿 Mongo $in:[] 空结果口径。
 *
 * @param column 列名（代码级常量）
 * @param values 绑定值集合（服务端加载 id / 枚举 code）
 * @param startIndex 绑定参数起始序号（$n）
 */
export function inClause(
  column: string,
  values: readonly unknown[],
  startIndex: number,
): { sql: string; params: unknown[] } {
  if (values.length === 0) {
    return { sql: '1=0', params: [] };
  }
  const placeholders = values.map((_, i) => `$${startIndex + i}`).join(',');
  return { sql: `${column} IN (${placeholders})`, params: [...values] };
}

/** bigint 列归一为 number（file_size 等；JS 安全整数内，沿 v1 BIGINT→number 口径） */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}