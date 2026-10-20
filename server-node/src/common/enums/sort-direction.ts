/**
 * 公共枚举 SortDirection —— 池来源：workspace/01-solution/common-spec/03-common-enums.md「SortDirection」
 * 列表排序参数：ASC=升序 / DESC=降序。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const SortDirection = {
  /** 升序 */
  ASC: 'ASC',
  /** 降序 */
  DESC: 'DESC',
} as const;

export type SortDirectionCode = (typeof SortDirection)[keyof typeof SortDirection];

const SORT_DIRECTION_LABELS: Record<SortDirectionCode, string> = {
  [SortDirection.ASC]: '升序',
  [SortDirection.DESC]: '降序',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getSortDirectionLabel(code: string): string {
  return SORT_DIRECTION_LABELS[code as SortDirectionCode] ?? code;
}
