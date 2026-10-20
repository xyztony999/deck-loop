/**
 * 公共枚举 SyncChangeOp —— 池来源：workspace/01-solution/common-spec/03-common-enums.md「SyncChangeOp」
 * 多端同步变更类型（P-02 / POST /auth/sync/pull）——v3 复议恢复活跃（ADR-013 修订）：
 * UPSERT=upsert / DELETE=删除。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const SyncChangeOp = {
  /** upsert */
  UPSERT: 'UPSERT',
  /** 删除 */
  DELETE: 'DELETE',
} as const;

export type SyncChangeOpCode = (typeof SyncChangeOp)[keyof typeof SyncChangeOp];

const SYNC_CHANGE_OP_LABELS: Record<SyncChangeOpCode, string> = {
  [SyncChangeOp.UPSERT]: 'upsert',
  [SyncChangeOp.DELETE]: '删除',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getSyncChangeOpLabel(code: string): string {
  return SYNC_CHANGE_OP_LABELS[code as SyncChangeOpCode] ?? code;
}
