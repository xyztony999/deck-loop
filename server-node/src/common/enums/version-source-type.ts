/**
 * 业务枚举 VersionSourceType —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「VersionSourceType」
 * 使用对象：dl_deck_version.source_type（api-version）。注意：不含 OUTLINE（大纲不留档版本）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const VersionSourceType = {
  /** 整稿生成 */
  FULL_GENERATE: 'FULL_GENERATE',
  /** 整稿调整 */
  FULL_ADJUST: 'FULL_ADJUST',
  /** 定向调整 */
  TARGETED_ADJUST: 'TARGETED_ADJUST',
} as const;

export type VersionSourceTypeCode = (typeof VersionSourceType)[keyof typeof VersionSourceType];

const VERSION_SOURCE_TYPE_LABELS: Record<VersionSourceTypeCode, string> = {
  [VersionSourceType.FULL_GENERATE]: '整稿生成',
  [VersionSourceType.FULL_ADJUST]: '整稿调整',
  [VersionSourceType.TARGETED_ADJUST]: '定向调整',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getVersionSourceTypeLabel(code: string): string {
  return VERSION_SOURCE_TYPE_LABELS[code as VersionSourceTypeCode] ?? code;
}
