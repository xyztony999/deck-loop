/**
 * 28 tools 统一注册（两模式共用——名称/入参 schema/语义/回执完全一致，ADR-018 §4.2）。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context';
import { registerDeckTools } from './deck';
import { registerVersionTools } from './version';
import { registerAssetTools } from './asset';
import { registerExportTools } from './export';
import { registerBrandKitTools } from './brandkit';

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerDeckTools(server, ctx);
  registerVersionTools(server, ctx);
  registerAssetTools(server, ctx);
  registerExportTools(server, ctx);
  registerBrandKitTools(server, ctx);
}