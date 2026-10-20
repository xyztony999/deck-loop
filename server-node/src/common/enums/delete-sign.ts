/**
 * 公共枚举 DeleteSign —— 池来源：workspace/01-solution/common-spec/03-common-enums.md「DeleteSign」
 * 逻辑删除标记（Mongo number）：0=未删除 / 1=已删除（查询默认过滤 0）。
 * 不可变集合（dl_deck_version）与日志集合（dl_usage_record）不使用。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const DeleteSign = {
  /** 未删除 */
  NOT_DELETED: 0,
  /** 已删除 */
  DELETED: 1,
} as const;

export type DeleteSignCode = (typeof DeleteSign)[keyof typeof DeleteSign];

const DELETE_SIGN_LABELS: Record<DeleteSignCode, string> = {
  [DeleteSign.NOT_DELETED]: '未删除',
  [DeleteSign.DELETED]: '已删除',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getDeleteSignLabel(code: number): string {
  return DELETE_SIGN_LABELS[code as DeleteSignCode] ?? String(code);
}
