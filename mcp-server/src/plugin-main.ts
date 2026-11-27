#!/usr/bin/env node
/**
 * 市场包入口（ADR-019 双模式）：SwitchableBackend（local 懒加载 sql.js / remote 登录）
 * + 28 业务 tools + 3 连接 tools + stdio。esbuild 单文件 bundle 消费本入口。
 *
 * 默认本地引擎 sqljs（wasm 随包，全平台通用）；仓库开发态可用
 * DECK_LOOP_LOCAL_ENGINE=better-sqlite3 覆盖。连接配置 ~/.deck-loop/config.json。
 * stdout 为 MCP 协议通道：日志一律 stderr。
 */
process.env.DECK_LOOP_LOCAL_ENGINE ??= 'sqljs';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServerWithBackend } from './server';
import { prepareStorage, resolvePaths } from './paths';
import { SwitchableBackend } from './tools/switchable-backend';
import { registerAccountTools } from './tools/account';

async function main(): Promise<void> {
  const paths = resolvePaths();
  prepareStorage(paths);
  const backend = new SwitchableBackend(paths, 'local');
  const server = createMcpServerWithBackend(backend, paths, 'local');
  registerAccountTools(server, backend);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[deck-loop] 就绪（${backend.mode} 模式），数据目录 ${paths.home}`);

  const shutdown = (): void => {
    void backend.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[deck-loop] 启动失败:', error);
  process.exit(1);
});