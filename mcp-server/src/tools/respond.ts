/**
 * MCP 工具回执统一封装：成功 JSON 文本；失败 isError + 错误码/消息
 * （BizException.code 透传，agent 可据此判别业务守卫拒绝 vs 集成缺陷）。
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function fail(error: unknown): CallToolResult {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: JSON.stringify({ code: code ?? 'ERROR', message }) }],
    isError: true,
  };
}

/** 工具 handler 包装：业务异常 → isError 回执（不炸 stdio 通道） */
export function guarded<A>(handler: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      return fail(error);
    }
  };
}