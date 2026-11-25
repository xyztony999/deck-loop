/**
 * 本地 headless 核心出口（ADR-017）：mcp-server 经 @deck-loop/core/dist/local 消费。
 */
export { createLocalCore, type LocalCore, type LocalCoreOptions } from './local-core';
export { translatePgToSqlite, type TranslatedSql } from './sqlite-dialect';