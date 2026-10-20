/**
 * adjustment 域错误码 —— 契约来源：api-adjustment.md §3.4（v1 冻结，禁增删改值）。
 * 前缀 BIZ_ADJUST_*（对应 v1 AdjustmentErrorCodeConstants）。
 * 任务级错误（互斥/不可取消）复用 generation 域 generation.errors.ts，不重复定义。
 * 用法：throw new BizException(ADJUST_SCOPE_INVALID, ADJUST_SCOPE_INVALID_MSG)。
 */

/** BIZ_ADJUST_SCOPE_INVALID：目标作用域无效（pageId/blockId 不在基线版本内容中，INV-9） */
export const ADJUST_SCOPE_INVALID = 'BIZ_ADJUST_SCOPE_INVALID';
export const ADJUST_SCOPE_INVALID_MSG = '调整目标不存在或已失效';

/** BIZ_ADJUST_BASE_VERSION_INVALID：基线版本无效（不存在/不属于该 deck/内容为空） */
export const ADJUST_BASE_VERSION_INVALID = 'BIZ_ADJUST_BASE_VERSION_INVALID';
export const ADJUST_BASE_VERSION_INVALID_MSG = '基线版本无效';

/** BIZ_ADJUST_PLACEHOLDER_UNRESOLVED：话术占位符未全部替换（INV-10） */
export const ADJUST_PLACEHOLDER_UNRESOLVED = 'BIZ_ADJUST_PLACEHOLDER_UNRESOLVED';
export const ADJUST_PLACEHOLDER_UNRESOLVED_MSG = '话术占位符未全部替换';
