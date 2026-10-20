import { SyncPullService } from '../src/platform/sync/sync-pull.service';
import type { SyncBoundary, SyncChangeScanner, SyncScanResult } from '../src/platform/sync/sync-change-scanner';
import { tiebreakFor } from '../src/platform/sync/sync-change-scanner';

/**
 * F07（功能核查 2026-10-20）：复合游标同毫秒续传单测（内存扫描器，不依赖数据库）。
 * 复现审计场景：201 条同毫秒记录——旧实现（毫秒边界裁剪 + 纯 $gt 游标）首两页
 * 合计只送达 200 条；新实现 (lastCursor, lastPosition=AGGREGATE:id) 全序续传可达全部。
 */
describe('同步复合游标（F07）', () => {
  const MS = 1_700_000_000_000;
  const OVERFLOW = SyncPullService.PAGE_LIMIT + 1; // 201

  /** 内存扫描器：rows 按 (cursor, id) 有序；按 tiebreak 语义切片（与仓储 $or 查询同口径） */
  class FakeScanner implements SyncChangeScanner {
    constructor(readonly aggregate: string, private readonly rows: Array<{ id: string; cursor: number }>) {}

    async scan(userId: string, lastCursor: number, boundary: SyncBoundary | null, limit: number): Promise<SyncScanResult> {
      const tiebreak = tiebreakFor(this.aggregate, boundary);
      const filtered = this.rows.filter((row) => {
        if (row.cursor < lastCursor) return false;
        if (row.cursor > lastCursor) return true;
        if (tiebreak == null || !tiebreak.includeCursorRow) return false; // 边界毫秒行已随上页下发
        if (tiebreak.afterId === undefined) return true; // 聚合名序在边界聚合之后：同毫秒行未下发
        return row.id > tiebreak.afterId;
      });
      const page = filtered.slice(0, limit);
      return {
        items: page.map((row) => ({
          aggregate: this.aggregate,
          op: 'UPSERT',
          id: row.id,
          cursor: row.cursor,
          payload: '{}',
        })),
        hasMore: filtered.length > limit,
      };
    }
  }

  function serviceOf(scanners: SyncChangeScanner[]): SyncPullService {
    const fakeContainer = {
      values: () =>
        scanners.map((scanner) => ({
          providers: new Map([['SYNC_CHANGE_SCANNER', { instance: scanner }]]),
        })),
    } as unknown as ConstructorParameters<typeof SyncPullService>[0];
    return new SyncPullService(fakeContainer);
  }

  it('tiebreakFor：聚合名序决定边界毫秒行的取舍', () => {
    expect(tiebreakFor('TASK', null)).toBeNull();
    expect(tiebreakFor('TASK', { aggregate: 'TASK', id: 't5' })).toEqual({ includeCursorRow: true, afterId: 't5' });
    // 聚合名字典序：DECK/EXPORT < TASK（同毫秒行已随上页下发）→ null；
    // VERSION > TASK（同毫秒行未下发）→ 含边界行
    expect(tiebreakFor('DECK', { aggregate: 'TASK', id: 't5' })).toBeNull();
    expect(tiebreakFor('EXPORT', { aggregate: 'TASK', id: 't5' })).toBeNull();
    expect(tiebreakFor('VERSION', { aggregate: 'TASK', id: 't5' })).toEqual({ includeCursorRow: true });
  });

  it('同毫秒 201 条：两页合计送达全部（旧实现漏 1 条）', async () => {
    const rows = Array.from({ length: OVERFLOW }, (_, i) => ({ id: `t${String(i + 1).padStart(3, '0')}`, cursor: MS }));
    const service = serviceOf([new FakeScanner('TASK', rows)]);

    const page1 = await service.pull({ lastCursor: 0 }, 'u1');
    expect(page1.changes).toHaveLength(SyncPullService.PAGE_LIMIT);
    expect(page1.hasMore).toBe(true);
    expect(page1.newCursor).toBe(MS);
    expect(page1.newPosition).toBe(`TASK:t${String(SyncPullService.PAGE_LIMIT).padStart(3, '0')}`);

    const page2 = await service.pull({ lastCursor: page1.newCursor, lastPosition: page1.newPosition }, 'u1');
    expect(page2.changes).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    expect(page2.changes[0].id).toBe(`t${String(OVERFLOW).padStart(3, '0')}`);

    // 合计 201 条且无重复
    const ids = new Set([...page1.changes, ...page2.changes].map((c) => c.id));
    expect(ids.size).toBe(OVERFLOW);
  });

  it('跨聚合同毫秒交错：续传不漏他聚合的同毫秒行', async () => {
    const taskRows = [{ id: 't1', cursor: MS }, { id: 't2', cursor: MS }];
    const exportRows = [{ id: 'e1', cursor: MS }];
    const service = serviceOf([new FakeScanner('TASK', taskRows), new FakeScanner('EXPORT', exportRows)]);

    const page1 = await service.pull({ lastCursor: 0 }, 'u1');
    // 全序 (MS, EXPORT:e1) < (MS, TASK:t1) < (MS, TASK:t2)——EXPORT 聚合名序在前
    expect(page1.changes.map((c) => `${c.aggregate}:${c.id}`)).toEqual(['EXPORT:e1', 'TASK:t1', 'TASK:t2']);
    expect(page1.hasMore).toBe(false);
    expect(page1.newPosition).toBe('TASK:t2');
  });

  it('无变更：游标与位置原样回传（客户端进度探测不误报）', async () => {
    const service = serviceOf([new FakeScanner('TASK', [])]);
    const vo = await service.pull({ lastCursor: MS, lastPosition: 'TASK:t9' }, 'u1');
    expect(vo.changes).toHaveLength(0);
    expect(vo.newCursor).toBe(MS);
    expect(vo.newPosition).toBe('TASK:t9');
  });

  it('非法位置格式：忽略并退化为纯毫秒游标', async () => {
    const service = serviceOf([new FakeScanner('TASK', [{ id: 't1', cursor: MS + 1 }])]);
    const vo = await service.pull({ lastCursor: MS, lastPosition: 'bad position!' }, 'u1');
    expect(vo.changes.map((c) => c.id)).toEqual(['t1']);
  });
});
