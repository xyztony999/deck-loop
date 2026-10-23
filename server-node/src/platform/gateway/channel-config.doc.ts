import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Document } from 'mongoose';

/**
 * dl_channel 只读投影（platform/gateway 侧；渠道管理端，channel-admin-2026-10-23 §3）。
 * 领域权威 schema 在 channel/schemas/channel-config.schema.ts——本文件仅声明网关
 * 快照加载所需字段（同集合双投影，platform 不 import channel 域 schema）。
 */
export class ChannelConfigModelItem {
  @Prop({ type: String, required: true })
  model_code!: string;

  @Prop({ type: String, required: true })
  model_name!: string;

  @Prop({ type: [String], default: [] })
  capability_tags!: string[];

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;
}

@Schema({ collection: 'dl_channel' })
export class ChannelConfigDoc {
  @Prop({ type: String, required: true })
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

  /** 来源：builtin 内置 / env-import 首次导入 / admin 管理端创建（与权威 schema 对齐，防 strict 剥离） */
  @Prop({ type: String, default: 'admin' })
  source!: string;

  @Prop({ type: [{ model_code: String, model_name: String, capability_tags: [String], enabled: Boolean }], default: [] })
  models!: ChannelConfigModelItem[];
}

export type ChannelConfigDocument = ChannelConfigDoc & Document;

export const ChannelConfigSchema = SchemaFactory.createForClass(ChannelConfigDoc);
