import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { cursorCondition, type CursorTiebreak } from '../common/persistence';
import { GENERATION_TASK_CORE_TABLE } from './schemas/generation-task-core.schema';

/** 网关侧任务扫描行（投影，无 _id，NR-08） */
export interface GenerationTaskCoreRow {
  task_id: string;
  deck_id?: string;
  task_type?: string;
  task_status?: string;
  user_id?: string;
  updated_time?: Date;
  delete_sign?: number;
}

/**
 * 生成任务网关侧仓储（dl_generation_task 同表共治，决策 D1；ADR-016 SQL）。
 *
 * 权威 entity 归 generation 域（GenerationTask）；本网关侧以 dataSource 对同表做
 * 条件 UPDATE 与游标 SELECT（不重复建索引）。白名单映射（NR-02）：
 * - advanceToRunning: { task_id, task_status='QUEUED' } 条件更新（幂等键=taskId+期望前置状态）
 * - backfillUsage:    { task_id } SET prompt_tokens/completion_tokens/updated_time
 * - fallbackAdvanceFailed: { task_id, task_status='RUNNING' } 条件推进 FAILED
 * - scanUpdatedAfter: { user_id, updated_time 复合游标 }（06 §3.6）
 */
@Injectable()
export class GenerationTaskCoreRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** QUEUED→RUNNING 条件推进：返回是否抢到（false=已取消/已推进，重复投递安全） */
  async advanceToRunning(taskId: string): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(GENERATION_TASK_CORE_TABLE)
      .set({ task_status: 'RUNNING', updated_time: () => 'now()' })
      .where('task_id = :taskId', { taskId })
      .andWhere('task_status = :queued', { queued: 'QUEUED' })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** 计量回填（prompt/completion tokens；updated_time 推进供同步游标派生） */
  async backfillUsage(taskId: string, promptTokens: number, completionTokens: number): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(GENERATION_TASK_CORE_TABLE)
      .set({ prompt_tokens: promptTokens, completion_tokens: completionTokens, updated_time: () => 'now()' })
      .where('task_id = :taskId', { taskId })
      .execute();
  }

  /** RUNNING→FAILED 兜底推进（仅编排崩溃路径；errorMsg 截断 512，对齐 v1 DDL VARCHAR(512)） */
  async fallbackAdvanceFailed(taskId: string, reason: string): Promise<void> {
    const truncated = reason.length <= 512 ? reason : reason.slice(0, 512);
    await this.dataSource
      .createQueryBuilder()
      .update(GENERATION_TASK_CORE_TABLE)
      .set({ task_status: 'FAILED', error_msg: truncated, updated_time: () => 'now()' })
      .where('task_id = :taskId', { taskId })
      .andWhere('task_status = :running', { running: 'RUNNING' })
      .execute();
  }

  /**
   * TASK 聚合同步扫描（F07 复合游标）：user_id + (updated_time, task_id) 全序推进——
   * tiebreak 含边界毫秒行时同毫秒按 task_id 续传；cursor=0 全量起始。
   */
  async scanUpdatedAfter(
    userId: string,
    cursorMs: number,
    limit: number,
    tiebreak?: CursorTiebreak | null,
  ): Promise<GenerationTaskCoreRow[]> {
    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (cursorMs > 0) {
      const cur = cursorCondition('updated_time', 'task_id', cursorMs, tiebreak, 2);
      conditions.push(cur.sql);
      params.push(...cur.params);
    }
    const limitIndex = params.length + 1;
    params.push(limit);
    return this.dataSource.query(
      `SELECT task_id, deck_id, task_type, task_status, user_id, updated_time, delete_sign FROM ${GENERATION_TASK_CORE_TABLE} WHERE ${conditions.join(' AND ')} ORDER BY updated_time ASC, task_id ASC LIMIT $${limitIndex}`,
      params,
    );
  }
}