/**
 * MCP server 装配（ADR-018 远程模式）：RemoteClient（HTTP + X-Api-Token）+
 * 同一套 28 tools + stdio 传输。**不加载 LocalCore/SQLite/native 依赖**——
 * 云端 PG 单源，本地仅保留产物目录（导出/预览渲染始终本地，ADR-015）。
 *
 * env（§4.2）：DECK_LOOP_MODE=remote 时必填 DECK_LOOP_API_URL（如 https://host/api）
 * + DECK_LOOP_API_TOKEN（个人 API token，网站设置页签发）。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServerWithBackend } from './server';
import { prepareStorage, resolvePaths } from './paths';
import { REMOTE_USER_ID } from './tools/context';
import { RemoteClient } from './tools/remote-client';

/** stdio 入口（remote 模式；main.ts 消费） */
export async function startRemoteServer(): Promise<void> {
  const apiUrl = process.env.DECK_LOOP_API_URL;
  const apiToken = process.env.DECK_LOOP_API_TOKEN;
  if (typeof apiUrl !== 'string' || apiUrl.trim().length === 0) {
    throw new Error('remote 模式须设置 DECK_LOOP_API_URL（如 https://host/api）');
  }
  if (typeof apiToken !== 'string' || apiToken.trim().length === 0) {
    throw new Error('remote 模式须设置 DECK_LOOP_API_TOKEN（个人 API token，网站设置页签发）');
  }
  const paths = resolvePaths();
  prepareStorage(paths);
  const client = new RemoteClient({ apiUrl, apiToken });
  const server = createMcpServerWithBackend(client, paths, REMOTE_USER_ID);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 日志不含 token（INV-28 精神）；URL 脱敏凭据段
  console.error(
    `[deck-loop-mcp] stdio 就绪（remote 模式），API ${apiUrl.replace(/:\/\/[^@/\s]+@/g, '://***@')}，产物目录 ${paths.home}`,
  );

  const shutdown = (): void => {
    void client.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}