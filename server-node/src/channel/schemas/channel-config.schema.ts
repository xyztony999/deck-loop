import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Document, HydratedDocument } from 'mongoose';

/**
 * 渠道配置聚合根（dl_channel；渠道管理端，channel-admin-2026-10-23 §2）。
 *
 * - 渠道/模型定义唯一权威来源（env GATEWAY_CHANNELS 仅作首次导入引导）；
 * - apiKey 只存 AES-256-GCM 密文（api_key_cipher），主密钥 env CONFIG_ENC_KEY；
 * - builtin=true 为内置 MOCK 渠道（只读，仅可启停）；
 * - 不做物理删除（dl_channel_usage_record 引用渠道编码），仅启停。
 */
@Schema({ collection: 'dl_channel' })
export class ChannelConfig {
  @Prop({ type: String, required: true, unique: true })
  channel_code!: string;

  @Prop({ type: String, required: true })
  channel_name!: string;

  @Prop({ type: String, default: '' })
  api_base_url!: string;

  @Prop({ type: String, default: '' })
  api_key_cipher!: string;

  @Prop({ type: String, default: '' })
  api_key_env!: string;

  @Prop({ type: Number, default: 0 })
  priority!: number;

  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: Boolean, default: false })
  builtin!: boolean;

  /** 来源：builtin 内置 / env-import 首次导入 / admin 管理端创建 */
  @Prop({ type: String, default: 'admin' })
  source!: string;

  @Prop({
    type: [
      {
        model_code: { type: String, required: true },
        model_name: { type: String, required: true },
        capability_tags: { type: [String], default: [] },
        enabled: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  models!: ChannelConfigModel[];

  @Prop({ type: String })
  created_by?: string;

  @Prop({ type: Date })
  created_time?: Date;

  @Prop({ type: String })
  updated_by?: string;

  @Prop({ type: Date })
  updated_time?: Date;

  @Prop({ type: Number, default: 0 })
  data_version!: number;
}

export interface ChannelConfigModel {
  model_code: string;
  model_name: string;
  capability_tags: string[];
  enabled: boolean;
}

export type ChannelConfigDocument = HydratedDocument<ChannelConfig>;
export type ChannelConfigModelType = ChannelConfig & Document;

export const ChannelConfigSchema = SchemaFactory.createForClass(ChannelConfig);
