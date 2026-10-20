/**
 * 业务枚举 TaskStatus —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「TaskStatus」
 * 使用对象：dl_generation_task.task_status（api-generation；网关侧同一状态机推进，api-platform §4.2）。
 * 状态机：QUEUED→RUNNING→SUCCEEDED/FAILED；QUEUED/RUNNING→CANCELLED（回调幂等键=taskId+期望前置状态）。
 * D4 消费色标：QUEUED→gray · RUNNING→blue · SUCCEEDED→green · FAILED→red · CANCELLED→gray。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const TaskStatus = {
  /** 排队中 */
  QUEUED: 'QUEUED',
  /** 执行中 */
  RUNNING: 'RUNNING',
  /** 已成功 */
  SUCCEEDED: 'SUCCEEDED',
  /** 已失败 */
  FAILED: 'FAILED',
  /** 已取消 */
  CANCELLED: 'CANCELLED',
} as const;

export type TaskStatusCode = (typeof TaskStatus)[keyof typeof TaskStatus];

const TASK_STATUS_LABELS: Record<TaskStatusCode, string> = {
  [TaskStatus.QUEUED]: '排队中',
  [TaskStatus.RUNNING]: '执行中',
  [TaskStatus.SUCCEEDED]: '已成功',
  [TaskStatus.FAILED]: '已失败',
  [TaskStatus.CANCELLED]: '已取消',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getTaskStatusLabel(code: string): string {
  return TASK_STATUS_LABELS[code as TaskStatusCode] ?? code;
}
