/**
 * 业务枚举 TaskType —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「TaskType」
 * 使用对象：dl_generation_task.task_type / dl_usage_record.task_type
 * （api-generation / api-adjustment / api-platform；四类共用 GenerationTask 子流程）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const TaskType = {
  /** 大纲生成 */
  OUTLINE: 'OUTLINE',
  /** 整稿生成 */
  FULL_GENERATE: 'FULL_GENERATE',
  /** 整稿调整 */
  FULL_ADJUST: 'FULL_ADJUST',
  /** 定向调整 */
  TARGETED_ADJUST: 'TARGETED_ADJUST',
} as const;

export type TaskTypeCode = (typeof TaskType)[keyof typeof TaskType];

const TASK_TYPE_LABELS: Record<TaskTypeCode, string> = {
  [TaskType.OUTLINE]: '大纲生成',
  [TaskType.FULL_GENERATE]: '整稿生成',
  [TaskType.FULL_ADJUST]: '整稿调整',
  [TaskType.TARGETED_ADJUST]: '定向调整',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getTaskTypeLabel(code: string): string {
  return TASK_TYPE_LABELS[code as TaskTypeCode] ?? code;
}
