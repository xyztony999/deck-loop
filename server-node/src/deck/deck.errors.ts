/**
 * deck 域错误码 —— 契约来源：api-deck.md §3.4（v1 冻结，禁增删改值）。
 * 命名规约 {BIZ}_{OBJECT}_{ERROR}（node-specs 20 §6）；常量名省 BIZ_ 前缀，
 * 与 common/exceptions.ts AUTH_SESSION_EXPIRED 先例一致。
 * 用法：throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG)（全局 Filter 转 Result）。
 *
 * 注意：deliver 域「仅 FINALIZED 可导出」守卫复用本文件 DECK_STATUS_FORBIDDEN
 * （api-delivery §3.2），deliver 侧 import 消费、不得重复定义。
 */

/** BIZ_DECK_STATUS_FORBIDDEN：状态守卫拒绝（FINALIZED/ARCHIVED 编辑、非 ITERATING 动作等） */
export const DECK_STATUS_FORBIDDEN = 'BIZ_DECK_STATUS_FORBIDDEN';
export const DECK_STATUS_FORBIDDEN_MSG = '当前创作物状态不允许该操作';

/** BIZ_DECK_NOT_FOUND：创作物不存在或不属于当前用户 */
export const DECK_NOT_FOUND = 'BIZ_DECK_NOT_FOUND';
export const DECK_NOT_FOUND_MSG = '创作物不存在';

/** BIZ_DECK_TASK_RUNNING：存在进行中的生成/调整任务，动作被拒（finalize/archive 等） */
export const DECK_TASK_RUNNING = 'BIZ_DECK_TASK_RUNNING';
export const DECK_TASK_RUNNING_MSG = '存在进行中的任务，请稍后再试';
