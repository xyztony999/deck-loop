/**
 * 业务枚举 ExportFormat —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「ExportFormat」
 * 使用对象：dl_export_task.export_format（api-delivery）。PPTX 为 beta（needConfirm 提示）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const ExportFormat = {
  /** PDF 文件 */
  PDF: 'PDF',
  /** 图片包 */
  IMAGES: 'IMAGES',
  /** PPTX（beta） */
  PPTX: 'PPTX',
} as const;

export type ExportFormatCode = (typeof ExportFormat)[keyof typeof ExportFormat];

const EXPORT_FORMAT_LABELS: Record<ExportFormatCode, string> = {
  [ExportFormat.PDF]: 'PDF 文件',
  [ExportFormat.IMAGES]: '图片包',
  [ExportFormat.PPTX]: 'PPTX（beta）',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getExportFormatLabel(code: string): string {
  return EXPORT_FORMAT_LABELS[code as ExportFormatCode] ?? code;
}
