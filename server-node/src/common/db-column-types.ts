/**
 * 跨驱动列类型常量（ADR-017 本地优先 MCP：同一套 entity 复用于 PostgreSQL 与 SQLite）。
 *
 * env DECK_LOOP_DB=sqlite 时切换为 SQLite 亲和类型（mcp-server 本地进程在 import
 * entity 前设置）；缺省/其他值一律 PG 类型——线上 PG 路径与 pg-mem 测试行为不变。
 * bigint 两驱动均支持（SQLite INTEGER 亲和，JS 安全整数内，沿仓储归一口径），不在此列。
 */

const IS_SQLITE = process.env.DECK_LOOP_DB === 'sqlite';

/** JSON 值对象嵌入列（PG jsonb / SQLite simple-json，读取即纯对象） */
export const JSON_COLUMN_TYPE: 'jsonb' | 'simple-json' = IS_SQLITE ? 'simple-json' : 'jsonb';

/** 时间戳列（PG timestamptz / SQLite datetime，TypeORM 驱动各自归一 Date） */
export const TIMESTAMP_COLUMN_TYPE: 'timestamptz' | 'datetime' = IS_SQLITE
  ? 'datetime'
  : 'timestamptz';