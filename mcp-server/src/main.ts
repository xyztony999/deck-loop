#!/usr/bin/env node
/**
 * deck-loop MCP server 入口（stdio；ADR-018 §4.2 模式切换）。
 *
 * DECK_LOOP_MODE=local|remote（缺省 local，向后兼容 ADR-017）：
 * - local：DECK_LOOP_DB 必须先于 @deck-loop/core 任何模块加载设置（entity 列类型
 *   常量在 import 时求值）——故 app 经动态 import 引入，不可改为静态 import；
 * - remote：DECK_LOOP_API_URL + DECK_LOOP_API_TOKEN 必填；不加载 SQLite/native。
 * stdout 为 MCP 协议通道：日志一律 stderr。
 */
async function main(): Promise<void> {
  const mode = (process.env.DECK_LOOP_MODE ?? 'local').trim().toLowerCase();
  if (mode === 'remote') {
    const { startRemoteServer } = await import('./remote');
    await startRemoteServer();
    return;
  }
  if (mode !== 'local') {
    throw new Error(`DECK_LOOP_MODE 仅支持 local|remote（当前值：${mode}）`);
  }
  process.env.DECK_LOOP_DB = 'sqlite';
  const { startServer } = await import('./app');
  await startServer();
}

main().catch((error) => {
  console.error('[deck-loop-mcp] 启动失败:', error);
  process.exit(1);
});