import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * 用量计量实体 —— dl_usage_record（api-platform §5.3，日志型只追加）。
 *
 * - 日志型 collection（06 §3.1）：只 insertOne，无 data_version/delete_sign/审计六件套
 * - 引用仅存业务 id：user_id/task_id（跨聚合）；channel_code/model_code 为路由快照
 * - 索引（§3.5 声明式）：uk_usage_id unique、idx_user_time{user_id,occurred_at}、idx_task{task_id}
 */
@Schema({ collection: 'dl_usage_record', versionKey: false, timestamps: false })
export class UsageRecord {
  /** 业务主键（雪花串） */
  @Prop({ type: String, required: true })
  usage_id!: string;

  /** 属主（隔离字段，ADR-005；冗余自任务快照，服务端注入） */
  @Prop({ type: String, required: true })
  user_id!: string;

  /** 来源任务（dl_generation_task.task_id） */
  @Prop({ type: String, required: true })
  task_id!: string;

  /** 任务类型：TaskType */
  @Prop({ type: String, required: true })
  task_type!: string;

  /** 渠道编码（路由快照） */
  @Prop({ type: String, required: true })
  channel_code!: string;

  /** 模型编码（路由快照） */
  @Prop({ type: String, required: true })
  model_code!: string;

  /** 输入 token */
  @Prop({ type: Number, required: true, default: 0 })
  prompt_tokens!: number;

  /** 输出 token */
  @Prop({ type: Number, required: true, default: 0 })
  completion_tokens!: number;

  /** 发生时间（写时分配） */
  @Prop({ type: Date, required: true })
  occurred_at!: Date;
}

export type UsageRecordDocument = HydratedDocument<UsageRecord>;

export const UsageRecordSchema = SchemaFactory.createForClass(UsageRecord);
UsageRecordSchema.index({ usage_id: 1 }, { unique: true, name: 'uk_usage_id' });
UsageRecordSchema.index({ user_id: 1, occurred_at: 1 }, { name: 'idx_user_time' });
UsageRecordSchema.index({ task_id: 1 }, { name: 'idx_task' });
