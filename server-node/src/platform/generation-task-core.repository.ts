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
 * 生成任务历史只读仓储（dl_generation_task，ADR-016 SQL；ADR-018 网关退役后
 * **任务表停写**——原网关侧条件推进/计量回填写路径随 P-01 删除，仅保留
 * TASK 聚合同步扫描（历史行对账，06 §3.6）。
 *
 * 权威 entity 归 platform/schemas/dl_generation_task.schema（历史保留）；
 * 本仓储以 dataSource 对同表做游标 SELECT（不重复建索引）。
 * 白名单映射（NR-02）：scanUpdatedAfter: { user_id, updated_time 复合游标 }。
 */
@Injectable()
export class GenerationTaskCoreRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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