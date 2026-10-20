import { Inject, Injectable, Logger } from '@nestjs/common';
import { GATEWAY_RUNTIME_CONFIG, type GatewayRuntimeConfig } from './gateway-config';
import { MockAiProviderAdapter } from './mock-ai-provider.adapter';
import { OpenAiCompatibleProviderAdapter } from './openai-compatible.adapter';
import { type AiProviderAdapter, ProviderCallError } from './ai-provider-adapter';

/**
 * 适配器注册表（gateway 包内路由：channelCode → AiProviderAdapter）。
 * v1「List<AiProviderAdapter> 注入 Bean 按 channelCode 匹配」的 env 驱动版：
 * GATEWAY_CHANNELS 每个已启用渠道构建一个适配器实例——MOCK 渠道=内置模拟适配器，
 * 其余（配置了 apiBaseUrl）=OpenAI 兼容适配器；未配 apiBaseUrl 的真实渠道跳过并告警。
 */
@Injectable()
export class ProviderAdapterRegistry {
  private readonly logger = new Logger(ProviderAdapterRegistry.name);
  private readonly adapters = new Map<string, AiProviderAdapter>();

  constructor(
    mockAdapter: MockAiProviderAdapter,
    @Inject(GATEWAY_RUNTIME_CONFIG) config: GatewayRuntimeConfig,
  ) {
    this.adapters.set(mockAdapter.channelCode(), mockAdapter);
    for (const channel of config.channels) {
      if (channel.channelCode === MockAiProviderAdapter.CHANNEL_CODE) {
        continue; // MOCK 已内置
      }
      if (!channel.enabled) {
        continue;
      }
      if (channel.apiBaseUrl === undefined) {
        this.logger.warn(
          `渠道 ${channel.channelCode} 未配置 apiBaseUrl，无法构建 HTTP 适配器（仅登记清单）`,
        );
        continue;
      }
      this.adapters.set(
        channel.channelCode,
        new OpenAiCompatibleProviderAdapter(
          channel.channelCode,
          channel.apiBaseUrl,
          config.providerTimeoutMillis,
        ),
      );
    }
  }

  /** 按渠道编码解析适配器（未注册 → BIZ_GW_PROVIDER_FAILED） */
  resolve(channelCode: string): AiProviderAdapter {
    const adapter = this.adapters.get(channelCode);
    if (adapter === undefined) {
      throw ProviderCallError.failed(`渠道无适配器: ${channelCode}`, false);
    }
    return adapter;
  }
}
