/**
 * 本地 SQLite 引擎初始化（ADR-019 双模式市场包）。
 *
 * - better-sqlite3（缺省，仓库/开发态）：native，宿主注入模块本体；
 * - sqljs（市场包）：纯 JS+wasm，宿主先 initSqlJs({locateFile}) 再把**已初始化**
 *   SQL 对象注入 TypeORM（SqljsDriver 期望 .Database 构造器）。
 *
 * wasm 定位：env DECK_LOOP_SQLJS_WASM_DIR 优先；否则 require.resolve sql.js dist
 * （仓库态）；再否则 __dirname（bundle 态，sql-wasm.wasm 与 server.cjs 同目录）。
 */
import { dirname, join } from 'node:path';

export interface LocalEngine {
  engine: 'better-sqlite3' | 'sqljs';
  driver: unknown;
}

function resolveWasmDir(): string {
  if (process.env.DECK_LOOP_SQLJS_WASM_DIR) {
    return process.env.DECK_LOOP_SQLJS_WASM_DIR;
  }
  try {
    return dirname(require.resolve('sql.js/dist/sql-wasm.wasm'));
  } catch {
    return __dirname;
  }
}

export async function initLocalEngine(): Promise<LocalEngine> {
  const kind = (process.env.DECK_LOOP_LOCAL_ENGINE ?? 'better-sqlite3').trim();
  if (kind === 'sqljs') {
    const initSqlJs = (await import('sql.js')).default;
    const wasmDir = resolveWasmDir();
    const SQL = await initSqlJs({ locateFile: (file: string) => join(wasmDir, file) });
    return { engine: 'sqljs', driver: SQL };
  }
  if (kind !== 'better-sqlite3') {
    throw new Error(`DECK_LOOP_LOCAL_ENGINE 仅支持 better-sqlite3|sqljs（当前：${kind}）`);
  }
  const Database = (await import('better-sqlite3')).default;
  return { engine: 'better-sqlite3', driver: Database };
}