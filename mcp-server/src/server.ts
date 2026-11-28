/**
 * MCP server 工厂（两模式共用；零 LocalCore/native 依赖——remote.ts 可直接 import）。
 * 28 tools 注册完全一致（ADR-018 §4.2：名称/入参 schema/语义/回执两模式相同）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LocalPaths } from './paths';
import type { ToolBackend } from './tools/backend';
import type { ToolContext } from './tools/context';
import { registerAllTools } from './tools/register';

export const SERVER_NAME = 'deck-loop';
export const SERVER_VERSION = '0.2.5';

/** 装配 MCP server（装配缝通用入口；传输由调用方连接——stdio/InMemory 测试同构） */
export function createMcpServerWithBackend(
  backend: ToolBackend,
  paths: LocalPaths,
  userId: string,
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const ctx: ToolContext = { backend, userId, paths };
  registerAllTools(server, ctx);
  return server;
}