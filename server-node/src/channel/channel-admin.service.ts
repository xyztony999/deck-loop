import { Inject, Injectable, Optional } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { BizException } from '../common/exceptions';
import { decryptApiKey, encryptApiKey, maskApiKey } from '../common/crypto/api-key-cipher.util';
import { assertPublicHttpUrl } from '../platform/gateway/url-guard';
import {
  GATEWAY_RUNTIME_PORT,
  type GatewayRuntimePort,
} from './ports';
import { ChannelConfigRepository } from './channel-config.repository';
import {
  CHANNEL_BUILTIN_READONLY,
  CHANNEL_BUILTIN_READONLY_MSG,
  CHANNEL_CODE_EXISTS,
  CHANNEL_CODE_EXISTS_MSG,
  CHANNEL_KEY_MISSING,
  CHANNEL_KEY_MISSING_MSG,
  CHANNEL_NEEDS_ENABLED_MODEL,
  CHANNEL_NEEDS_ENABLED_MODEL_MSG,
  CHANNEL_NOT_FOUND,
  CHANNEL_NOT_FOUND_MSG,
} from './channel.errors';
import {
  ChannelAdminCodeAO,
  ChannelAdminItemVO,
  ChannelAdminListVO,
  ChannelAdminModelVO,
  ChannelAdminSaveAO,
  ChannelAdminSetEnabledAO,
  ChannelAdminTestVO,
} from './channel.dto';
import type { ChannelConfigDocument } from './schemas/channel-config.schema';

/**
 * 渠道管理端 Service（channel-admin-2026-10-23 §2/§4）。
 *
 * - dl_channel 为渠道/模型定义唯一权威来源；保存/启停后经 GatewayRuntimePort
 *   reload() 热生效（快照重建 + 适配器重建，无需重启）；
 * - 密钥：明文仅存在于 save/test 请求瞬间；落库为 AES-256-GCM 密文；
 *   对外 VO 只回掩码（尾 4 位）/env 引用名；
 * - builtin 内置渠道只读（仅可启停）；渠道不物理删除（用量记录引用）。
 */
@Injectable()
export class ChannelAdminService {
  private readonly logger = new Logger(ChannelAdminService.name);

  constructor(
    private readonly repository: ChannelConfigRepository,
    @Optional()
    @Inject(GATEWAY_RUNTIME_PORT)
    private readonly runtime: GatewayRuntimePort | null,
  ) {}

  /** 渠道清单（全量，priority 降序；密钥掩码展示） */
  async list(): Promise<ChannelAdminListVO> {
    const docs = await this.repository.listAll();
    const records = docs.map((doc) => this.toItemVO(doc));
    return new ChannelAdminListVO(records, records.length);
  }

  /** 渠道详情（编辑回显；无明文密钥） */
  async detail(ao: ChannelAdminCodeAO): Promise<ChannelAdminItemVO> {
    const doc = await this.repository.findByCode(ao.channelCode);
    if (doc === null) {
      throw new BizException(CHANNEL_NOT_FOUND, CHANNEL_NOT_FOUND_MSG);
    }
    return this.toItemVO(doc);
  }

  /** 保存（新建/编辑）：creating 区分语义 → 校验 → 加密落库 → 热生效 */
  async save(operator: string, ao: ChannelAdminSaveAO): Promise<null> {
    const existing = await this.repository.findByCode(ao.channelCode);
    if (ao.creating === true) {
      if (existing !== null) {
        throw new BizException(CHANNEL_CODE_EXISTS, CHANNEL_CODE_EXISTS_MSG);
      }
    } else if (existing === null) {
      throw new BizException(CHANNEL_NOT_FOUND, CHANNEL_NOT_FOUND_MSG);
    }
    if (existing !== null && existing.builtin) {
      throw new BizException(CHANNEL_BUILTIN_READONLY, CHANNEL_BUILTIN_READONLY_MSG);
    }
    if (existing === null && (ao.apiKey ?? '').length === 0 && (ao.apiKeyEnv ?? '').length === 0) {
      throw new BizException(CHANNEL_KEY_MISSING, CHANNEL_KEY_MISSING_MSG);
    }
    this.assertModelsUsable(ao);
    // 出站 baseUrl SSRF 防线（http/https、拒内网/保留段；BizException 语义直传）
    assertPublicHttpUrl(ao.apiBaseUrl.trim());

    const now = new Date();
    const models = ao.models.map((m) => ({
      model_code: m.modelCode.trim(),
      model_name: m.modelName.trim(),
      capability_tags: [...m.capabilityTags],
      enabled: m.enabled,
    }));
    const patch: Record<string, unknown> = {
      channel_name: ao.channelName.trim(),
      api_base_url: ao.apiBaseUrl.trim(),
      api_key_env: (ao.apiKeyEnv ?? '').trim(),
      priority: ao.priority ?? 100,
      enabled: ao.enabled,
      models,
      updated_by: operator,
      updated_time: now,
    };
    if (existing === null) {
      await this.repository.insert({
        channel_code: ao.channelCode.trim().toUpperCase(),
        channel_name: ao.channelName.trim(),
        api_base_url: ao.apiBaseUrl.trim(),
        api_key_cipher: (ao.apiKey ?? '').length > 0 ? encryptApiKey(ao.apiKey!.trim()) : '',
        api_key_env: (ao.apiKeyEnv ?? '').trim(),
        priority: ao.priority ?? 100,
        enabled: ao.enabled,
        builtin: false,
        source: 'admin',
        models,
        created_by: operator,
        created_time: now,
        updated_by: operator,
        updated_time: now,
        data_version: 0,
      });
    } else {
      if ((ao.apiKey ?? '').length > 0) {
        patch.api_key_cipher = encryptApiKey(ao.apiKey!.trim());
      }
      await this.repository.updateByCode(ao.channelCode, operator, patch);
    }
    await this.reloadRuntime();
    this.logger.log(`渠道已保存并热生效：${ao.channelCode} by=${operator}`);
    return null;
  }

  /** 启停（builtin 允许；启用校验 ≥1 启用模型） */
  async setEnabled(operator: string, ao: ChannelAdminSetEnabledAO): Promise<null> {
    const doc = await this.repository.findByCode(ao.channelCode);
    if (doc === null) {
      throw new BizException(CHANNEL_NOT_FOUND, CHANNEL_NOT_FOUND_MSG);
    }
    if (ao.enabled) {
      const hasEnabledModel = (doc.models ?? []).some((m) => m.enabled);
      if (!hasEnabledModel) {
        throw new BizException(CHANNEL_NEEDS_ENABLED_MODEL, CHANNEL_NEEDS_ENABLED_MODEL_MSG);
      }
    }
    await this.repository.updateByCode(ao.channelCode, operator, { enabled: ao.enabled });
    await this.reloadRuntime();
    this.logger.log(`渠道启停已热生效：${ao.channelCode} enabled=${ao.enabled} by=${operator}`);
    return null;
  }

  /**
   * 连通性测试：channelCode 走已存渠道（解密密钥）；否则走临时 baseUrl+apiKey。
   * 真实最小 chat 请求（max_tokens=1，10s 超时）；失败回显原因，不抛错。
   */
  async test(ao: {
    channelCode?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    modelCode?: string;
  }): Promise<ChannelAdminTestVO> {
    let baseUrl = (ao.apiBaseUrl ?? '').trim();
    let apiKey = (ao.apiKey ?? '').trim();
    let modelCode = (ao.modelCode ?? '').trim();

    if (ao.channelCode) {
      const doc = await this.repository.findByCode(ao.channelCode);
      if (doc === null) {
        return new ChannelAdminTestVO(false, undefined, '渠道不存在');
      }
      baseUrl = doc.api_base_url;
      apiKey =
        decryptApiKey(doc.api_key_cipher) ??
        (doc.api_key_env ? (process.env[doc.api_key_env] ?? '') : '');
      modelCode =
        modelCode.length > 0
          ? modelCode
          : (doc.models ?? []).find((m) => m.enabled)?.model_code ?? '';
    }
    if (baseUrl.length === 0) {
      return new ChannelAdminTestVO(false, undefined, '缺少 baseUrl');
    }
    if (modelCode.length === 0) {
      return new ChannelAdminTestVO(false, undefined, '缺少模型编码');
    }
    try {
      assertPublicHttpUrl(baseUrl);
    } catch (err) {
      return new ChannelAdminTestVO(
        false,
        undefined,
        err instanceof BizException ? err.message : 'baseUrl 非法',
      );
    }

    const startedAt = Date.now();
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelCode,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Date.now() - startedAt;
      if (res.ok) {
        return new ChannelAdminTestVO(true, latencyMs);
      }
      const text = await res.text().catch(() => '');
      return new ChannelAdminTestVO(
        false,
        latencyMs,
        `HTTP ${res.status}${text.length > 0 ? `：${text.slice(0, 200)}` : ''}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new ChannelAdminTestVO(false, Date.now() - startedAt, msg);
    }
  }

  /* ---------------- 内部 ---------------- */

  /** 模型行校验：渠道内编码唯一 + 启用渠道须含 ≥1 启用模型 */
  private assertModelsUsable(ao: ChannelAdminSaveAO): void {
    const codes = new Set<string>();
    for (const m of ao.models) {
      const code = m.modelCode.trim();
      if (codes.has(code)) {
        throw new BizException(CHANNEL_CODE_EXISTS, `模型编码重复：${code}`);
      }
      codes.add(code);
    }
    if (ao.enabled && !ao.models.some((m) => m.enabled)) {
      throw new BizException(CHANNEL_NEEDS_ENABLED_MODEL, CHANNEL_NEEDS_ENABLED_MODEL_MSG);
    }
  }

  private toItemVO(doc: ChannelConfigDocument): ChannelAdminItemVO {
    const plain = decryptApiKey(doc.api_key_cipher);
    const apiKeyMasked =
      plain !== null && plain.length > 0
        ? maskApiKey(plain)
        : doc.api_key_env
          ? `env:${doc.api_key_env}`
          : '';
    return new ChannelAdminItemVO(
      doc.channel_code,
      doc.channel_name,
      doc.api_base_url,
      doc.priority ?? 0,
      doc.enabled ?? false,
      doc.builtin ?? false,
      doc.source ?? 'admin',
      apiKeyMasked,
      (doc.models ?? []).map(
        (m): ChannelAdminModelVO => ({
          modelCode: m.model_code,
          modelName: m.model_name,
          capabilityTags: [...(m.capability_tags ?? [])],
          enabled: m.enabled ?? true,
        }),
      ),
    );
  }

  private async reloadRuntime(): Promise<void> {
    if (this.runtime !== null) {
      await this.runtime.reload();
    }
  }
}
