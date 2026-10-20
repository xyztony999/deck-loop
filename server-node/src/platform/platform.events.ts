/**
 * platform 域事件契约（api-platform §4.5，v1 businessType 冻结）。
 * EventEmitter2 进程内发布；**必须数据库写入成功（提交）之后发布**（NR-07）。
 * 原 v1 MQ Producer/Consumer → 事件发布/@OnEvent 订阅（06 §5）。
 */

/** 任务状态推进（订阅方：SSE 下发、同步游标分配） */
export const GW_TASK_ADVANCED = 'gw_task_advanced';

/** 用量入账（订阅方：统计聚合 D-01 channel 域） */
export const GW_USAGE_RECORDED = 'gw_usage_recorded';

/** gw_task_advanced 载荷（v1 GwMqMessage 对齐，businessType 由事件名承载） */
export interface GwTaskAdvancedPayload {
  taskId: string;
  /** TaskStatus.code（RUNNING/SUCCEEDED/FAILED/CANCELLED） */
  taskStatus: string;
  /** 属主（SSE 定向） */
  userId: string;
  /** 归属创作物（SSE deckId 过滤；可空） */
  deckId?: string;
  percent: number;
  stageText: string;
}

/** gw_usage_recorded 载荷（契约字段：usageId/taskId/tokens；userId/deckId 为 SSE/统计扩展） */
export interface GwUsageRecordedPayload {
  usageId: string;
  taskId: string;
  userId: string;
  deckId?: string;
  promptTokens: number;
  completionTokens: number;
}
