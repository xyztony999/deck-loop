/**
 * dl_channel 只读投影（platform/gateway 侧；渠道管理端，channel-admin-2026-10-23 §3；ADR-016）。
 *
 * 领域权威 entity 在 channel/schemas/channel-config.schema.ts（ChannelConfig）。
 * ADR-016（TypeORM）：每物理表单一 entity——本投影**不再独立 schema**，
 * `GatewayRuntimeStore` 以 SQL 直查 dl_channel（只读快照加载，不 import channel 域 entity，
 * 保持 platform→channel 零编译依赖的防腐边界）。本文件仅保留表名常量与快照字段形状。
 */

/** 物理表名（与 channel 域 ChannelConfig entity 同表） */
export const CHANNEL_CONFIG_TABLE = 'dl_channel';

/** 快照加载所需模型项形状 */
export interface ChannelConfigModelItem {
  model_code: string;
  model_name: string;
  capability_tags: string[];
  enabled: boolean;
}

/** 快照加载所需渠道行形状（只读投影） */
export interface ChannelConfigDoc {
  channel_code: string;
  channel_name: string;
  api_base_url: string;
  api_key_cipher: string;
  api_key_env: string;
  priority: number;
  enabled: boolean;
  builtin: boolean;
  source: string;
  models: ChannelConfigModelItem[];
}