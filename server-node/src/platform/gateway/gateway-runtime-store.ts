import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';

import {
  buildBuiltinMockChannel,
  loadRuntimeKnobs,
  parseEnvChannelDefinitions,
  type GatewayChannelDefinition,
  type GatewayRuntimeConfig,
} from './gateway-config';
import { encryptApiKey, decryptApiKey } from '../../common/crypto/api-key-cipher.util';
import { ChannelConfigDoc } from './channel-config.doc';

/**
 * 网关运行时快照存储（渠道管理端改造，channel-admin-2026-10-23 §3）：
 * 配置来源从「env 启动快照」升级为「dl_channel 集合 + 可刷新内存快照」。
 *
 * - 引导（onModuleInit）：集合为空且 env GATEWAY_CHANNELS 可解析 → 全量导入
 *   （apiKey 加密落库）；随后确保内置 MOCK 渠道存在（builtin seed）；最后加载快照。
 * - 热生效：channel 域管理保存/启停后调用 reload()——重建快照并通知订阅方
 *   （ProviderAdapterRegistry 重建适配器），无需重启进程。
 * - 密钥红线（INV-26）：快照中的 apiKey 仅在网关包内存流转；解密失败按未配置处理。
 */
@Injectable()
export class GatewayRuntimeStore implements OnModuleInit {
  private readonly logger = new Logger(GatewayRuntimeStore.name);
  private snapshot: GatewayRuntimeConfig;
  private readonly listeners: Array<(config: GatewayRuntimeConfig) => void> = [];

  constructor(
    @InjectModel(ChannelConfigDoc.name)
    private readonly configModel: Model<ChannelConfigDoc>,
  ) {
    this.snapshot = this.loadStaticFallback();
  }

  /** 当前快照（消费方每次使用时取，不缓存引用） */
  get(): GatewayRuntimeConfig {
    return this.snapshot;
  }

  /** 订阅快照变更（热生效联动，如适配器重建） */
  onChange(listener: (config: GatewayRuntimeConfig) => void): void {
    this.listeners.push(listener);
  }

  /** 从 dl_channel 重建快照（集合空则回落 env 解析/MOCK）并通知订阅方 */
  async reload(): Promise<void> {
    const docs = await this.configModel.find().sort({ priority: -1 }).lean();
    if (docs.length === 0) {
      this.snapshot = this.loadStaticFallback();
    } else {
      const channels: GatewayChannelDefinition[] = docs.map((doc) => ({
        channelCode: doc.channel_code,
        channelName: doc.channel_name,
        priority: doc.priority ?? 0,
        enabled: doc.enabled ?? false,
        apiKey: decryptApiKey(doc.api_key_cipher) ?? '',
        apiKeyEnv: doc.api_key_env ?? undefined,
        apiBaseUrl: doc.api_base_url ?? undefined,
        models: (doc.models ?? []).map((m) => ({
          modelCode: m.model_code,
          modelName: m.model_name,
          capabilityTags: [...(m.capability_tags ?? [])],
          enabled: m.enabled ?? true,
        })),
      }));
      this.snapshot = { channels, ...loadRuntimeKnobs() };
    }
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
    this.logger.log(
      `网关运行时快照已加载：${this.snapshot.channels.length} 个渠道（${this.snapshot.channels.filter((c) => c.enabled).length} 启用）`,
    );
  }

  /** 引导：空库导入 env + 确保内置 MOCK 存在 → 加载快照（幂等，可测试直调） */
  async bootstrapOnce(): Promise<void> {
    const count = await this.configModel.countDocuments();
    if (count === 0) {
      const envChannels = parseEnvChannelDefinitions();
      if (envChannels.length > 0) {
        await this.configModel.insertMany(envChannels.map((c) => this.toDoc(c, 'env-import')));
        this.logger.warn(`已从 GATEWAY_CHANNELS 首次导入 ${envChannels.length} 个渠道（此后以 dl_channel 为准，env 变更不再同步）`);
      }
    }
    await this.ensureBuiltinMock();
    await this.reload();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.bootstrapOnce();
    } catch (err) {
      // 引导失败不阻断启动：退回静态快照（env/MOCK），管理端保存可再触发 reload
      this.logger.error(`网关运行时引导失败，退回静态快照：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 确保内置 MOCK 渠道存在（builtin 只读，供管理列表展示与生成兜底） */
  private async ensureBuiltinMock(): Promise<void> {
    const mock = buildBuiltinMockChannel();
    const exists = await this.configModel.countDocuments({ channel_code: mock.channelCode });
    if (exists === 0) {
      await this.configModel.create(this.toDoc(mock, 'builtin', true));
    }
  }

  private toDoc(
    def: GatewayChannelDefinition,
    source: 'builtin' | 'env-import' | 'admin',
    builtin = false,
  ): Record<string, unknown> {
    return {
      channel_code: def.channelCode,
      channel_name: def.channelName,
      api_base_url: def.apiBaseUrl ?? '',
      api_key_cipher: def.apiKey ? encryptApiKey(def.apiKey) : '',
      api_key_env: def.apiKeyEnv ?? '',
      priority: def.priority ?? 0,
      enabled: def.enabled ?? false,
      builtin,
      source,
      models: def.models.map((m) => ({
        model_code: m.modelCode,
        model_name: m.modelName,
        capability_tags: [...m.capabilityTags],
        enabled: m.enabled ?? true,
      })),
    };
  }

  /** 静态回落快照（引导失败/空集合兜底：env 解析 → 内置 MOCK） */
  private loadStaticFallback(): GatewayRuntimeConfig {
    const channels = parseEnvChannelDefinitions();
    return {
      channels: channels.length > 0 ? channels : [buildBuiltinMockChannel()],
      ...loadRuntimeKnobs(),
    };
  }
}
