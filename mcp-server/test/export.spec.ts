/**
 * ADR-017 Phase 2 冒烟：headless 三格式导出 + HTML 预览（真实 Edge 渲染）。
 * 取代冻结的 Tauri 三格式手工冒烟——版式/中文/图片/魔数/落账全链路自动验证。
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLocalCore, type LocalCore } from '@deck-loop/core/dist/local';
import Database from 'better-sqlite3';
import { createMcpServer } from '../src/app';
import type { LocalPaths } from '../src/paths';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('headless 三格式导出冒烟', () => {
  let core: LocalCore;
  let client: Client;
  let paths: LocalPaths;
  let deckId: string;

  beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), 'deck-loop-export-'));
    paths = {
      home,
      database: join(home, 'test.db'),
      assetsDir: join(home, 'assets'),
      artifactsDir: join(home, 'artifacts'),
      previewsDir: join(home, 'previews'),
    };
    process.env.ASSET_STORAGE_DIR = paths.assetsDir;
    process.env.EXPORT_ARTIFACT_DIR = paths.artifactsDir;
    core = await createLocalCore({ database: paths.database, driver: Database });
    const server = createMcpServer(core, paths);
    client = new Client({ name: 'export-test', version: '0.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    // 备料：deck + 素材 + 两页中文整稿（含图片块）+ 定稿
    const deck = await call('deck_create', { deckName: '导出冒烟', topic: '三格式' });
    deckId = deck.deckId;
    const img = join(home, 'pixel.png');
    writeFileSync(img, PNG_1PX);
    const asset = await call('asset_add', { filePath: img, assetName: '像素' });
    await call('version_create', {
      deckId,
      instruction: '生成中文整稿',
      content: {
        pages: [
          {
            pageId: 'p1',
            layout: 'TITLE_BODY',
            title: '本地优先 MCP',
            note: '第一页备注',
            blocks: [
              { blockId: 'b1', blockType: 'TEXT', text: 'coding plan 出推理，deck-loop 出状态机。\n第二行文本。' },
              { blockId: 'b2', blockType: 'IMAGE', assetId: asset.assetId },
            ],
          },
          {
            pageId: 'p2',
            title: '第二页',
            blocks: [{ blockId: 'b3', blockType: 'TEXT', text: '版本树 · 不变性 · 三格式导出' }],
          },
        ],
      },
    });
    await call('deck_finalize', { deckId });
  }, 120000);

  afterAll(async () => {
    await client.close();
    await core.close();
  });

  async function call(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? '{}';
    const data = JSON.parse(text);
    if (res.isError) {
      throw new Error(`${name} 失败: ${data.message ?? text}`);
    }
    return data;
  }

  it('PDF：%PDF 魔数 + 落账 SUCCEEDED', async () => {
    const vo = await call('export_deck', { deckId, exportFormat: 'PDF' });
    expect(vo.filePath).toBeTruthy();
    expect(existsSync(vo.filePath)).toBe(true);
    const bytes = readFileSync(vo.filePath);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  }, 120000);

  it('IMAGES：ZIP 魔数 + 两页 PNG', async () => {
    const vo = await call('export_deck', { deckId, exportFormat: 'IMAGES' });
    const bytes = readFileSync(vo.filePath);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toContain('slide-001.png');
    expect(names).toContain('slide-002.png');
    const png = await zip.file('slide-001.png')!.async('nodebuffer');
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  }, 120000);

  it('PPTX：ZIP 魔数 + 可编辑文本层', async () => {
    const vo = await call('export_deck', { deckId, exportFormat: 'PPTX', confirm: true });
    const bytes = readFileSync(vo.filePath);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain('ppt/slides/slide1.xml');
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('本地优先');
    expect(slideXml).toContain('Microsoft YaHei');
  }, 120000);

  it('export_list：三条 SUCCEEDED 记录', async () => {
    const page = await call('export_list', { deckId });
    expect(page.total).toBe(3);
    for (const row of page.records) {
      expect(row.exportStatus).toBe('SUCCEEDED');
    }
  });

  it('preview_deck：HTML 放映文件（不自动打开）', async () => {
    const vo = await call('preview_deck', { deckId, open: false });
    expect(existsSync(vo.filePath)).toBe(true);
    const html = readFileSync(vo.filePath, 'utf8');
    expect(html).toContain('本地优先 MCP');
    expect(html).toContain('class="slide"');
    expect(html).toContain('ArrowRight');
    expect(vo.pageCount).toBe(2);
  });

  it('未定稿导出拒绝（FINALIZED 守卫）', async () => {
    const fresh = await call('deck_create', { deckName: '未定稿', topic: 'x' });
    await call('version_create', {
      deckId: fresh.deckId,
      instruction: '一页',
      content: { pages: [{ pageId: 'p1', title: 't', blocks: [{ blockId: 'b1', blockType: 'TEXT', text: 'x' }] }] },
    });
    const res = await client.callTool({
      name: 'export_deck',
      arguments: { deckId: fresh.deckId, exportFormat: 'PDF' },
    });
    expect(res.isError).toBe(true);
  });
});