/**
 * 业务枚举 AccountStatus —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「AccountStatus」
 * 使用对象：dl_account.account_status（api-platform）。账号启停，无状态机。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const AccountStatus = {
  /** 正常 */
  ACTIVE: 'ACTIVE',
  /** 已锁定 */
  LOCKED: 'LOCKED',
} as const;

export type AccountStatusCode = (typeof AccountStatus)[keyof typeof AccountStatus];

const ACCOUNT_STATUS_LABELS: Record<AccountStatusCode, string> = {
  [AccountStatus.ACTIVE]: '正常',
  [AccountStatus.LOCKED]: '已锁定',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getAccountStatusLabel(code: string): string {
  return ACCOUNT_STATUS_LABELS[code as AccountStatusCode] ?? code;
}
