import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import {
  buildBuiltinMockChannel,
  loadRuntimeKnobs,
  parseEnvChannelDefinitions,
  type GatewayChannelDefinition,
  type GatewayRuntimeConfig,
} from './gateway-config';
import { encryptApiKey, decryptApiKey } from '../../common/crypto/api-key-cipher.util';
import { CHANNEL_CONFIG_TABLE, type ChannelConfigDoc } from './channel-config.doc';

/**
 * 网关运行时快照存储（渠道管理端改造，channel-admin-2026-10-23 §3；ADR-016 SQL）。
 * 配置来源从「env 启动快照」升级为「dl_channel 表 + 可刷新内存快照」。
 *
 * - 引导（onModuleInit）：表为空且 env GATEWAY_CHANNELS 可解析 → 全量导入
 *   （apiKey 加密落库）；随后确保内置 MOCK 渠道存在（builtin seed）；最后加载快照。
 * - 热生效：channel 域管理保存/启停后调用 reload()——重建快照并通知订阅方
 *   （ProviderAdapterRegistry 重建适配器），无需重启进程。
 * - 密钥红线（INV-26）：快照中的 apiKey 仅在网关包内存流转；解密失败按未配置处理。
 * - dl_channel 权威 entity 归 channel 域；本网关侧以 SQL 只读直查（不 import channel entity，
 *   保持 platform→channel 零编译依赖的防腐边界）。
 */
@Injectable()
export class GatewayRuntimeStore implements OnModuleInit {
  private readonly logger = new Logger(GatewayRuntimeStore.name);
  private snapshot: GatewayRuntimeConfig;
  private readonly listeners: Array<(config: GatewayRuntimeConfig) => void> = [];

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
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

  /** 从 dl_channel 重建快照（表空则回落 env 解析/MOCK）并通知订阅方 */
  async reload(): Promise<void> {
    const docs: ChannelConfigDoc[] = await this.dataSource.query(
      `SELECT channel_code, channel_name, api_base_url, api_key_cipher, api_key_env, priority, enabled, builtin, source, models FROM ${CHANNEL_CONFIG_TABLE} ORDER BY priority DESC`,
    );
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
    const count = await this.countChannels();
    if (count === 0) {
      const envChannels = parseEnvChannelDefinitions();
      if (envChannels.length > 0) {
        for (const c of envChannels) {
          await this.insertDoc(this.toDoc(c, 'env-import'));
        }
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
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM ${CHANNEL_CONFIG_TABLE} WHERE channel_code = $1`,
      [mock.channelCode],
    );
    if (Number(rows[0]?.cnt ?? 0) === 0) {
      await this.insertDoc(this.toDoc(mock, 'builtin', true));
    }
  }

  private async countChannels(): Promise<number> {
    const rows = await this.dataSource.query(`SELECT COUNT(*)::int AS cnt FROM ${CHANNEL_CONFIG_TABLE}`);
    return Number(rows[0]?.cnt ?? 0);
  }

  /** 插入渠道行（models jsonb；幂等由调用方 count 守卫） */
  private async insertDoc(doc: Record<string, unknown>): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ${CHANNEL_CONFIG_TABLE}
         (channel_code, channel_name, api_base_url, api_key_cipher, api_key_env, priority, enabled, builtin, source, models, data_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
      [
        doc.channel_code,
        doc.channel_name,
        doc.api_base_url,
        doc.api_key_cipher,
        doc.api_key_env,
        doc.priority,
        doc.enabled,
        doc.builtin,
        doc.source,
        JSON.stringify(doc.models ?? []),
      ],
    );
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

  /** 静态回落快照（引导失败/空表兜底：env 解析 → 内置 MOCK） */
  private loadStaticFallback(): GatewayRuntimeConfig {
    const channels = parseEnvChannelDefinitions();
    return {
      channels: channels.length > 0 ? channels : [buildBuiltinMockChannel()],
      ...loadRuntimeKnobs(),
    };
  }
}