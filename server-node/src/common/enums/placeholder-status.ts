/**
 * 公共枚举 PlaceholderStatus —— 池来源：workspace/01-solution/common-spec/03-common-enums.md「PlaceholderStatus」
 * 话术占位符校验结果（P2 过程数据，不落库）：OK=已替换 / MISSING=未替换
 * （api-adjustment INV-10：提交前占位符必须全部替换）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const PlaceholderStatus = {
  /** 已替换 */
  OK: 'OK',
  /** 未替换 */
  MISSING: 'MISSING',
} as const;

export type PlaceholderStatusCode = (typeof PlaceholderStatus)[keyof typeof PlaceholderStatus];

const PLACEHOLDER_STATUS_LABELS: Record<PlaceholderStatusCode, string> = {
  [PlaceholderStatus.OK]: '已替换',
  [PlaceholderStatus.MISSING]: '未替换',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getPlaceholderStatusLabel(code: string): string {
  return PLACEHOLDER_STATUS_LABELS[code as PlaceholderStatusCode] ?? code;
}
