import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

/**
 * 用量计量实体 —— dl_usage_record（api-platform §5.3，日志型只追加；ADR-016 TypeORM entity）。
 *
 * - 日志型表（06 §3.1）：只 insert，无 data_version/delete_sign/审计六件套
 * - 引用仅存业务 id：user_id/task_id（跨聚合）；channel_code/model_code 为路由快照
 * - 索引（§3.5 声明式）：idx_user_time{user_id,occurred_at}、idx_task{task_id}；usage_id 主键即唯一
 * - channel 域用量聚合只读消费本表（ChannelUsageRecordRow 投影消解为 SQL，ADR-016）
 */
@Entity('dl_usage_record')
@Index('idx_user_time', ['user_id', 'occurred_at'])
@Index('idx_task', ['task_id'])
export class UsageRecord {
  /** 业务主键（雪花串） */
  @PrimaryColumn({ type: 'varchar' })
  usage_id!: string;

  /** 属主（隔离字段，ADR-005；冗余自任务快照，服务端注入） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 来源任务（dl_generation_task.task_id） */
  @Column({ type: 'varchar' })
  task_id!: string;

  /** 任务类型：TaskType */
  @Column({ type: 'varchar' })
  task_type!: string;

  /** 渠道编码（路由快照） */
  @Column({ type: 'varchar' })
  channel_code!: string;

  /** 模型编码（路由快照） */
  @Column({ type: 'varchar' })
  model_code!: string;

  /** 输入 token */
  @Column({ type: 'int', default: 0 })
  prompt_tokens!: number;

  /** 输出 token */
  @Column({ type: 'int', default: 0 })
  completion_tokens!: number;

  /** 发生时间（写时分配） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE })
  occurred_at!: Date;
}