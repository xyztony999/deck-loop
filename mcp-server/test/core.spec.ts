/**
 * ADR-017 集成测试：本地 headless 核心（SQLite in-memory）+ MCP 工具面。
 * 经真实 MCP Client（InMemoryTransport）跑 agent 直写全流程：
 * 建 deck → 大纲 → 首版（DRAFT→ITERATING）→ 整稿调整 → 定向调整（不变性 pass/越界）
 * → 树/对比/回退/分叉 → 定稿/解锁 → 素材引用计数。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLocalCore, type LocalCore } from '@deck-loop/core/dist/local';
import Database from 'better-sqlite3';
import { createMcpServer } from '../src/app';
import type { LocalPaths } from '../src/paths';

const TEST_PATHS: LocalPaths = {
  home: ':memory:',
  database: ':memory:',
  assetsDir: ':memory:',
  artifactsDir: ':memory:',
  previewsDir: ':memory:',
};

/** 1x1 PNG（素材上传冒烟） */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function content(pages: Array<{ pageId: string; title: string; text: string; assetId?: string }>) {
  return {
    pages: pages.map((p) => ({
      pageId: p.pageId,
      layout: 'TITLE_BODY',
      title: p.title,
      note: '',
      blocks: [
        { blockId: `${p.pageId}-b1`, blockType: 'TEXT', text: p.text },
        ...(p.assetId != null
          ? [{ blockId: `${p.pageId}-b2`, blockType: 'IMAGE', assetId: p.assetId }]
          : []),
      ],
    })),
  };
}

describe('本地 MCP 核心（SQLite + agent 直写）', () => {
  let core: LocalCore;
  let client: Client;
  let deckId: string;
  let v1: string;
  let v2: string;
  let v3: string;

  beforeAll(async () => {
    // 存储 env 指向临时目录（避免默认 ./data 落进仓库）
    const storageHome = mkdtempSync(join(tmpdir(), 'deck-loop-core-test-'));
    process.env.ASSET_STORAGE_DIR = join(storageHome, 'assets');
    process.env.EXPORT_ARTIFACT_DIR = join(storageHome, 'artifacts');
    core = await createLocalCore({ database: ':memory:', driver: Database });
    const server = createMcpServer(core, TEST_PATHS);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await core.close();
  });

  async function call(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
    const data = JSON.parse(text);
    if (res.isError) {
      const err = new Error(data.message ?? 'tool error') as Error & { code?: string; data?: unknown };
      err.code = data.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function callExpectError(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    expect(res.isError).toBe(true);
    return JSON.parse((res.content as Array<{ text: string }>)[0].text);
  }

  it('tools/list 暴露核心工具面', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [
      'deck_create',
      'deck_list',
      'deck_get',
      'outline_save',
      'deck_finalize',
      'version_create',
      'version_tree',
      'version_get',
      'version_compare',
      'version_rollback',
      'version_fork',
      'asset_add',
      'asset_list',
      'export_deck',
      'export_list',
      'preview_deck',
      'brandkit_save',
      'brandkit_list',
      'brandkit_set_default',
      'prompt_save',
      'prompt_list',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('deck_create → DRAFT 空树', async () => {
    const vo = await call('deck_create', { deckName: '测试演示', topic: '本地优先 MCP' });
    deckId = vo.deckId;
    expect(deckId).toBeTruthy();
    expect(vo.deckCode).toMatch(/^DL\d{6}\d{4}$/);
    const detail = await call('deck_get', { deckId });
    expect(detail.deckStatus).toBe('DRAFT');
    expect(detail.currentVersionId ?? null).toBeNull();
  });

  it('outline_save 落顶层节点数组 + 校验守卫', async () => {
    const nodes = [
      { title: '背景', points: ['订阅错配', 'MCP 形态'], pageHint: 1 },
      { title: '方案', points: ['agent 直写'], note: '备注' },
    ];
    const vo = await call('outline_save', { deckId, nodes });
    expect(vo.nodeCount).toBe(2);
    const detail = await call('deck_get', { deckId });
    const outline = detail.draftOutline as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(outline)).toBe(true);
    expect(outline[0].nodeId).toBe('n1');
    expect(outline[0].pageHint).toBe(1);
    expect(outline[1].note).toBe('备注');
    // 空大纲拒绝
    await callExpectError('outline_save', { deckId, nodes: [] });
  });

  it('version_create 首版 → FULL_GENERATE + DRAFT→ITERATING', async () => {
    const vo = await call('version_create', {
      deckId,
      instruction: '生成两页整稿',
      content: content([
        { pageId: 'p1', title: '第一页', text: 'hello' },
        { pageId: 'p2', title: '第二页', text: 'world' },
      ]),
    });
    v1 = vo.versionId;
    expect(vo.versionSeq).toBe(1);
    expect(vo.sourceType).toBe('FULL_GENERATE');
    expect(vo.taskId).toMatch(/^agent-\d+$/);
    const detail = await call('deck_get', { deckId });
    expect(detail.deckStatus).toBe('ITERATING');
    expect(detail.currentVersionId).toBe(v1);
    // 首版后大纲只读
    await callExpectError('outline_save', { deckId, nodes: [{ title: 'x' }] });
  });

  it('version_create 整稿调整 → FULL_ADJUST seq2', async () => {
    const vo = await call('version_create', {
      deckId,
      instruction: '把 hello 改成你好',
      content: content([
        { pageId: 'p1', title: '第一页', text: '你好' },
        { pageId: 'p2', title: '第二页', text: 'world' },
      ]),
    });
    v2 = vo.versionId;
    expect(vo.versionSeq).toBe(2);
    expect(vo.sourceType).toBe('FULL_ADJUST');
  });

  it('定向调整（页级）：目标页可变、非目标页不变', async () => {
    const vo = await call('version_create', {
      deckId,
      instruction: '重写第一页标题',
      scope: { pageId: 'p1' },
      content: content([
        { pageId: 'p1', title: '第一页（改）', text: '你好' },
        { pageId: 'p2', title: '第二页', text: 'world' },
      ]),
    });
    v3 = vo.versionId;
    expect(vo.sourceType).toBe('TARGETED_ADJUST');
    expect(vo.versionSeq).toBe(3);
    // 越界：动了非目标页 p2 → 拒绝（不产版本）
    const err = await callExpectError('version_create', {
      deckId,
      instruction: '越界修改',
      scope: { pageId: 'p1' },
      content: content([
        { pageId: 'p1', title: '第一页（改）', text: '你好' },
        { pageId: 'p2', title: '第二页（被改）', text: 'world' },
      ]),
    });
    expect(String(err.message)).toContain('越界');
  });

  it('定向调整（块级）：非目标块字节级不变', async () => {
    // 先加一个双块页版本作基线
    const base = await call('version_create', {
      deckId,
      instruction: '加双块页',
      content: {
        pages: [
          {
            pageId: 'p1',
            title: '第一页（改）',
            blocks: [
              { blockId: 'p1-b1', blockType: 'TEXT', text: '块一' },
              { blockId: 'p1-b2', blockType: 'TEXT', text: '块二' },
            ],
          },
          { pageId: 'p2', title: '第二页', blocks: [{ blockId: 'p2-b1', blockType: 'TEXT', text: 'world' }] },
        ],
      },
    });
    // 块级命中：仅改 p1-b1
    await call('version_create', {
      deckId,
      instruction: '改块一',
      scope: { pageId: 'p1', blockId: 'p1-b1' },
      content: {
        pages: [
          {
            pageId: 'p1',
            title: '第一页（改）',
            blocks: [
              { blockId: 'p1-b1', blockType: 'TEXT', text: '块一（改）' },
              { blockId: 'p1-b2', blockType: 'TEXT', text: '块二' },
            ],
          },
          { pageId: 'p2', title: '第二页', blocks: [{ blockId: 'p2-b1', blockType: 'TEXT', text: 'world' }] },
        ],
      },
    });
    // 越界：动了非目标块 p1-b2
    await callExpectError('version_create', {
      deckId,
      instruction: '越界改块二',
      scope: { pageId: 'p1', blockId: 'p1-b1' },
      content: {
        pages: [
          {
            pageId: 'p1',
            title: '第一页（改）',
            blocks: [
              { blockId: 'p1-b1', blockType: 'TEXT', text: '块一（改）' },
              { blockId: 'p1-b2', blockType: 'TEXT', text: '块二（被改）' },
            ],
          },
          { pageId: 'p2', title: '第二页', blocks: [{ blockId: 'p2-b1', blockType: 'TEXT', text: 'world' }] },
        ],
      },
    });
    expect(base.versionId).toBeTruthy();
  });

  it('version_tree / version_get / version_compare', async () => {
    const tree = await call('version_tree', { deckId, branchScope: 'ALL' });
    expect(tree.activeBranch).toBe('main');
    expect(tree.currentVersionId).toBeTruthy();
    const detail = await call('version_get', { versionId: v1 });
    expect((detail.content as any).pages).toHaveLength(2);
    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const cmp = await call('version_compare', {
      deckId,
      leftVersionId: v1,
      rightVersionId: v2,
    });
    expect(cmp.sameHash).toBe(false);
    expect(cmp.pages.length).toBe(2);
    // 同版本对比拒绝
    await callExpectError('version_compare', {
      deckId,
      leftVersionId: v1,
      rightVersionId: v1,
    });
  });

  it('version_rollback 移指针（历史不动）', async () => {
    await call('version_rollback', { deckId, versionId: v1 });
    const detail = await call('deck_get', { deckId });
    expect(detail.currentVersionId).toBe(v1);
    const tree = await call('version_tree', { deckId, branchScope: 'ALL' });
    expect(tree.tree.length).toBeGreaterThan(0);
  });

  it('version_fork 新分支 + 活动分支切换', async () => {
    await call('version_fork', { deckId, versionId: v2, branchName: 'alt' });
    const tree = await call('version_tree', { deckId, branchScope: 'ALL' });
    expect(tree.activeBranch).toBe('alt');
    expect(tree.branches.map((b: any) => b.branchName)).toContain('alt');
    // 重名分支拒绝
    await callExpectError('version_fork', { deckId, versionId: v2, branchName: 'alt' });
  });

  it('deck_finalize / unfinalize 状态机', async () => {
    await call('deck_finalize', { deckId });
    let detail = await call('deck_get', { deckId });
    expect(detail.deckStatus).toBe('FINALIZED');
    expect(detail.finalVersionId).toBeTruthy();
    // FINALIZED 禁止再写版本（movePointer 守卫）
    await callExpectError('version_create', {
      deckId,
      instruction: '定稿后写版本',
      content: content([{ pageId: 'p1', title: 'x', text: 'y' }]),
    });
    await call('deck_unfinalize', { deckId });
    detail = await call('deck_get', { deckId });
    expect(detail.deckStatus).toBe('ITERATING');
  });

  it('asset_add + IMAGE 块引用计数（INV-18）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-loop-mcp-test-'));
    const file = join(dir, 'pixel.png');
    writeFileSync(file, PNG_1PX);
    const asset = await call('asset_add', { filePath: file, assetName: '像素' });
    const assetId = asset.assetId;
    expect(assetId).toBeTruthy();
    // 同 hash 重传 → 复用（INV-20）
    const again = await call('asset_add', { filePath: file });
    expect(again.assetId).toBe(assetId);
    // 引用进版本
    await call('version_create', {
      deckId,
      instruction: '加图片页',
      content: content([{ pageId: 'p9', title: '图片页', text: '说明', assetId }]),
    });
    const list = await call('asset_list', { keyword: '像素' });
    const row = list.records.find((r: any) => r.assetId === assetId);
    expect(row.refCount).toBeGreaterThanOrEqual(1);
  });

  it('无版本 deck 定稿拒绝', async () => {
    const fresh = await call('deck_create', { deckName: '空 deck', topic: 'x' });
    await callExpectError('deck_finalize', { deckId: fresh.deckId });
  });

  it('brandkit_save / list / set_default + deck 引用（INV-7）', async () => {
    const kit = await call('brandkit_save', {
      kitName: '钢蓝规范',
      colors: { primary: '6B8AB5', assistants: ['1F2937'] },
      fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
    });
    expect(kit.brandKitId).toBeTruthy();
    await call('brandkit_set_default', { brandKitId: kit.brandKitId });
    const list = await call('brandkit_list', { keyword: '钢蓝' });
    expect(list.total).toBe(1);
    // deck 引用默认规范
    const withKit = await call('deck_create', {
      deckName: '带规范',
      topic: 'x',
      defaultBrandKitId: kit.brandKitId,
    });
    expect(withKit.deckId).toBeTruthy();
    // 不存在的规范拒绝（INV-7）
    await callExpectError('deck_create', {
      deckName: '坏规范',
      topic: 'x',
      defaultBrandKitId: 'nonexistent000000000000000000',
    });
  });

  it('prompt_save / list + 占位符语法守卫（INV-21）', async () => {
    const tpl = await call('prompt_save', {
      title: '整稿指令',
      content: '为{受众}生成关于{主题}的演示，风格{风格}',
      templateScene: 'WHOLE',
    });
    expect(tpl.templateId).toBeTruthy();
    const list = await call('prompt_list', { templateScene: 'WHOLE' });
    expect(list.total).toBeGreaterThanOrEqual(1);
    // 非法占位符拒绝
    await callExpectError('prompt_save', {
      title: '坏占位符',
      content: '含{非法 空白}占位符',
      templateScene: 'TARGETED',
    });
  });
});