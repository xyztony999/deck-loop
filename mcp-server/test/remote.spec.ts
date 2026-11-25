/**
 * ADR-018 MCP 远程模式集成测试：RemoteClient 对**真实本地 HTTP 服务**（node:http
 * 模拟 deck-loop-core Result 信封）跑 MCP 全管道（InMemoryTransport）。
 *
 * 覆盖：28 tools 名称一致 / X-Api-Token 鉴权头 / agent-create 映射 / outline-save
 * 迁移端点 / 错误透传（BIZ_* 原样 + token 无效提示映射）/ 网络不可达归一码 /
 * export_deck 远程编排（submit→detail→本地 PPTX 渲染→upload 回传）/ 渲染失败 fail 回传 /
 * preview_deck 远程取 content + 签名 URL 取图 → 本地 HTML / asset_add multipart。
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerWithBackend } from '../src/server';
import { RemoteClient } from '../src/tools/remote-client';
import type { LocalPaths } from '../src/paths';

const TEST_TOKEN = 'dlpat_test-token-0000000000000000000000000000000';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 单页内容（TEXT + IMAGE 块，签名 URL 取图链路） */
const CONTENT = {
  pages: [
    {
      pageId: 'p1',
      title: '远程整稿',
      blocks: [
        { blockId: 'b1', blockType: 'TEXT', text: '云端单源' },
        { blockId: 'b2', blockType: 'IMAGE', assetId: 'a1' },
      ],
    },
  ],
};

interface RecordedRequest {
  path: string;
  token: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

describe('MCP 远程模式（ADR-018 §4.2 / api-web-agent §5.5）', () => {
  let http: Server;
  let port: number;
  let baseUrl: string;
  let client: Client;
  let paths: LocalPaths;
  const requests: RecordedRequest[] = [];
  /** 活跃连接（afterAll 销毁——fetch keep-alive  socket 不释放会阻塞 jest 退出） */
  const sockets = new Set<Socket>();
  /** 路由覆写（错误透传/不可达场景） */
  let overrides: Map<string, (body: Record<string, unknown>) => unknown>;

  const ok = (data: unknown) => ({ status: true, code: '0', msg: 'success', data });
  const biz = (code: string, msg: string) => ({ status: false, code, msg, data: null });

  beforeAll(async () => {
    overrides = new Map();
    http = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const path = (req.url ?? '').split('?')[0];
        requests.push({
          path,
          token: req.headers['x-api-token'] as string | undefined,
          contentType: req.headers['content-type'] as string | undefined,
          body,
        });
        // 签名 URL 文件直出（素材下载链路）
        if (path.startsWith('/files/')) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(PNG_1PX);
          return;
        }
        // multipart（upload）非 JSON——路由仅消费 path/原始 body，入参置空对象
        const isMultipart = String(req.headers['content-type'] ?? '').includes('multipart/form-data');
        const parsed = isMultipart ? {} : (JSON.parse(body.toString('utf8') || '{}') as Record<string, unknown>);
        const override = overrides.get(path);
        const payload: unknown = override !== undefined ? override(parsed) : route(path, parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    http.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api`;

    paths = {
      home: mkdtempSync(join(tmpdir(), 'deck-loop-remote-test-')),
      database: ':memory:',
      assetsDir: join(tmpdir(), 'deck-loop-remote-test-assets'),
      artifactsDir: join(tmpdir(), 'deck-loop-remote-test-artifacts'),
      previewsDir: join(tmpdir(), 'deck-loop-remote-test-previews'),
    };
    const remote = new RemoteClient({ apiUrl: baseUrl, apiToken: TEST_TOKEN });
    const server = createMcpServerWithBackend(remote, paths, 'remote');
    client = new Client({ name: 'remote-test', version: '0.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await client.close();
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  /** 模拟 deck-loop-core 路由（Result 信封；仅覆盖本测试消费的端点） */
  function route(path: string, body: Record<string, unknown>): unknown {
    switch (path) {
      case '/api/deck/deck/save':
        return ok({ deckId: 'd1', deckCode: 'DL2601010001' });
      case '/api/deck/deck/detail':
        return ok({
          deckId: 'd1',
          deckName: '远程演示',
          deckStatus: 'FINALIZED',
          currentVersionId: 'v1',
          finalVersionId: 'v1',
          activeBranch: 'main',
          draftOutline: [{ nodeId: 'n1', title: '背景', points: [] }],
        });
      case '/api/deck/deck/outline-save':
        return ok(null);
      case '/api/deck/deck/finalize':
        return ok(null);
      case '/api/ver/version/agent-create':
        return ok({ versionId: 'v1', versionSeq: 1, sourceType: 'FULL_GENERATE', taskId: 'agent-123', branchName: 'main' });
      case '/api/ver/version/detail':
        return ok({ versionId: 'v1', versionSeq: 1, content: CONTENT, contentHash: 'a'.repeat(64) });
      case '/api/ver/version/tree':
        return ok({ deckId: 'd1', activeBranch: 'main', currentVersionId: 'v1', tree: [], branches: [] });
      case '/api/asset/asset/file-url':
        return ok([{ assetId: 'a1', fileUrl: `http://127.0.0.1:${port}/files/u1/a1.png`, expiresIn: 1800 }]);
      case '/api/asset/asset/upload':
        return ok({ assetId: 'a1', duplicated: false });
      case '/api/asset/asset/list':
        return ok({ records: [], total: 0, pageNum: 1, pageSize: 20 });
      case '/api/deliver/export/submit':
        return ok({ exportId: 'ex1', exportStatus: 'QUEUED', needConfirm: false });
      case '/api/deliver/export/upload':
        return ok({ exportId: 'ex1', exportStatus: 'SUCCEEDED', needConfirm: false });
      case '/api/deliver/export/fail':
        return ok(null);
      case '/api/deliver/export/list':
        return ok({ records: [], total: 0, pageNum: 1, pageSize: 20 });
      default:
        return biz('BIZ_DECK_NOT_FOUND', `未模拟的路由 ${path}`);
    }
  }

  async function call(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
    const data = JSON.parse(text);
    if (res.isError) {
      const err = new Error(data.message ?? 'tool error') as Error & { code?: string };
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function callExpectError(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    expect(res.isError).toBe(true);
    return JSON.parse((res.content as Array<{ text: string }>)[0].text);
  }

  it('tools/list 暴露 28 tools（与本地模式名称一致）', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'deck_create', 'deck_list', 'deck_get', 'deck_update', 'outline_save',
        'deck_finalize', 'deck_unfinalize', 'deck_archive', 'deck_restore', 'deck_delete',
        'version_create', 'version_tree', 'version_get', 'version_compare', 'version_rollback', 'version_fork',
        'asset_add', 'asset_list',
        'brandkit_save', 'brandkit_list', 'brandkit_set_default', 'brandkit_delete',
        'prompt_save', 'prompt_list', 'prompt_delete',
        'export_deck', 'export_list', 'preview_deck',
      ].sort(),
    );
  });

  it('deck_create/outline_save/version_create HTTP 映射 + X-Api-Token 头', async () => {
    requests.length = 0;
    const deck = await call('deck_create', { deckName: '远程演示', topic: '云端单源' });
    expect(deck.deckId).toBe('d1');
    await call('outline_save', { deckId: 'd1', nodes: [{ title: '背景', points: ['云端'] }] });
    const vo = await call('version_create', {
      deckId: 'd1',
      instruction: '生成整稿',
      content: CONTENT,
    });
    expect(vo).toEqual({ versionId: 'v1', versionSeq: 1, sourceType: 'FULL_GENERATE', taskId: 'agent-123', branchName: 'main' });

    const pathsHit = requests.map((r) => r.path);
    expect(pathsHit).toContain('/api/deck/deck/save');
    expect(pathsHit).toContain('/api/deck/deck/outline-save'); // 迁移端点
    expect(pathsHit).toContain('/api/ver/version/agent-create'); // 唯一内容写入口
    for (const r of requests) {
      expect(r.token).toBe(TEST_TOKEN);
      expect(r.contentType).toContain('application/json');
    }
    const agentCreate = requests.find((r) => r.path === '/api/ver/version/agent-create');
    const payload = JSON.parse(agentCreate!.body.toString('utf8'));
    expect(payload.instruction).toBe('生成整稿');
    expect(payload.content.pages).toHaveLength(1);
  });

  it('outline_save 本地预校验保留（空 nodes 不发 HTTP）', async () => {
    requests.length = 0;
    const err = await callExpectError('outline_save', { deckId: 'd1', nodes: [] });
    expect(err.code).toBe('BIZ_DECK_OUTLINE_INVALID');
    expect(requests).toHaveLength(0);
  });

  it('错误透传-BIZ_* 码与文案原样（D7 不翻译不吞码）', async () => {
    overrides.set('/api/ver/version/agent-create', () =>
      biz('BIZ_VERSION_TARGET_INVARIANCE', '定向调整产物越界：非目标页被修改 p2'),
    );
    const err = await callExpectError('version_create', {
      deckId: 'd1',
      instruction: '越界',
      scope: { pageId: 'p1' },
      content: CONTENT,
    });
    expect(err.code).toBe('BIZ_VERSION_TARGET_INVARIANCE');
    expect(err.message).toBe('定向调整产物越界：非目标页被修改 p2');
    overrides.delete('/api/ver/version/agent-create');
  });

  it('错误透传-token 无效/会话过期 → 重新签发提示（码保留）', async () => {
    overrides.set('/api/deck/deck/list', () => biz('BIZ_AUTH_TOKEN_INVALID', 'API token 无效或已过期'));
    const err = await callExpectError('deck_list', {});
    expect(err.code).toBe('BIZ_AUTH_TOKEN_INVALID');
    expect(err.message).toBe('token 无效/过期，请在网站设置页重新签发');
    overrides.delete('/api/deck/deck/list');
  });

  it('网络不可达-归一 DECK_LOOP_REMOTE_UNREACHABLE（含 URL，不含 token）', async () => {
    const dead = new RemoteClient({ apiUrl: 'http://127.0.0.1:1/api', apiToken: TEST_TOKEN });
    await expect(dead.deckList({})).rejects.toMatchObject({ code: 'DECK_LOOP_REMOTE_UNREACHABLE' });
    try {
      await dead.deckList({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('http://127.0.0.1:1/api/deck/deck/list');
      expect(message).not.toContain(TEST_TOKEN);
    }
  });

  it('export_deck 远程编排-submit→本地 PPTX 渲染→upload 回传（产物本地副本）', async () => {
    requests.length = 0;
    const vo = await call('export_deck', { deckId: 'd1', exportFormat: 'PPTX', confirm: true });
    expect(vo.exportId).toBe('ex1');
    expect(vo.exportFormat).toBe('PPTX');
    expect(vo.fileSize).toBeGreaterThan(0);
    expect(existsSync(vo.filePath)).toBe(true);
    const pathsHit = requests.map((r) => r.path);
    expect(pathsHit).toContain('/api/deliver/export/submit');
    expect(pathsHit).toContain('/api/deck/deck/detail');
    expect(pathsHit).toContain('/api/ver/version/detail');
    expect(pathsHit).toContain('/api/asset/asset/file-url');
    expect(pathsHit).toContain('/api/deliver/export/upload');
    const upload = requests.find((r) => r.path === '/api/deliver/export/upload');
    expect(upload!.contentType).toContain('multipart/form-data');
    expect(upload!.body.toString('latin1')).toContain('ex1');
    expect(upload!.token).toBe(TEST_TOKEN);
  });

  it('export_deck 渲染失败-fail 回传 errorMsg（FAILED 落账链）', async () => {
    requests.length = 0;
    overrides.set('/api/ver/version/detail', () => ok({ versionId: 'v1', versionSeq: 1, content: { pages: [] } }));
    await callExpectError('export_deck', { deckId: 'd1', exportFormat: 'PPTX', confirm: true });
    const fail = requests.find((r) => r.path === '/api/deliver/export/fail');
    expect(fail).toBeDefined();
    const payload = JSON.parse(fail!.body.toString('utf8'));
    expect(payload.exportId).toBe('ex1');
    expect(String(payload.errorMsg)).toContain('至少一页');
    overrides.delete('/api/ver/version/detail');
  });

  it('preview_deck 远程取 content + 签名 URL 取图 → 本地 HTML（键盘翻页）', async () => {
    requests.length = 0;
    const vo = await call('preview_deck', { deckId: 'd1', open: false });
    expect(vo.pageCount).toBe(1);
    expect(vo.versionId).toBe('v1');
    expect(existsSync(vo.filePath)).toBe(true);
    const html = readFileSync(vo.filePath, 'utf8');
    expect(html).toContain('远程演示');
    expect(html).toContain('data:image/png;base64,'); // 签名 URL 下载转 data URI
    expect(html).toContain('keydown');
    const pathsHit = requests.map((r) => r.path);
    expect(pathsHit).toContain('/api/asset/asset/file-url');
    expect(pathsHit.some((p) => p.startsWith('/files/'))).toBe(true);
  });

  it('asset_add 远程 multipart（file + assetName/category/assetType 字段）', async () => {
    requests.length = 0;
    const dir = mkdtempSync(join(tmpdir(), 'deck-loop-remote-asset-'));
    const file = join(dir, 'pixel.png');
    writeFileSync(file, PNG_1PX);
    const vo = await call('asset_add', { filePath: file, assetName: '像素', category: '图标', assetType: 'IMAGE' });
    expect(vo.assetId).toBe('a1');
    const upload = requests.find((r) => r.path === '/api/asset/asset/upload');
    expect(upload!.contentType).toContain('multipart/form-data');
    const raw = upload!.body.toString('utf8');
    expect(raw).toContain('像素');
    expect(raw).toContain('IMAGE');
    expect(upload!.token).toBe(TEST_TOKEN);
  });

  it('version_get 完整 VO 回执（contentHash 等字段两模式一致）', async () => {
    const detail = await call('version_get', { versionId: 'v1' });
    expect(detail.contentHash).toBe('a'.repeat(64));
    expect(detail.content.pages).toHaveLength(1);
  });
});