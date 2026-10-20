/**
 * 业务枚举 AssetType —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「AssetType」
 * 使用对象：dl_asset.asset_type（api-assets）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const AssetType = {
  /** 图片 */
  IMAGE: 'IMAGE',
  /** 标志 */
  LOGO: 'LOGO',
} as const;

export type AssetTypeCode = (typeof AssetType)[keyof typeof AssetType];

const ASSET_TYPE_LABELS: Record<AssetTypeCode, string> = {
  [AssetType.IMAGE]: '图片',
  [AssetType.LOGO]: '标志',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getAssetTypeLabel(code: string): string {
  return ASSET_TYPE_LABELS[code as AssetTypeCode] ?? code;
}
