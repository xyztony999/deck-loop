/**
 * 业务枚举 TargetKind —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「TargetKind」
 * 使用对象：调整指令快照 scope（api-adjustment §4.1 targetKind；TARGETED_ADJUST 必填）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const TargetKind = {
  /** 页 */
  PAGE: 'PAGE',
  /** 文本块 */
  TEXT_BLOCK: 'TEXT_BLOCK',
  /** 图片元素 */
  IMAGE_BLOCK: 'IMAGE_BLOCK',
} as const;

export type TargetKindCode = (typeof TargetKind)[keyof typeof TargetKind];

const TARGET_KIND_LABELS: Record<TargetKindCode, string> = {
  [TargetKind.PAGE]: '页',
  [TargetKind.TEXT_BLOCK]: '文本块',
  [TargetKind.IMAGE_BLOCK]: '图片元素',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getTargetKindLabel(code: string): string {
  return TARGET_KIND_LABELS[code as TargetKindCode] ?? code;
}
