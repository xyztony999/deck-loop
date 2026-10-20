import { assertTargetedInvariance } from '../src/generation/targeted-invariance';

/**
 * F02b（功能核查 2026-10-20）：定向调整非目标不变性校验单测。
 * 覆盖：非目标页被改/页增删/非目标块被改/块增删/目标块缺失 → 越界抛错；
 * 目标块修改（块级）/目标页重写（页级）/无 baseContent（存量兼容）→ 通过。
 */
describe('定向调整非目标不变性校验', () => {
  const baseContent = {
    pages: [
      { pageId: 'p1', title: '一', blocks: [
        { blockId: 'b1', blockType: 'TEXT', text: 'hello' },
        { blockId: 'b2', blockType: 'IMAGE', assetId: 'a1' },
      ] },
      { pageId: 'p2', title: '二', blocks: [
        { blockId: 'b3', blockType: 'TEXT', text: 'world' },
      ] },
    ],
  };
  const blockScope = {
    baseContent,
    targetPath: { pageId: 'p1', blockId: 'b1' },
  };
  const pageScope = {
    baseContent,
    targetPath: { pageId: 'p2' },
  };

  const clone = (value: unknown): Record<string, unknown> =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  it('目标块文本修改：通过（其余逐字节保持）', () => {
    const result = clone(baseContent);
    const p1 = basePageOf(result, 'p1');
    (p1.blocks as Record<string, unknown>[])[0]['text'] = 'hello（已调整）';
    expect(() => assertTargetedInvariance(blockScope, result, 't1')).not.toThrow();
  });

  it('非目标块被修改：越界拒绝', () => {
    const result = clone(baseContent);
    const p1 = basePageOf(result, 'p1');
    (p1.blocks as Record<string, unknown>[])[1]['assetId'] = 'a2'; // b2 是非目标块
    expect(() => assertTargetedInvariance(blockScope, result, 't1')).toThrow('非目标块被修改');
  });

  it('非目标页被修改：越界拒绝', () => {
    const result = clone(baseContent);
    basePageOf(result, 'p2')['title'] = '二（被改）';
    expect(() => assertTargetedInvariance(blockScope, result, 't1')).toThrow('非目标页被修改');
  });

  it('页新增/缺失：越界拒绝', () => {
    const added = clone(baseContent);
    (added.pages as unknown[]).push({ pageId: 'p3', blocks: [] });
    expect(() => assertTargetedInvariance(blockScope, added, 't1')).toThrow('页数变化');

    const removed = clone(baseContent);
    (removed.pages as unknown[]).pop();
    expect(() => assertTargetedInvariance(blockScope, removed, 't1')).toThrow('页数变化');
  });

  it('目标块缺失/块新增：越界拒绝', () => {
    const missing = clone(baseContent);
    const p1 = basePageOf(missing, 'p1');
    (p1.blocks as unknown[]).shift(); // 移除目标块 b1
    expect(() => assertTargetedInvariance(blockScope, missing, 't1')).toThrow('块数变化');

    const extra = clone(baseContent);
    const p1b = basePageOf(extra, 'p1');
    (p1b.blocks as unknown[]).push({ blockId: 'b9', blockType: 'TEXT', text: 'x' });
    expect(() => assertTargetedInvariance(blockScope, extra, 't1')).toThrow('块数变化');
  });

  it('页级作用域：目标页整页重写通过，非目标页仍受保护', () => {
    const result = clone(baseContent);
    basePageOf(result, 'p2')['blocks'] = [
      { blockId: 'b3', blockType: 'TEXT', text: '整页重写' },
      { blockId: 'b4', blockType: 'TEXT', text: '新增内容' },
    ];
    expect(() => assertTargetedInvariance(pageScope, result, 't1')).not.toThrow();

    const violated = clone(result);
    basePageOf(violated, 'p1')['title'] = '一（被改）';
    expect(() => assertTargetedInvariance(pageScope, violated, 't1')).toThrow('非目标页被修改');
  });

  it('快照无 baseContent（存量在途任务）：跳过校验', () => {
    expect(() => assertTargetedInvariance({ targetPath: { pageId: 'p1' } }, clone(baseContent), 't-old')).not.toThrow();
  });

  it('快照缺目标页：校验失败（快照契约缺失）', () => {
    expect(() => assertTargetedInvariance({ baseContent }, clone(baseContent), 't1')).toThrow('缺少目标页');
  });
});

function basePageOf(content: Record<string, unknown>, pageId: string): Record<string, unknown> {
  const pages = content['pages'] as Record<string, unknown>[];
  const page = pages.find((item) => item['pageId'] === pageId);
  if (page === undefined) {
    throw new Error(`测试夹具缺页 ${pageId}`);
  }
  return page;
}
