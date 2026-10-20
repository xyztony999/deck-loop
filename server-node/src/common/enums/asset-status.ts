/**
 * 业务枚举 AssetStatus —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「AssetStatus」
 * 使用对象：dl_asset.asset_status（api-assets）。主数据启停生命周期，无状态机。
 * D4 消费色标：ACTIVE→green · DISABLED→gray。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const AssetStatus = {
  /** 启用 */
  ACTIVE: 'ACTIVE',
  /** 停用 */
  DISABLED: 'DISABLED',
} as const;

export type AssetStatusCode = (typeof AssetStatus)[keyof typeof AssetStatus];

const ASSET_STATUS_LABELS: Record<AssetStatusCode, string> = {
  [AssetStatus.ACTIVE]: '启用',
  [AssetStatus.DISABLED]: '停用',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getAssetStatusLabel(code: string): string {
  return ASSET_STATUS_LABELS[code as AssetStatusCode] ?? code;
}
