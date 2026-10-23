import { Injectable, Logger } from '@nestjs/common';
import { MockAiProviderAdapter } from './mock-ai-provider.adapter';
import { OpenAiCompatibleProviderAdapter } from './openai-compatible.adapter';
import { type AiProviderAdapter, ProviderCallError } from './ai-provider-adapter';
import { GatewayRuntimeStore } from './gateway-runtime-store';

/**
 * 适配器注册表（gateway 包内路由：channelCode → AiProviderAdapter）。
 * 快照驱动版（渠道管理端热生效）：GatewayRuntimeStore 每次快照刷新后重建
 * 适配器表——已启用渠道构建适配器实例（MOCK=内置模拟适配器，其余配了
 * apiBaseUrl 的=OpenAI 兼容适配器；未配 apiBaseUrl 跳过并告警）。
 */
@Injectable()
export class ProviderAdapterRegistry {
  private readonly logger = new Logger(ProviderAdapterRegistry.name);
  private readonly adapters = new Map<string, AiProviderAdapter>();
  private readonly mockAdapter: MockAiProviderAdapter;

  constructor(
    mockAdapter: MockAiProviderAdapter,
    store: GatewayRuntimeStore,
  ) {
    this.mockAdapter = mockAdapter;
    this.rebuild(store.get().channels, store.get().providerTimeoutMillis);
    store.onChange((config) => this.rebuild(config.channels, config.providerTimeoutMillis));
  }

  /** 重建适配器表（MOCK 常驻；仅 enabled + 配置了 baseUrl 的渠道） */
  private rebuild(channels: readonly { channelCode: string; enabled: boolean; apiBaseUrl?: string }[], timeoutMillis: number): void {
    this.adapters.clear();
    this.adapters.set(this.mockAdapter.channelCode(), this.mockAdapter);
    for (const channel of channels) {
      if (channel.channelCode === MockAiProviderAdapter.CHANNEL_CODE) {
        continue; // MOCK 已内置
      }
      if (!channel.enabled) {
        continue;
      }
      if (channel.apiBaseUrl === undefined || channel.apiBaseUrl.length === 0) {
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
          timeoutMillis,
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
