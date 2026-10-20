import { Injectable } from '@nestjs/common';
import { SyncChangeOp } from '../common/enums';
import {
  tiebreakFor,
  type SyncBoundary,
  type SyncChangeItem,
  type SyncChangeScanner,
  type SyncScanResult,
} from '../platform/sync/sync-change-scanner';
import type { ExportTaskSyncRow } from './deliver.repository';
import { ExportTaskRepository } from './deliver.repository';

/**
 * EXPORT 聚合同步扫描器（platform 域 P-02 /auth/sync/pull SPI 的 deliver 域实现；
 * v1 ExportTaskSyncScanner 平移 + 06 §3.6 Mongo 复合游标；经本域 module 以
 * SYNC_CHANGE_SCANNER token 注册，SyncPullService 容器发现）。
 *
 * - 游标口径：**updated_time 毫秒值 + export_id 复合游标**（写时分配；
 *   提交/状态推进/取消均触碰 updated_time）；
 * - 排序：(updated_time, export_id) 升序稳定排序（$gt cursor 严格推进，不重不漏）；
 * - 毫秒边界裁剪：limit+1 探测更多 + 尾部同毫秒组裁剪（SPI 注释约定）；
 * - DELETE：导出记录不删除（delete_sign 仅模板保留列），op 恒为 UPSERT（v1 同口径）。
 */
@Injectable()
export class ExportTaskSyncScanner implements SyncChangeScanner {
  readonly aggregate = 'EXPORT';

  constructor(private readonly repository: ExportTaskRepository) {}

  async scan(
    userId: string,
    lastCursor: number,
    boundary: SyncBoundary | null,
    limit: number,
  ): Promise<SyncScanResult> {
    const probeLimit = limit + 1; // 探测更多行（F07：复合游标续传，可切在同一毫秒内）
    const rows = await this.repository.scanUpdatedAfter(userId, lastCursor, probeLimit, tiebreakFor(this.aggregate, boundary));
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map((row) => this.toChange(row)), hasMore };
  }

  private toChange(row: ExportTaskSyncRow): SyncChangeItem {
    return {
      aggregate: this.aggregate,
      op: SyncChangeOp.UPSERT,
      id: row.export_id,
      cursor: row.updated_time === undefined ? 0 : row.updated_time.getTime(),
      payload: JSON.stringify({
        deckId: row.deck_id ?? null,
        versionId: row.version_id ?? null,
        exportFormat: row.export_format ?? null,
        exportStatus: row.export_status ?? null,
      }),
    };
  }
}

