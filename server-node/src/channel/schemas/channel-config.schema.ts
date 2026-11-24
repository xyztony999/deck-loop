import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 渠道配置聚合根 entity（dl_channel；渠道管理端，channel-admin-2026-10-23 §2；ADR-016 TypeORM）。
 *
 * - 渠道/模型定义唯一权威来源（env GATEWAY_CHANNELS 仅作首次导入引导）；
 * - apiKey 只存 AES-256-GCM 密文（api_key_cipher），主密钥 env CONFIG_ENC_KEY；
 * - builtin=true 为内置 MOCK 渠道（只读，仅可启停）；
 * - 不做物理删除（dl_usage_record 引用渠道编码），仅启停。
 * - 业务主键 channel_code = 表主键（取代 ObjectId，NR-08）；models 整体嵌入 jsonb。
 * - platform/gateway 持同表只读投影（快照加载，SQL 直查，不再独立 entity）。
 */
@Entity('dl_channel')
export class ChannelConfig {
  @PrimaryColumn({ type: 'varchar' })
  channel_code!: string;

  @Column({ type: 'varchar' })
  channel_name!: string;

  @Column({ type: 'varchar', default: '' })
  api_base_url!: string;

  @Column({ type: 'varchar', default: '' })
  api_key_cipher!: string;

  @Column({ type: 'varchar', default: '' })
  api_key_env!: string;

  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'boolean', default: false })
  builtin!: boolean;

  /** 来源：builtin 内置 / env-import 首次导入 / admin 管理端创建 */
  @Column({ type: 'varchar', default: 'admin' })
  source!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  models!: ChannelConfigModel[];

  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  created_time?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  updated_by?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  updated_time?: Date | null;

  @Column({ type: 'int', default: 0 })
  data_version!: number;
}

export interface ChannelConfigModel {
  model_code: string;
  model_name: string;
  capability_tags: string[];
  enabled: boolean;
}

/** 文档类型别名（ADR-016：TypeORM entity 即行类型；保留旧名以兼容仓储 import） */
export type ChannelConfigDocument = ChannelConfig;