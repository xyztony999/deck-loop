/**
 * PG → SQLite SQL 方言翻译（ADR-017 本地优先 MCP）。
 *
 * 仓储层原生 SQL 为 PG 口径（$n 占位符/::int/ILIKE/FOR UPDATE/GREATEST/now()）；
 * 本地 SQLite 运行时在 QueryRunner.query 唯一漏斗处翻译，**仓储代码零改动**，
 * 线上 PG 路径不经本模块。翻译规则：
 * - `$n` → `?`（按出现位次重排绑定参数，重复引用重复推值——SQLite 位置绑定语义）；
 * - `now()` → `?` + UTC 时间串参数（与 TypeORM sqlite 驱动 mixedDateToUtcDatetimeString
 *   同格式 'YYYY-MM-DD HH:mm:ss.SSS'，保证与 QB 写入时间可比较）；
 * - `::int`  casts 剥离（SQLite COUNT 返回即 number）；
 * - `ILIKE` → `LIKE` + `ESCAPE '\'`（SQLite LIKE 默认 ASCII 大小写不敏感，
 *   补 ESCAPE 对齐 PG 反斜杠转义语义，escapeLike 产物不变）；
 * - `FOR UPDATE` 剥离（SQLite 单进程写串行，唯一索引兜底并发取号）；
 * - `GREATEST(` → `MAX(`（SQLite 标量 max 同语义）。
 *
 * 纯函数（无 IO）；仅覆盖本仓仓储实际使用的 PG 构造，非通用 SQL 转换器。
 */

/** 翻译结果（SQL + 按位次重排的绑定参数） */
export interface TranslatedSql {
  sql: string;
  params: unknown[];
}

/** PG 专属构造识别（$n / now() / ::int / ILIKE / FOR UPDATE / GREATEST(） */
const PG_CONSTRUCT = /\$(\d+)|\bnow\(\s*\)|::int\b|\bILIKE\b|\bFOR\s+UPDATE\b|\bGREATEST\s*\(/i;

/** UTC 时间串（TypeORM sqlite datetime 归一格式：YYYY-MM-DD HH:mm:ss.SSS） */
function utcNowString(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

/** LIKE 子句补 ESCAPE '\'（QB 与原生 SQL 翻译后均为 `LIKE ?` 形态） */
function withLikeEscape(sql: string): string {
  return sql.replace(/\bLIKE\s+\?/gi, "LIKE ? ESCAPE '\\'");
}

/**
 * 翻译 PG 口径 SQL 为 SQLite 口径。
 * 无 PG 构造时原样返回（参数浅拷贝）；$n 形态按出现位次重建参数序列，
 * 纯 `?` 形态（QueryBuilder 产物）保留原参数仅做文本替换。
 */
export function translatePgToSqlite(sql: string, params: readonly unknown[] = []): TranslatedSql {
  if (!PG_CONSTRUCT.test(sql)) {
    return { sql: withLikeEscape(sql), params: [...params] };
  }

  // $n 形态：单遍扫描，占位符与 now() 按出现位次推参数（天然处理乱序/重复引用）
  if (/\$\d+/.test(sql)) {
    const out: string[] = [];
    const newParams: unknown[] = [];
    const re = /\$(\d+)|\bnow\(\s*\)|::int\b|\bILIKE\b|\bFOR\s+UPDATE\b|\bGREATEST\s*\(/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      out.push(sql.slice(last, m.index));
      const token = m[0];
      if (m[1] !== undefined) {
        out.push('?');
        newParams.push(params[Number(m[1]) - 1]);
      } else if (/^now/i.test(token)) {
        out.push('?');
        newParams.push(utcNowString());
      } else if (/^ILIKE$/i.test(token)) {
        out.push('LIKE');
      } else if (/^GREATEST/i.test(token)) {
        out.push('MAX(');
      }
      // ::int / FOR UPDATE：剥离（不输出）
      last = m.index + token.length;
    }
    out.push(sql.slice(last));
    return { sql: withLikeEscape(out.join('')), params: newParams };
  }

  // 纯 ? 形态（QB 产物）：参数位次不变，仅文本替换；now() 兜底 CURRENT_TIMESTAMP
  const textOnly = sql
    .replace(/::int\b/gi, '')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\bFOR\s+UPDATE\b/gi, '')
    .replace(/\bGREATEST\s*\(/gi, 'MAX(')
    .replace(/\bnow\(\s*\)/gi, 'CURRENT_TIMESTAMP');
  return { sql: withLikeEscape(textOnly), params: [...params] };
}