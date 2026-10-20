import { Injectable } from '@nestjs/common';
import { SyncChangeOp } from '../../common/enums';
import {
  GenerationTaskCoreRepository,
  type GenerationTaskCoreRow,
} from '../generation-task-core.repository';
import { tiebreakFor, type SyncBoundary, type SyncChangeItem, type SyncScanResult, type SyncChangeScanner } from './sync-change-scanner';

/**
 * TASK 聚合同步扫描器（platform 内置——dl_generation_task 与 generation 域同表共治 D1，
 * 网关推进状态同样产生变更；v1 GenerationTaskSyncScanner 平移 + 06 §3.6 复合游标）。
 *
 * - 游标口径：updated_time 毫秒值（写时分配，网关/generation 每次状态推进均触碰）；
 * - 排序：(updated_time, task_id) 升序（$gt [cursor,id] 复合推进，毫秒不截断）；
 * - 毫秒边界裁剪：limit+1 探测更多 + 尾部同毫秒组裁剪（见 SPI 注释）；
 * - DELETE：delete_sign=1 的软删文档承载（任务软删场景，正常无删除）。
 * 其余聚合（DECK/VERSION/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT）由各域实现
 * SyncChangeScanner 并以 SYNC_CHANGE_SCANNER token 注册。
 */
@Injectable()
export class GenerationTaskSyncScanner implements SyncChangeScanner {
  readonly aggregate = 'TASK';

  constructor(private readonly taskRepository: GenerationTaskCoreRepository) {}

  async scan(
    userId: string,
    lastCursor: number,
    boundary: SyncBoundary | null,
    limit: number,
  ): Promise<SyncScanResult> {
    const probeLimit = limit + 1; // 探测更多行（F07：复合游标续传，可切在同一毫秒内）
    const rows = await this.taskRepository.scanUpdatedAfter(userId, lastCursor, probeLimit, tiebreakFor(this.aggregate, boundary));
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map((row) => this.toChange(row)), hasMore };
  }

  private toChange(row: GenerationTaskCoreRow): SyncChangeItem {
    return {
      aggregate: this.aggregate,
      op: row.delete_sign === 1 ? SyncChangeOp.DELETE : SyncChangeOp.UPSERT,
      id: row.task_id,
      cursor: row.updated_time === undefined ? 0 : row.updated_time.getTime(),
      payload: JSON.stringify({
        deckId: row.deck_id ?? null,
        taskType: row.task_type ?? null,
        taskStatus: row.task_status ?? null,
      }),
    };
  }
}

