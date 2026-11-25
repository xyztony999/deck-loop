/**
 * version 域错误码 —— 契约来源：api-version.md §3.4 + api-web-agent.md §3.4
 * （ADR-018 增量：BIZ_VERSION_TARGET_INVARIANCE）。
 * 前缀 BIZ_VERSION_*（对应 v1 VersionErrorCodeConstants）。
 * 用法：throw new BizException(VERSION_NOT_FOUND, VERSION_NOT_FOUND_MSG)。
 */

/** BIZ_VERSION_NOT_FOUND：版本不存在或不属于当前 deck/用户 */
export const VERSION_NOT_FOUND = 'BIZ_VERSION_NOT_FOUND';
export const VERSION_NOT_FOUND_MSG = '版本不存在';

/** BIZ_VERSION_BRANCH_EXISTS：分支名同 deck 已存在（INV-12） */
export const VERSION_BRANCH_EXISTS = 'BIZ_VERSION_BRANCH_EXISTS';
export const VERSION_BRANCH_EXISTS_MSG = '分支名已存在';

/** BIZ_VERSION_SAME_COMPARE：双版本对比拒绝同版本比较 */
export const VERSION_SAME_COMPARE = 'BIZ_VERSION_SAME_COMPARE';
export const VERSION_SAME_COMPARE_MSG = '不支持相同版本比较';

/** BIZ_VERSION_TARGET_INVARIANCE：定向产物越界/scope 不存在/载荷红线越界（api-web-agent §3.4，ADR-018；BIZ 错误而非集成缺陷——agent 产物是不可信输入） */
export const VERSION_TARGET_INVARIANCE = 'BIZ_VERSION_TARGET_INVARIANCE';
export const VERSION_TARGET_INVARIANCE_MSG = '定向调整产物越界，非目标内容须保持不变';
