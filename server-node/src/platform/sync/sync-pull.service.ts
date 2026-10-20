import { Injectable, Logger } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import {
  SYNC_CHANGE_SCANNER,
  type SyncBoundary,
  type SyncChangeItem,
  type SyncChangeScanner,
} from './sync-change-scanner';
import { SyncChangeVO, SyncPullAO, SyncPullVO } from '../platform.dto';

/** 复合游标位置格式：AGGREGATE:id（聚合名为大写字母/下划线，id 为白名单 id） */
const POSITION_PATTERN = /^([A-Z_]+):([A-Za-z0-9_-]{1,32})$/;

/**
 * 增量同步服务（POST /auth/sync/pull，P-02；v1 SyncPullServiceImpl 平移 +
 * 06 §3.6 Mongo 复合游标；F07 同毫秒续传修复）。
 *
 * - 扫描器发现：经 ModulesContainer 聚合全应用各 module 以
 *   `{ provide: SYNC_CHANGE_SCANNER, useClass: X }` 注册的实现（无需互相 import，
 *   并行生成期未注册的聚合在结果中缺席=优雅降级）；惰性缓存（单例 provider）；
 * - 归并：各扫描器 (cursor, 聚合, id) 升序归并，单页 ≤200 条；
 * - **F07 复合游标**：lastCursor（毫秒）+ lastPosition（`AGGREGATE:id`，增量可选
 *   字段）组成可续传全序——页边界可切在同一毫秒内（含 >200 条同毫秒的病态场景），
 *   续传按各聚合与边界聚合的名字序取含/不含边界毫秒行（tiebreakFor），不漏行不重行；
 * - hasMore：任一扫描器报更多或归并溢出为 true；
 * - newCursor/newPosition：本页末条的 (cursor, aggregate:id)（无变更回传入参）。
 */
@Injectable()
export class SyncPullService {
  /** 单页变更上限（api-platform §4.4：单页 ≤200 条变更） */
  static readonly PAGE_LIMIT = 200;

  private readonly logger = new Logger(SyncPullService.name);

  /** 发现的扫描器缓存（单例 provider，进程生命周期有效） */
  private scanners: SyncChangeScanner[] | null = null;

  constructor(private readonly modulesContainer: ModulesContainer) {}

  /** 游标拉取（userId 由会话服务端注入，ADR-005） */
  async pull(ao: SyncPullAO, userId: string): Promise<SyncPullVO> {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new Error('会话缺失'); // 防御：正常流程 AuthGuard 已保证（v1 对齐）
    }
    const lastCursor =
      ao === null || ao === undefined || typeof ao.lastCursor !== 'number'
        ? 0
        : Math.max(0, Math.floor(ao.lastCursor));
    const lastPosition =
      typeof ao.lastPosition === 'string' ? ao.lastPosition.trim() : '';
    const boundary =
      lastCursor > 0 && POSITION_PATTERN.test(lastPosition)
        ? parsePosition(lastPosition)
        : null;

    let merged: SyncChangeItem[] = [];
    let hasMore = false;
    for (const scanner of this.resolveScanners()) {
      try {
        const result = await scanner.scan(userId, lastCursor, boundary, SyncPullService.PAGE_LIMIT);
        if (result !== null && result !== undefined && result.items.length > 0) {
          merged = merged.concat(result.items);
          if (result.hasMore) {
            hasMore = true;
          }
        }
      } catch (error) {
        // 单聚合扫描异常不阻断整页（其余聚合照常返回；记日志定位）
        this.logger.error(
          `同步扫描器异常 aggregate=${scanner.aggregate}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // (cursor, aggregate, id) 字典序归并（跨聚合 id 不可比，以聚合名稳定破平）
    merged.sort(
      (a, b) => a.cursor - b.cursor || compareText(a.aggregate, b.aggregate) || compareText(a.id, b.id),
    );

    // F07：溢出直接切片（复合游标可切在同一毫秒内，无需毫秒边界裁剪）
    if (merged.length > SyncPullService.PAGE_LIMIT) {
      hasMore = true;
      merged = merged.slice(0, SyncPullService.PAGE_LIMIT);
    }

    const vo = new SyncPullVO();
    vo.changes = merged.map((item) => toVO(item));
    if (merged.length === 0) {
      vo.newCursor = lastCursor;
      vo.newPosition = boundary === null ? undefined : `${boundary.aggregate}:${boundary.id}`;
    } else {
      const last = merged[merged.length - 1];
      vo.newCursor = last.cursor;
      vo.newPosition = `${last.aggregate}:${last.id}`;
    }
    vo.hasMore = hasMore;
    return vo;
  }

  /** 容器发现 SYNC_CHANGE_SCANNER 实现（各域 module provide；首次调用缓存） */
  private resolveScanners(): SyncChangeScanner[] {
    if (this.scanners !== null) {
      return this.scanners;
    }
    const found: SyncChangeScanner[] = [];
    for (const module of this.modulesContainer.values()) {
      const wrapper = module.providers.get(SYNC_CHANGE_SCANNER);
      if (wrapper !== undefined && wrapper.instance !== null) {
        found.push(wrapper.instance as SyncChangeScanner);
      }
    }
    this.scanners = found;
    if (found.length === 0) {
      this.logger.warn('未发现任何 SyncChangeScanner 实现（各域尚未注册或已全部降级）');
    }
    return found;
  }
}

/** 服务端项 → 契约 VO（字段逐字对齐 api-platform §4.4） */
function toVO(item: SyncChangeItem): SyncChangeVO {
  const vo = new SyncChangeVO();
  vo.aggregate = item.aggregate;
  vo.op = item.op;
  vo.id = item.id;
  vo.cursor = item.cursor;
  vo.payload = item.payload;
  return vo;
}

/** `AGGREGATE:id` → 边界（格式已由 POSITION_PATTERN 预检） */
function parsePosition(position: string): SyncBoundary {
  const separator = position.indexOf(':');
  return { aggregate: position.slice(0, separator), id: position.slice(separator + 1) };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
