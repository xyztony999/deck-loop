import { Injectable } from '@nestjs/common';
import { SyncChangeOp } from '../common/enums';
import {
  tiebreakFor,
  type SyncBoundary,
  type SyncChangeItem,
  type SyncChangeScanner,
  type SyncScanResult,
} from '../platform/sync/sync-change-scanner';
import type { DeckVersionSyncRow } from './version.repository';
import { VersionRepository } from './version.repository';

/**
 * VERSION 聚合同步扫描器（platform 域 P-02 /auth/sync/pull SPI 的 version 域实现；
 * v1 DeckVersionSyncScanner 平移 + 06 §3.6 Mongo 复合游标；经本域 module 以
 * SYNC_CHANGE_SCANNER token 注册，SyncPullService 容器发现）。
 *
 * - 游标口径：**created_time 毫秒值 + version_id 复合游标**——dl_deck_version 为
 *   不可变 insert-only 聚合（无 updated_time，INV-11），插入即变更，created_time
 *   即变更时间（v1 同口径）；
 * - 排序：(created_time, version_id) 升序稳定排序（$gt cursor 严格推进，不重不漏）；
 * - 毫秒边界裁剪：limit+1 探测更多 + 尾部同毫秒组裁剪（SPI 注释约定）；
 * - DELETE：不可变聚合无删除路径，op 恒为 UPSERT。
 */
@Injectable()
export class DeckVersionSyncScanner implements SyncChangeScanner {
  readonly aggregate = 'VERSION';

  constructor(private readonly versionRepository: VersionRepository) {}

  async scan(
    userId: string,
    lastCursor: number,
    boundary: SyncBoundary | null,
    limit: number,
  ): Promise<SyncScanResult> {
    const probeLimit = limit + 1; // 探测更多行（F07：复合游标续传，可切在同一毫秒内）
    const rows = await this.versionRepository.scanCreatedAfter(userId, lastCursor, probeLimit, tiebreakFor(this.aggregate, boundary));
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map((row) => this.toChange(row)), hasMore };
  }

  private toChange(row: DeckVersionSyncRow): SyncChangeItem {
    return {
      aggregate: this.aggregate,
      op: SyncChangeOp.UPSERT,
      id: row.version_id,
      cursor: row.created_time === undefined ? 0 : row.created_time.getTime(),
      payload: JSON.stringify({
        deckId: row.deck_id ?? null,
        versionSeq: row.version_seq ?? null,
        branchName: row.branch_name ?? null,
        sourceType: row.source_type ?? null,
      }),
    };
  }
}

