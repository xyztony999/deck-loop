/**
 * 业务枚举 ExportStatus —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「ExportStatus」
 * 使用对象：dl_export_task.export_status（api-delivery）。
 * 状态机：QUEUED→RENDERING→SUCCEEDED/FAILED；QUEUED/RENDERING→CANCELLED（渲染回调幂等）。
 * D4 消费色标：QUEUED→gray · RENDERING→blue · SUCCEEDED→green · FAILED→red · CANCELLED→gray。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const ExportStatus = {
  /** 排队中 */
  QUEUED: 'QUEUED',
  /** 渲染中 */
  RENDERING: 'RENDERING',
  /** 已成功 */
  SUCCEEDED: 'SUCCEEDED',
  /** 已失败 */
  FAILED: 'FAILED',
  /** 已取消 */
  CANCELLED: 'CANCELLED',
} as const;

export type ExportStatusCode = (typeof ExportStatus)[keyof typeof ExportStatus];

const EXPORT_STATUS_LABELS: Record<ExportStatusCode, string> = {
  [ExportStatus.QUEUED]: '排队中',
  [ExportStatus.RENDERING]: '渲染中',
  [ExportStatus.SUCCEEDED]: '已成功',
  [ExportStatus.FAILED]: '已失败',
  [ExportStatus.CANCELLED]: '已取消',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getExportStatusLabel(code: string): string {
  return EXPORT_STATUS_LABELS[code as ExportStatusCode] ?? code;
}
