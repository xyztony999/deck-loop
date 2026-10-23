import { Logger } from '@nestjs/common';

/**
 * 网关运行时配置（v1 ChannelProperties 平移；配置源 env 直读，不引 config 包）。
 *
 * 渠道注册（gw-channel-registry，api-platform §4.1）：env `GATEWAY_CHANNELS` JSON 数组——
 * [{ "channelCode": "OPENAI", "channelName": "...", "priority": 10, "enabled": true,
 *    "apiKey": "sk-..." | "apiKeyEnv": "OPENAI_API_KEY", "apiBaseUrl": "https://.../v1",
 *    "models": [{ "modelCode": "...", "modelName": "...", "capabilityTags": ["OUTLINE", ...], "enabled": true }] }]
 *
 * 安全红线（NR-06 / ADR-010 / INV-26）：
 * - 密钥只从 env 进（GATEWAY_CHANNELS 内联 apiKey，或 apiKeyEnv 指向独立 env 变量），
 *   不落库、不进任何 VO、不进日志（本文件所有日志只打 channelCode/统计，绝不打 key 值）；
 * - GatewayChannelDefinition 含密钥引用，类型仅限 src/platform/gateway/ 包内流转；
 * - 未配置/配置非法时回落内置 MOCK 渠道（v1 ChannelProperties 默认值语义）。
 */

/** 模型定义（注册表，无密钥字段） */
interface GatewayModelDefinition {
  modelCode: string;
  modelName: string;
  capabilityTags: string[];
  enabled: boolean;
}

/** 渠道定义（含密钥引用——不出 gateway 包，INV-26） */
interface GatewayChannelDefinition {
  channelCode: string;
  channelName: string;
  priority: number;
  enabled: boolean;
  /** 密钥（env 内联值；与 apiKeyEnv 二选一，均只存在于进程内存） */
  apiKey?: string;
  /** 密钥所在环境变量名（推荐：GATEWAY_CHANNELS 本体可入库房配置而不带密值） */
  apiKeyEnv?: string;
  /** 真实适配器 API 基址（MOCK 渠道可空） */
  apiBaseUrl?: string;
  models: GatewayModelDefinition[];
}

/** 网关运行时配置（进程内只读快照） */
export interface GatewayRuntimeConfig {
  channels: GatewayChannelDefinition[];
  /** 单用户并发执行上限（INV-25：并发任务 ≤3/用户，超出排队） */
  maxConcurrentPerUser: number;
  /** provider 调用超时（毫秒） */
  providerTimeoutMillis: number;
  /** 全局在飞任务上限（v1 dispatchThreads 语义；Node 单线程仅作背压闸） */
  globalDispatchConcurrency: number;
}

/** 密钥引用类型（仅 gateway 包内使用；对外视图永不包含） */
export type { GatewayChannelDefinition, GatewayModelDefinition };

const logger = new Logger('GatewayConfig');

/** 内置默认渠道（v1 ChannelProperties#buildDefaultChannels 原样平移） */
function buildDefaultChannels(): GatewayChannelDefinition[] {
  return [
    {
      channelCode: 'MOCK',
      channelName: '内置模拟渠道',
      priority: 100,
      enabled: true,
      // 合成 mock key 非真实密钥；可经 GATEWAY_MOCK_API_KEY 覆盖
      apiKey: process.env.GATEWAY_MOCK_API_KEY ?? 'local-mock-key-not-a-secret',
      models: [
        {
          modelCode: 'MOCK-LITE',
          modelName: '模拟轻量模型',
          capabilityTags: ['OUTLINE', 'FULL_GENERATE', 'FULL_ADJUST', 'TARGETED_ADJUST'],
          enabled: true,
        },
      ],
    },
  ];
}

/* ---------- env JSON 解析（防御式；异常回落 MOCK，绝不回显配置内容） ---------- */

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseModel(raw: unknown): GatewayModelDefinition | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const modelCode = asString(record.modelCode);
  if (modelCode === undefined) {
    return null;
  }
  return {
    modelCode,
    modelName: asString(record.modelName) ?? modelCode,
    capabilityTags: Array.isArray(record.capabilityTags)
      ? record.capabilityTags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    enabled: asBoolean(record.enabled, true),
  };
}

function parseChannel(raw: unknown): GatewayChannelDefinition | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const channelCode = asString(record.channelCode);
  if (channelCode === undefined) {
    logger.warn('GATEWAY_CHANNELS 存在缺 channelCode 的条目，已跳过');
    return null;
  }
  const models = (Array.isArray(record.models) ? record.models : [])
    .map((model) => parseModel(model))
    .filter((model): model is GatewayModelDefinition => model !== null);
  return {
    channelCode,
    channelName: asString(record.channelName) ?? channelCode,
    priority: asNumber(record.priority, 0),
    enabled: asBoolean(record.enabled, true),
    apiKey: asString(record.apiKey),
    apiKeyEnv: asString(record.apiKeyEnv),
    apiBaseUrl: asString(record.apiBaseUrl),
    models,
  };
}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * 解析 env GATEWAY_CHANNELS（渠道管理端首次导入复用）。
 * 未配置/解析失败/空数组 → []（不回落 MOCK：调用方自行决定兜底）。
 */
export function parseEnvChannelDefinitions(): GatewayChannelDefinition[] {
  const raw = process.env.GATEWAY_CHANNELS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.warn('GATEWAY_CHANNELS 须为 JSON 数组（导入跳过）');
      return [];
    }
    const channels = parsed
      .map(parseChannel)
      .filter((channel): channel is GatewayChannelDefinition => channel !== null);
    if (channels.length === 0) {
      logger.warn('GATEWAY_CHANNELS 未解析出任何有效渠道（导入跳过）');
    }
    return channels;
  } catch {
    // 不打 raw 内容（可能含密钥）
    logger.warn('GATEWAY_CHANNELS JSON 解析失败（导入跳过）');
    return [];
  }
}

/** 内置 MOCK 渠道定义（管理端 seed 复用；合成 key 非真实密钥） */
export function buildBuiltinMockChannel(): GatewayChannelDefinition {
  return buildDefaultChannels()[0];
}

/** 运行时旋钮（并发/超时，env 直读；快照重建时随取） */
export function loadRuntimeKnobs() {
  return {
    maxConcurrentPerUser: parseIntEnv('GATEWAY_MAX_CONCURRENT_PER_USER', 3, 1, 100),
    providerTimeoutMillis: parseIntEnv('GATEWAY_PROVIDER_TIMEOUT_MILLIS', 60_000, 1_000, 600_000),
    globalDispatchConcurrency: parseIntEnv('GATEWAY_DISPATCH_CONCURRENCY', 8, 1, 256),
  };
}

/** DI token（已废弃：渠道管理端改造后由 GatewayRuntimeStore 取代，保留空导出防外部引用断裂） */
