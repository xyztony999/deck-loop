/**
 * deck-loop 枚举池统一出口（node-specs 20 §6：const 对象 + getLabelByCode，禁跨模块重复定义）。
 *
 * 17 枚举 = 业务枚举池 12（01-solution/common-spec/04-business-enum.md）
 *        + 公共枚举 5（01-solution/common-spec/03-common-enums.md，SyncChangeOp 活跃）。
 * 域代码统一 `import { DeckStatus, getDeckStatusLabel } from '../common/enums'`（或深路径），
 * 不得在本域重复定义同义枚举。
 */

/* ---------- 业务枚举（04-business-enum.md，12） ---------- */
export * from './deck-type';
export * from './deck-status';
export * from './task-type';
export * from './task-status';
export * from './version-source-type';
export * from './target-kind';
export * from './export-format';
export * from './export-status';
export * from './asset-type';
export * from './asset-status';
export * from './template-scene';
export * from './account-status';

/* ---------- 公共枚举（03-common-enums.md，5） ---------- */
export * from './yes-no';
export * from './delete-sign';
export * from './sort-direction';
export * from './sync-change-op';
export * from './placeholder-status';

/**
 * 统一 label 反查 helper（各 getXxxLabel 的通用形态）：
 * 传入「Record<code,label>」与任意入参 code，未匹配回显 code 本身。
 */
export function getLabelByCode<T extends string | number>(
  labels: Record<T, string>,
  code: string | number,
): string {
  return (labels as Record<string | number, string>)[code] ?? String(code);
}

/**
 * 枚举 → SelectOption[]（各域 POST /{domain}/dict/batch 字典端点共用，防 8 处重复实现）。
 * 示例：enumToSelectOptions(DeckStatus, { [DeckStatus.DRAFT]: getDeckStatusLabel(DeckStatus.DRAFT), ... })
 */
export function enumToSelectOptions<T extends string | number>(
  enumDef: Record<string, T>,
  labels: Record<T, string>,
): Array<{ value: T; label: string }> {
  return Object.values(enumDef).map((code) => ({ value: code, label: labels[code] ?? String(code) }));
}
