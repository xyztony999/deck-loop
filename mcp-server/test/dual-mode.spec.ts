/**
 * ADR-019 双模式市场包集成测试：
 * - sql.js 本地引擎 parity（SwitchableBackend 懒加载 local，wasm 内存库）
 * - remote_connect 登录→签发→落盘→切 remote（真实本地 HTTP mock，密码不落盘）
 * - 动态切换 + 配置持久化（新实例读 config 恢复 remote）
 * - 31 tools（28 业务 + 3 连接）经 InMemoryTransport 全管道
 */
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerWithBackend } from '../src/server';
import { SwitchableBackend } from '../src/tools/switchable-backend';
import { registerAccountTools } from '../src/tools/account';
import type { LocalPaths } from '../src/paths';

const ISSUED_TOKEN = 'dlpat_dual-mode-test-000000000000000000000000';

describe('双模式市场包（ADR-019）', () => {
  let http: Server;
  let baseUrl: string;
  let client: Client;
  let backend: SwitchableBackend;
  let paths: LocalPaths;
  const sockets = new Set<Socket>();
  const seen: Array<{ path: string; token?: string; body: any }> = [];

  beforeAll(async () => {
    process.env.DECK_LOOP_LOCAL_ENGINE = 'sqljs';
    const home = mkdtempSync(join(tmpdir(), 'deck-loop-dual-'));
    paths = {
      home,
      database: join(home, 'dual.db'),
      assetsDir: join(home, 'assets'),
      artifactsDir: join(home, 'artifacts'),
      previewsDir: join(home, 'previews'),
    };

    http = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        seen.push({ path: req.url ?? '', token: req.headers['x-api-token'] as string, body });
        const ok = (data: unknown) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: true, code: '0', msg: 'ok', data, timestamp: Date.now() }));
        };
        if (req.url === '/auth/account/login') return ok({ token: 'session-x', nickname: 'Dual', syncCursor: 0 });
        if (req.url === '/auth/token/issue') return ok({ tokenId: 't1', tokenName: 'deck-loop-plugin', token: ISSUED_TOKEN, tokenPrefix: 'dlpat_dual', expiresAt: null, createdTime: new Date().toISOString() });
        if (req.url === '/deck/deck/save') return ok({ deckId: 'd-remote-1', deckCode: 'DL2611270001' });
        if (req.url === '/deck/deck/list') return ok({ records: [], total: 0, pageNum: 1, pageSize: 20 });
        if (req.url === '/ver/version/tree') return ok({ deckId: 'd-remote-1', tree: [], branches: [], activeBranch: 'main', currentVersionId: null, finalVersionId: null, deckStatus: 'DRAFT' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: false, code: 'BIZ_NOT_MOCKED', msg: req.url, data: null, timestamp: Date.now() }));
      });
    });
    http.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(http.address() as any).port}`;

    backend = new SwitchableBackend(paths, 'local');
    const server = createMcpServerWithBackend(backend, paths, 'local');
    registerAccountTools(server, backend);
    client = new Client({ name: 'dual-test', version: '0.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await client.close();
    await backend.close();
    sockets.forEach((s) => s.destroy());
    await new Promise<void>((r) => http.close(() => r()));
  });

  async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    if (res.isError) throw new Error(`${name}: ${data.message ?? data.code}`);
    return data;
  }

  it('tools/list = 31（28 业务 + 3 连接）', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(31);
    for (const n of ['remote_connect', 'remote_disconnect', 'connection_status']) {
      expect(tools.map((t) => t.name)).toContain(n);
    }
  });

  it('默认 local + sql.js 引擎建 deck（wasm 内存/文件库 parity）', async () => {
    const status = await call('connection_status');
    expect(status.mode).toBe('local');
    const deck = await call('deck_create', { deckName: '本地双模', topic: 'sqljs' });
    expect(deck.deckId).toBeTruthy();
    expect(existsSync(paths.database)).toBe(true); // sql.js autoSave 落盘
    const list = await call('deck_list', {});
    expect(list.total).toBe(1);
  });

  it('remote_connect：登录→签发→切 remote（密码不落盘）', async () => {
    const status = await call('remote_connect', { apiUrl: baseUrl, email: 'dual@x.com', password: 'secret-pw' });
    expect(status.mode).toBe('remote');
    expect(status.tokenPrefix).toBe('dlpat_dual');
    // 登录 + 签发两请求
    expect(seen.some((r) => r.path === '/auth/account/login' && r.body.password === 'secret-pw')).toBe(true);
    expect(seen.some((r) => r.path === '/auth/token/issue')).toBe(true);
    // 配置落盘不含密码
    const cfg = JSON.parse(readFileSync(join(paths.home, 'config.json'), 'utf8'));
    expect(cfg.mode).toBe('remote');
    expect(cfg.token).toBe(ISSUED_TOKEN);
    expect(JSON.stringify(cfg)).not.toContain('secret-pw');
  });

  it('remote 态业务走 HTTP（X-Api-Token 携带）', async () => {
    const deck = await call('deck_create', { deckName: '远程双模', topic: 'http' });
    expect(deck.deckId).toBe('d-remote-1');
    const save = seen.find((r) => r.path === '/deck/deck/save');
    expect(save?.token).toBe(ISSUED_TOKEN);
  });

  it('配置持久化：新实例读 config 恢复 remote', () => {
    const revived = new SwitchableBackend(paths, 'local');
    expect(revived.mode).toBe('remote');
    expect(revived.status().tokenPrefix).toBe('dlpat_dual');
  });

  it('remote_disconnect 回 local，本地库仍在', async () => {
    const status = await call('remote_disconnect');
    expect(status.mode).toBe('local');
    const list = await call('deck_list', {});
    expect(list.total).toBe(1); // 本地那套还在
    const cfg = JSON.parse(readFileSync(join(paths.home, 'config.json'), 'utf8'));
    expect(cfg.mode).toBe('local');
    expect(cfg.token).toBeUndefined();
  });
});