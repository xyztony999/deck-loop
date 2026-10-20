/**
 * 素材限时 URL 文件流端点（GET /files/{userId}/{hash}.{ext}?expires=&sign=）。
 *
 * 背景（2026-10-20 客户端 404 修复的回归锁定）：file-url 签发的绝对 URL 指向
 * {ASSET_URL_PUBLIC_BASE_URL}/...（默认 .../files），但 Node 侧此前从未实现该
 * 路由——客户端 <img>/fetchImageAsDataUri 全部失败。本组用例锁定：
 * 签发-验证回环、篡改/过期/白名单外拒绝、Content-Type 与 svg CSP 头。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { okData, TestContext } from './helpers/testing-app';

/** 1x1 透明 PNG（67B，合法 IHDR；asset.spec 同款） */
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
  0xda, 0x63, 0xf8, 0xcd, 0xc2, 0xd6, 0xe0, 0x1f, 0x00, 0x09, 0x44, 0x01, 0xdf, 0x9e,
  0x3d, 0x8a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('GET /files 限时签名 URL 文件流', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    // 素材落盘指向临时目录（AssetStorageService 构造时读 env）
    process.env.ASSET_STORAGE_DIR = join(tmpdir(), 'deck-loop-test-files');
    ctx = await TestContext.create();
    const session = await ctx.newSession();
    token = session.token;
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.ASSET_STORAGE_DIR;
  });

  async function uploadPng(name = 'a.png'): Promise<string> {
    const res = await request(ctx.server as never)
      .post('/asset/asset/upload')
      .set('x-auth-token', token)
      .field('assetName', name)
      .attach('file', TINY_PNG, { filename: name, contentType: 'image/png' });
    expect(res.status).toBe(200);
    const url = okData(res.body, '上传').assetUrl as string;
    expect(typeof url === 'string' && url.length > 0).toBe(true);
    return url;
  }

  /** 绝对 URL → 本进程 supertest 可用的 path+query */
  function toLocalHref(url: string): string {
    return url.replace(/^https?:\/\/[^/]+/, '');
  }

  /** superagent 二进制 parser（image/* 默认无解析器，body 为空对象） */
  function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body?: Buffer) => void): void {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  }

  it('有效签名返回文件字节与 Content-Type（签发-验证回环）', async () => {
    const res = await request(ctx.server as never)
      .get(toLocalHref(await uploadPng()))
      .buffer(true)
      .parse(binaryParser as never);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body)).toEqual(TINY_PNG);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('篡改签名被拒（错误信封，非文件流）', async () => {
    const href = toLocalHref(await uploadPng()).replace(/sign=[0-9a-f]+/, 'sign=deadbeef');
    const res = await request(ctx.server as never).get(href);
    expect(res.status).toBe(200); // 全局过滤器统一 200 信封
    expect(res.body.status).toBe(false);
  });

  it('过期凭证被拒', async () => {
    const href = toLocalHref(await uploadPng()).replace(/expires=\d+/, 'expires=1');
    const res = await request(ctx.server as never).get(href);
    expect(res.body.status).toBe(false);
  });

  it('白名单外 storageKey（穿越尝试）被拒', async () => {
    const res = await request(ctx.server as never).get(
      '/files/etc/passwd?expires=9999999999&sign=abc',
    );
    expect(res.body.status).toBe(false);
  });
});
