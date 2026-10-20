import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * 用量计量只读视图（dl_usage_record，api-channel D2 / api-platform §4.1）：
 * - 数据源属 platform 网关域（任务成功路径只追加写入），channel 域仅跨模块聚合读、不写
 * - 日志型表：无 data_version/delete_sign/审计字段（规约日志表）
 * - 模型名 ChannelUsageRecordRow 与 platform 域写入侧模型隔离（v1 同名先例：
 *   ChannelUsageRecordRow vs UsageRecordEntity，避免跨模块同名混淆）
 * - 只声明本域消费字段；aggregate 管道在 channel.repository.ts 服务端静态构造
 */

@Schema({ collection: 'dl_usage_record', versionKey: false })
export class ChannelUsageRecordRow {
  /** 业务主键（雪花串；仅声明，聚合不使用） */
  @Prop({ type: String })
  usage_id?: string;

  /** 属主（隔离字段 ADR-005；聚合 $match 值） */
  @Prop({ type: String })
  user_id!: string;

  /** 来源任务（dl_generation_task.task_id；DECK 维度 $lookup 关联键） */
  @Prop({ type: String })
  task_id!: string;

  /** 任务类型：TaskType（TASK_TYPE 维度 $group 键，白名单映射） */
  @Prop({ type: String })
  task_type!: string;

  /** 渠道编码（路由快照；CHANNEL 维度 $group 键，白名单映射） */
  @Prop({ type: String })
  channel_code!: string;

  /** 模型编码（路由快照） */
  @Prop({ type: String })
  model_code?: string | null;

  /** 输入 token（$sum 聚合，null 容错 $ifNull 0） */
  @Prop({ type: Number })
  prompt_tokens?: number | null;

  /** 输出 token */
  @Prop({ type: Number })
  completion_tokens?: number | null;

  /** 发生时间（写时分配；$match 时间范围 / $max 最近使用） */
  @Prop({ type: Date })
  occurred_at!: Date;
}

export type ChannelUsageRecordRowDocument = HydratedDocument<ChannelUsageRecordRow>;

export const ChannelUsageRecordRowSchema = SchemaFactory.createForClass(ChannelUsageRecordRow);
