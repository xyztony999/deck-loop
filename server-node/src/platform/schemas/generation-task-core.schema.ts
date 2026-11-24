/**
 * 生成任务表（dl_generation_task）的**网关侧精简投影**（api-platform 决策 D1 同表共治）。
 *
 * ADR-016（TypeORM）：每物理表单一 entity——dl_generation_task 的权威 entity 为
 * generation 域 `GenerationTask`（索引归其声明）。本网关侧投影**不再独立 entity**，
 * `GenerationTaskCoreRepository` 以 dataSource/manager 对 dl_generation_task 做
 * 条件 UPDATE 与游标 SELECT（只读/条件写，不重复建索引）。本文件仅保留表名常量
 * 与网关读写字段形状（plain interface，无装饰器）。
 *
 * - 状态推进采用「task_id + 期望前置状态」条件更新实现幂等（api-generation §4.3），
 *   不使用 data_version 乐观锁（避免与 generation 域实体版本互踩）。
 * - TASK 同步扫描（GenerationTaskSyncScanner）复用本网关读路径
 *   （updated_time+task_id 升序，06 §3.6 复合游标）。
 */

/** 物理表名（与 generation 域 GenerationTask entity 同表） */
export const GENERATION_TASK_CORE_TABLE = 'dl_generation_task';

/** 网关侧读写字段形状（精简投影；完整聚合建模见 generation 域 GenerationTask） */
export interface GenerationTaskCore {
  task_id: string;
  deck_id?: string | null;
  task_type?: string | null;
  channel_code?: string | null;
  model_code?: string | null;
  task_status?: string | null;
  error_msg?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  user_id?: string | null;
  updated_time?: Date | null;
  delete_sign?: number | null;
}