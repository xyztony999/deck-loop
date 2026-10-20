/**
 * 业务枚举 DeckType —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「DeckType」
 * 使用对象：dl_deck.deck_type（api-deck）；首期仅 DECK。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6：const 对象 + getXxxLabel，禁跨模块重复定义）。
 */
export const DeckType = {
  /** 演示文稿 */
  DECK: 'DECK',
  /** 文档（预留） */
  DOC: 'DOC',
  /** 海报（预留） */
  POSTER: 'POSTER',
} as const;

export type DeckTypeCode = (typeof DeckType)[keyof typeof DeckType];

const DECK_TYPE_LABELS: Record<DeckTypeCode, string> = {
  [DeckType.DECK]: '演示文稿',
  [DeckType.DOC]: '文档（预留）',
  [DeckType.POSTER]: '海报（预留）',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getDeckTypeLabel(code: string): string {
  return DECK_TYPE_LABELS[code as DeckTypeCode] ?? code;
}
