/**
 * MCP server 装配（ADR-017 本地模式）：本地 headless 核心 + 域 tools + stdio 传输。
 * 本模块由 main.ts 动态 import（DECK_LOOP_DB 先置）；测试经 createMcpServer 复用。
 * 远程模式装配见 remote.ts（ADR-018 §4.2；不加载 SQLite/native 依赖）。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLocalCore, type LocalCore } from '@deck-loop/core/dist/local';
import Database from 'better-sqlite3';
import { prepareStorage, resolvePaths, type LocalPaths } from './paths';
import { LOCAL_USER_ID } from './tools/context';
import { LocalBackend } from './tools/local-backend';
import { createMcpServerWithBackend } from './server';

export { createMcpServerWithBackend, SERVER_NAME, SERVER_VERSION } from './server';

/** 创建本地核心（SQLite + 四域模块；driver 注入，core 树不引 native 依赖） */
export async function openCore(paths: LocalPaths): Promise<LocalCore> {
  prepareStorage(paths);
  return createLocalCore({ database: paths.database, driver: Database });
}

/** 装配 MCP server（local 模式：LocalCore → LocalBackend；传输由调用方连接） */
export function createMcpServer(core: LocalCore, paths: LocalPaths): McpServer {
  return createMcpServerWithBackend(new LocalBackend(core, LOCAL_USER_ID, paths), paths, LOCAL_USER_ID);
}

/** stdio 入口（local 模式；main.ts 消费） */
export async function startServer(): Promise<void> {
  const paths = resolvePaths();
  const core = await openCore(paths);
  const server = createMcpServer(core, paths);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[deck-loop-mcp] stdio 就绪（local 模式），数据目录 ${paths.home}`);

  const shutdown = (): void => {
    void core.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}