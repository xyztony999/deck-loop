#!/usr/bin/env node
/**
 * deck-loop MCP server 入口（stdio）。
 *
 * DECK_LOOP_DB 必须先于 @deck-loop/core 任何模块加载设置（entity 列类型常量
 * 在 import 时求值）——故 app 经动态 import 引入，不可改为静态 import。
 * stdout 为 MCP 协议通道：日志一律 stderr。
 */
process.env.DECK_LOOP_DB = 'sqlite';

async function main(): Promise<void> {
  const { startServer } = await import('./app');
  await startServer();
}

main().catch((error) => {
  console.error('[deck-loop-mcp] 启动失败:', error);
  process.exit(1);
});