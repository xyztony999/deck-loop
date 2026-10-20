import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { GenerationTaskCore, GenerationTaskCoreDocument } from './schemas/generation-task-core.schema';

/** 网关侧任务扫描行（lean 投影，_id 不出仓储） */
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
 * 生成任务网关侧仓储（dl_generation_task 同表共治，决策 D1）。
 *
 * 白名单映射（NR-02）：
 * - advanceToRunning: { task_id, task_status: QUEUED } 条件更新（幂等键=taskId+期望前置状态）
 * - backfillUsage:    { task_id } $set prompt_tokens/completion_tokens/updated_time（服务端字段）
 * - fallbackAdvanceFailed: { task_id, task_status: RUNNING } 条件推进 FAILED（终态守卫幂等）
 * - scanUpdatedAfter: { user_id（服务端注入）, updated_time: { $gt } } 复合游标扫描（06 §3.6）
 */
@Injectable()
export class GenerationTaskCoreRepository {
  constructor(
    @InjectModel(GenerationTaskCore.name)
    private readonly model: Model<GenerationTaskCoreDocument>,
  ) {}

  /** QUEUED→RUNNING 条件推进：返回是否抢到（false=已取消/已推进，重复投递安全） */
  async advanceToRunning(taskId: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { task_id: taskId, task_status: 'QUEUED' },
        { $set: { task_status: 'RUNNING', updated_time: new Date() } },
      )
      .exec();
    return result.modifiedCount > 0;
  }

  /** 计量回填（prompt/completion tokens；updated_time 推进供同步游标派生） */
  async backfillUsage(taskId: string, promptTokens: number, completionTokens: number): Promise<void> {
    await this.model
      .updateOne(
        { task_id: taskId },
        {
          $set: { prompt_tokens: promptTokens, completion_tokens: completionTokens, updated_time: new Date() },
        },
      )
      .exec();
  }

  /** RUNNING→FAILED 兜底推进（仅编排崩溃路径；errorMsg 截断 512，对齐 v1 DDL VARCHAR(512)） */
  async fallbackAdvanceFailed(taskId: string, reason: string): Promise<void> {
    const truncated = reason.length <= 512 ? reason : reason.slice(0, 512);
    await this.model
      .updateOne(
        { task_id: taskId, task_status: 'RUNNING' },
        { $set: { task_status: 'FAILED', error_msg: truncated, updated_time: new Date() } },
      )
      .exec();
  }

  /**
   * TASK 聚合同步扫描（F07 复合游标）：user_id + (updated_time, task_id) 全序
   * $gt 推进——tiebreak 含边界毫秒行时同毫秒按 task_id 续传；cursor=0 全量起始。
   */
  async scanUpdatedAfter(
    userId: string,
    cursorMs: number,
    limit: number,
    tiebreak?: { includeCursorRow: boolean; afterId?: string } | null,
  ): Promise<GenerationTaskCoreRow[]> {
    const filter: FilterQuery<GenerationTaskCoreDocument> =
      cursorMs > 0
        ? { user_id: userId, ...cursorTimeFilter('updated_time', cursorMs, 'task_id', tiebreak) }
        : { user_id: userId };
    return this.model
      .find(filter, { _id: 0 })
      .sort({ updated_time: 1, task_id: 1 })
      .limit(limit)
      .lean<GenerationTaskCoreRow[]>()
      .exec();
  }
}

/**
 * 复合游标时间过滤（F07）：tiebreak=null → 严格 $gt；含边界行且有 afterId →
 * $or [>$ms, =ms 且业务 id>afterId]；含边界行无 afterId → $gte。
 */
function cursorTimeFilter(
  timeField: string,
  cursorMs: number,
  idField: string,
  tiebreak: { includeCursorRow: boolean; afterId?: string } | null | undefined,
): Record<string, unknown> {
  const at = new Date(cursorMs);
  if (tiebreak != null && tiebreak.includeCursorRow) {
    if (tiebreak.afterId !== undefined) {
      return {
        $or: [
          { [timeField]: { $gt: at } },
          { [timeField]: at, [idField]: { $gt: tiebreak.afterId } },
        ],
      };
    }
    return { [timeField]: { $gte: at } };
  }
  return { [timeField]: { $gt: at } };
}
