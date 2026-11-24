/**
 * 用量计量只读投影（dl_usage_record，api-channel D2 / api-platform §4.1；ADR-016）。
 *
 * - 数据源属 platform 网关域（任务成功路径只追加写入），channel 域仅跨模块聚合读、不写。
 * - ADR-016（TypeORM）：每物理表单一 entity——dl_usage_record 权威 entity 为 platform 域
 *   `UsageRecord`。本只读投影**不再独立 entity**，`ChannelRepository.aggregateUsage`
 *   以 SQL 直查 dl_usage_record（服务端静态构造，维度白名单，NR-02/03）。
 * - 本文件仅保留表名常量与聚合消费字段形状（plain interface，无装饰器）。
 */

/** 物理表名（与 platform 域 UsageRecord entity 同表） */
export const CHANNEL_USAGE_RECORD_TABLE = 'dl_usage_record';

/** 聚合消费字段形状（只读投影） */
export interface ChannelUsageRecordRow {
  usage_id?: string;
  user_id: string;
  task_id: string;
  task_type: string;
  channel_code: string;
  model_code?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  occurred_at: Date;
}