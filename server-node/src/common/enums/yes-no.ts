/**
 * 公共枚举 YesNo —— 池来源：workspace/01-solution/common-spec/03-common-enums.md「YesNo」
 * INT(1) 标志位（Mongo number）：1=是 / 0=否。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const YesNo = {
  /** 是 */
  YES: 1,
  /** 否 */
  NO: 0,
} as const;

export type YesNoCode = (typeof YesNo)[keyof typeof YesNo];

const YES_NO_LABELS: Record<YesNoCode, string> = {
  [YesNo.YES]: '是',
  [YesNo.NO]: '否',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getYesNoLabel(code: number): string {
  return YES_NO_LABELS[code as YesNoCode] ?? String(code);
}
