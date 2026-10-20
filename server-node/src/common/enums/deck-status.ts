/**
 * 业务枚举 DeckStatus —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「DeckStatus」
 * 使用对象：dl_deck.deck_status（api-deck）。
 * 状态机（api-deck §4.2）：DRAFT→ITERATING（首版生成成功回调，自动）；ITERATING→FINALIZED（finalize）；
 * FINALIZED→ITERATING（unfinalize）；→ARCHIVED（archive，记录 archivedFromStatus）；
 * ARCHIVED→archivedFromStatus（restore）；仅 ARCHIVED 可软删除。
 * D4 消费色标：DRAFT→gray · ITERATING→blue · FINALIZED→green · ARCHIVED→gray。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const DeckStatus = {
  /** 草稿 */
  DRAFT: 'DRAFT',
  /** 迭代中 */
  ITERATING: 'ITERATING',
  /** 已定稿 */
  FINALIZED: 'FINALIZED',
  /** 已归档 */
  ARCHIVED: 'ARCHIVED',
} as const;

export type DeckStatusCode = (typeof DeckStatus)[keyof typeof DeckStatus];

const DECK_STATUS_LABELS: Record<DeckStatusCode, string> = {
  [DeckStatus.DRAFT]: '草稿',
  [DeckStatus.ITERATING]: '迭代中',
  [DeckStatus.FINALIZED]: '已定稿',
  [DeckStatus.ARCHIVED]: '已归档',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getDeckStatusLabel(code: string): string {
  return DECK_STATUS_LABELS[code as DeckStatusCode] ?? code;
}
