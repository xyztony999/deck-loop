/**
 * generation 域错误码 —— 契约来源：api-generation.md §3.4（v1 冻结，禁增删改值）。
 * 前缀 BIZ_TASK_*（对应 v1 GenerationErrorCodeConstants）；adjustment 域同类任务错误复用本文件。
 * 用法：throw new BizException(TASK_DUPLICATE_RUNNING, TASK_DUPLICATE_RUNNING_MSG)。
 */

/** BIZ_TASK_DUPLICATE_RUNNING：同 deck 已有非终态任务（INV-8 互斥） */
export const TASK_DUPLICATE_RUNNING = 'BIZ_TASK_DUPLICATE_RUNNING';
export const TASK_DUPLICATE_RUNNING_MSG = '该创作物已有进行中的任务';

/** BIZ_TASK_NOT_CANCELLABLE：仅 QUEUED/RUNNING 可取消 */
export const TASK_NOT_CANCELLABLE = 'BIZ_TASK_NOT_CANCELLABLE';
export const TASK_NOT_CANCELLABLE_MSG = '当前任务状态不可取消';

/** BIZ_TASK_SCOPE_INVALID：任务指令/入参快照非法 */
export const TASK_SCOPE_INVALID = 'BIZ_TASK_SCOPE_INVALID';
export const TASK_SCOPE_INVALID_MSG = '任务指令或作用域参数非法';
