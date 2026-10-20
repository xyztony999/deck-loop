import { MockAiProviderAdapter } from '../src/platform/gateway/mock-ai-provider.adapter';
import type { ProviderCallContext } from '../src/platform/gateway/ai-provider-adapter';

/**
 * F03（功能核查 2026-10-20）：Mock provider 产物内容契约单测。
 * 覆盖：generateContent 产出稳定 pageId/blockId（api-version §4.1 契约——
 * 缺 ID 会被客户端预览过滤、定向 scope 解析失败）；adjustContent 基于基线
 * 做最小变更（TARGETED 非目标逐字节保持 → 回调不变性校验可过）。
 */
describe('Mock provider 内容契约', () => {
  const adapter = new MockAiProviderAdapter();

  function contextOf(snapshot: Record<string, unknown>, taskType = 'FULL_GENERATE'): ProviderCallContext {
    return {
      task: {
        taskId: 'gt-test',
        deckId: 'd1',
        taskType,
        userId: 'u1',
        channelCode: 'MOCK',
        modelCode: 'mock-1',
        instructionSnapshot: JSON.stringify(snapshot),
      },
      apiKey: '',
      timeoutMillis: 0,
    } as unknown as ProviderCallContext;
  }

  const outlineSnapshot = [
    { nodeId: 'n1', title: '背景', points: ['要点A', '要点B'], pageHint: 1 },
    { nodeId: 'n2', title: '方案', points: ['要点C'], pageHint: 1 },
  ];
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

  it('generateOutline：节点数组契约（nodeId/title/points/pageHint）', async () => {
    const result = await adapter.generateOutline(contextOf({ topic: '季度汇报' }));
    const nodes = JSON.parse(result.content) as Array<Record<string, unknown>>;
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    for (const node of nodes) {
      expect(typeof node['nodeId']).toBe('string');
      expect(node['nodeId']).not.toBe('');
      expect(Array.isArray(node['points'])).toBe(true);
      expect(typeof node['pageHint']).toBe('number');
    }
  });

  it('generateContent：页/块 ID 稳定且唯一（大纲逐节点成页）', async () => {
    const result = await adapter.generateContent(
      contextOf({ topic: '季度汇报', outlineSnapshot }),
    );
    const doc = JSON.parse(result.content) as Record<string, unknown>;
    const pages = doc['pages'] as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(2);
    const pageIds = new Set<string>();
    const blockIds = new Set<string>();
    for (const page of pages) {
      const pageId = page['pageId'] as string;
      expect(typeof pageId).toBe('string');
      expect(pageId).toMatch(/^p\d+$/);
      pageIds.add(pageId);
      for (const block of page['blocks'] as Array<Record<string, unknown>>) {
        const blockId = block['blockId'] as string;
        expect(blockId).toMatch(/^p\d+-b\d+$/);
        blockIds.add(blockId);
      }
    }
    expect(pageIds.size).toBe(2);
    expect(blockIds.size).toBe(2);
    expect(pages[0]['title']).toBe('背景');
  });

  it('adjustContent(TARGETED)：仅目标块变更，非目标页/块逐字节保持', async () => {
    const result = await adapter.adjustContent(
      contextOf(
        {
          baseContent,
          instructionText: '更口语化',
          targetPath: { pageId: 'p1', blockId: 'b1' },
        },
        'TARGETED_ADJUST',
      ),
    );
    const doc = JSON.parse(result.content) as Record<string, unknown>;
    const pages = doc['pages'] as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(2);
    // 非目标页 p2 逐字节保持
    expect(JSON.stringify(pages[1])).toBe(JSON.stringify((baseContent.pages as unknown[])[1]));
    // 目标块被修改（含指令标记），非目标块 b2 保持
    const p1Blocks = pages[0]['blocks'] as Array<Record<string, unknown>>;
    const baseP1Blocks = (baseContent.pages as Array<Record<string, unknown>>)[0]['blocks'] as Array<Record<string, unknown>>;
    expect(p1Blocks[0]['text']).toContain('更口语化');
    expect(JSON.stringify(p1Blocks[1])).toBe(JSON.stringify(baseP1Blocks[1]));
  });

  it('adjustContent(FULL)：全部 TEXT 块追加标记，ID 全保留', async () => {
    const result = await adapter.adjustContent(
      contextOf({ baseContent, instructionText: '整体更精简' }, 'FULL_ADJUST'),
    );
    const doc = JSON.parse(result.content) as Record<string, unknown>;
    const pages = doc['pages'] as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(2);
    expect((pages[0]['blocks'] as Record<string, unknown>[])[0]['blockId']).toBe('b1');
    expect((pages[0]['blocks'] as Record<string, unknown>[])[0]['text']).toContain('整体更精简');
    // IMAGE 块不被追加文本
    expect((pages[0]['blocks'] as Record<string, unknown>[])[1]['blockType']).toBe('IMAGE');
  });

  it('adjustContent(无基线兜底)：仍满足 pageId/blockId 契约', async () => {
    const result = await adapter.adjustContent(contextOf({ instructionText: 'x' }, 'FULL_ADJUST'));
    const doc = JSON.parse(result.content) as Record<string, unknown>;
    const page = (doc['pages'] as Array<Record<string, unknown>>)[0];
    expect(page['pageId']).toBe('p1');
    expect((page['blocks'] as Record<string, unknown>[])[0]['blockId']).toBe('p1-b1');
  });
});
