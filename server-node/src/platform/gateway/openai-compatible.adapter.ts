import { Logger } from '@nestjs/common';

import { assertPublicHttpUrl } from './url-guard';
import {
  type AiProviderAdapter,
  ProviderCallError,
  type ProviderCallContext,
  type ProviderCallResult,
} from './ai-provider-adapter';

/**
 * OpenAI 兼容协议适配器（api-platform §3.2：真实渠道实现 = OpenAI 兼容 + Mock）。
 *
 * - 每个非 MOCK 的已注册渠道一个实例（ProviderAdapterRegistry 按 GATEWAY_CHANNELS
 *   构建，channelCode() 返回构造时绑定的渠道编码）；
 * - 协议：POST {apiBaseUrl}/chat/completions，Authorization: Bearer <apiKey>，
 *   body={model, messages, stream:false}；从 choices[0].message.content 取产物，
 *   usage.prompt_tokens/completion_tokens 取计量（缺失时按长度估算）；
 * - 失败重试 1 次（契约：网络错误/超时/5xx/429 重试一次；4xx 不重试）；
 * - 超时 → BIZ_GW_PROVIDER_TIMEOUT；其余失败 → BIZ_GW_PROVIDER_FAILED；
 * - 密钥仅进 Authorization 头（内存直传），不进日志、不进任何 VO/事件（ADR-010）。
 */
export class OpenAiCompatibleProviderAdapter implements AiProviderAdapter {
  private readonly logger = new Logger(OpenAiCompatibleProviderAdapter.name);

  constructor(
    private readonly boundChannelCode: string,
    private readonly apiBaseUrl: string,
    private readonly defaultTimeoutMillis: number,
  ) {}

  channelCode(): string {
    return this.boundChannelCode;
  }

  async generateOutline(context: ProviderCallContext): Promise<ProviderCallResult> {
    return this.callChatCompletion(
      context,
      '你是演示文稿大纲生成助手，请依据用户指令快照生成章节大纲 JSON（节点树）。',
    );
  }

  async generateContent(context: ProviderCallContext): Promise<ProviderCallResult> {
    return this.callChatCompletion(
      context,
      '你是演示文稿整稿生成助手，请依据用户指令快照生成页面树内容 JSON。',
    );
  }

  async adjustContent(context: ProviderCallContext): Promise<ProviderCallResult> {
    return this.callChatCompletion(
      context,
      '你是演示文稿内容调整助手，请依据用户指令快照对基线内容做调整并返回页面树 JSON。',
    );
  }

  /* ---------------- 协议实现 ---------------- */

  private async callChatCompletion(
    context: ProviderCallContext,
    systemPrompt: string,
  ): Promise<ProviderCallResult> {
    const timeoutMillis = context.timeoutMillis > 0 ? context.timeoutMillis : this.defaultTimeoutMillis;
    // SSRF 防线：仅 http/https 且拒绝内网/保留地址（url-guard）
    assertPublicHttpUrl(this.apiBaseUrl);
    const url = `${this.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body = {
      model: context.task.modelCode,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context.task.instructionSnapshot ?? '' },
      ],
    };

    // 契约：AI 调用失败重试 1 次（网络/超时/5xx/429 可重试；4xx 业务错误不重试）
    try {
      return await this.postOnce(url, body, context, timeoutMillis);
    } catch (error) {
      const normalized = normalizeError(error);
      if (!normalized.retryable) {
        throw normalized;
      }
      this.logger.warn(
        `渠道 ${this.boundChannelCode} 调用失败将重试 1 次（code=${normalized.code}）taskId=${context.task.taskId}`,
      );
      return await this.postOnce(url, body, context, timeoutMillis);
    }
  }

  private async postOnce(
    url: string,
    body: Record<string, unknown>,
    context: ProviderCallContext,
    timeoutMillis: number,
  ): Promise<ProviderCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMillis);
    timer.unref?.();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${context.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw ProviderCallError.timeout('渠道调用超时，请稍后重试');
      }
      throw ProviderCallError.failed(describeError(error));
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500 || response.status === 429) {
      throw ProviderCallError.failed(`渠道 HTTP ${response.status}`, true);
    }
    if (!response.ok) {
      // 4xx：不重试，直接失败
      this.logger.warn(`渠道 ${this.boundChannelCode} HTTP ${response.status} taskId=${context.task.taskId}`);
      throw ProviderCallError.failed(`渠道 HTTP ${response.status}`, false);
    }

    const parsed = await parseJsonResponse(response);
    return toResult(parsed, context);
  }
}

/* ---------------- 响应解析（防御式，无 any） ---------------- */

interface OpenAiChatChoice {
  message?: { content?: unknown };
}

interface OpenAiChatResponse {
  choices?: OpenAiChatChoice[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

async function parseJsonResponse(response: Response): Promise<OpenAiChatResponse> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw ProviderCallError.failed('渠道响应非 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw ProviderCallError.failed('渠道响应结构异常');
  }
  return parsed as OpenAiChatResponse;
}

function toResult(response: OpenAiChatResponse, context: ProviderCallContext): ProviderCallResult {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw ProviderCallError.failed('渠道响应缺少产物内容');
  }
  const promptTokens = asTokenCount(response.usage?.prompt_tokens, context.task.instructionSnapshot?.length ?? 0, 10);
  const completionTokens = asTokenCount(response.usage?.completion_tokens, content.length, 4);
  return { content, promptTokens, completionTokens };
}

function asTokenCount(value: unknown, fallbackLength: number, divisor: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return Math.max(1, Math.floor(fallbackLength / divisor));
}

function normalizeError(error: unknown): ProviderCallError {
  if (error instanceof ProviderCallError) {
    return error;
  }
  return ProviderCallError.failed(describeError(error), true);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
