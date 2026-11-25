/**
 * MCP server 装配（ADR-017）：本地 headless 核心 + 域 tools + stdio 传输。
 * 本模块由 main.ts 动态 import（DECK_LOOP_DB 先置）；测试经 createMcpServer 复用。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLocalCore, type LocalCore } from '@deck-loop/core/dist/local';
import Database from 'better-sqlite3';
import { prepareStorage, resolvePaths, type LocalPaths } from './paths';
import { LOCAL_USER_ID, type ToolContext } from './tools/context';
import { registerDeckTools } from './tools/deck';
import { registerVersionTools } from './tools/version';
import { registerAssetTools } from './tools/asset';
import { registerExportTools } from './tools/export';
import { registerBrandKitTools } from './tools/brandkit';

export const SERVER_NAME = 'deck-loop';
export const SERVER_VERSION = '0.1.0';

/** 创建本地核心（SQLite + 四域模块；driver 注入，core 树不引 native 依赖） */
export async function openCore(paths: LocalPaths): Promise<LocalCore> {
  prepareStorage(paths);
  return createLocalCore({ database: paths.database, driver: Database });
}

/** 装配 MCP server（tools 注册；传输由调用方连接——stdio/InMemory 测试同构） */
export function createMcpServer(core: LocalCore, paths: LocalPaths): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const ctx: ToolContext = { core, userId: LOCAL_USER_ID, paths };
  registerDeckTools(server, ctx);
  registerVersionTools(server, ctx);
  registerAssetTools(server, ctx);
  registerExportTools(server, ctx);
  registerBrandKitTools(server, ctx);
  return server;
}

/** stdio 入口（main.ts 消费） */
export async function startServer(): Promise<void> {
  const paths = resolvePaths();
  const core = await openCore(paths);
  const server = createMcpServer(core, paths);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[deck-loop-mcp] stdio 就绪，数据目录 ${paths.home}`);

  const shutdown = (): void => {
    void core.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}