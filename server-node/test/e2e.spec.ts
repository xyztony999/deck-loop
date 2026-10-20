/**
 * 一条端到端主链路（v1 EndToEndFlowTest 平移，业务预期不变；Mock 网关全真异步回调）：
 * 注册→登录→建 deck→保存大纲→整稿生成（首版）→整稿调整（二版）→版本对比→
 * 定稿→导出→票据→下载→演示数据。
 *
 * 下载走 GET /deliver/export/download HTTP 全管道（@Public+凭证自证；
 * v1 经服务直调，v3 端点可用，HTTP 覆盖含 Content-Disposition）。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  TestContext,
  awaitTaskTerminal,
  okData,
  postPublic,
  postJson,
} from './helpers/testing-app';

const AWAIT_MS = 30_000;

describe('E2E 全链路（EndToEndFlowTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // 导出产物落盘指向临时目录（不污染仓库工作区）
    process.env.EXPORT_ARTIFACT_DIR = join(tmpdir(), 'deck-loop-test-exports');
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.EXPORT_ARTIFACT_DIR;
  });

  it('注册→建 deck→大纲→整稿→首版→调整→二版→对比→定稿→导出→下载→演示数据', async () => {
    // 1. 注册 + 登录（accountId 即业务 userId）
    const tag = `e2e-${process.pid.toString(36)}-${Date.now().toString(36)}`;
    const email = `${tag}@e2e.test`;
    const register = okData(
      await postPublic(ctx, '/auth/account/register', {
        email,
        password: 'passw0rd!',
        nickname: 'e2e 用户',
      }),
      '注册',
    );
    const accountId = register.accountId;
    const login = okData(
      await postPublic(ctx, '/auth/account/login', { email, password: 'passw0rd!' }),
      '登录',
    );
    expect(login.token).toBeTruthy();
    const session = { userId: accountId, token: login.token, email };

    // 2. 建 deck
    const deck = okData(
      await postJson(ctx, session, '/deck/deck/save', {
        deckName: '融资路演',
        deckType: 'DECK',
        topic: 'A 轮融资计划',
        requirement: '面向机构投资人',
      }),
      '建 deck',
    );
    const deckId = deck.deckId;

    // 3. 保存大纲
    okData(
      await postJson(ctx, session, '/gen/outline/save', {
        deckId,
        outline: [
          { nodeId: 'n1', title: '问题', points: ['行业痛点'] },
          { nodeId: 'n2', title: '方案', points: ['产品能力'] },
          { nodeId: 'n3', title: '融资', points: ['额度与用途'] },
        ],
      }),
      '保存大纲',
    );

    // 4. 整稿生成（useDraft）→ 首版
    const gen1 = okData(
      await postJson(ctx, session, '/gen/full/generate', { deckId, useDraft: true }),
      '整稿生成',
    );
    const gen1Terminal = await awaitTaskTerminal(ctx, session, gen1.taskId, AWAIT_MS);
    expect(gen1Terminal.taskStatus).toBe('SUCCEEDED');
    const v1 = gen1Terminal.resultVersionId;
    expect(v1).toBeTruthy();

    const deckDetail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '首版后 deck',
    );
    expect(deckDetail.deckStatus).toBe('ITERATING');
    expect(deckDetail.currentVersionId).toBe(v1);

    // 5. 整稿调整（基线=当前）→ 二版
    const adjust = okData(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: v1,
        instructionText: '整体语气更自信',
      }),
      '整稿调整',
    );
    expect(adjust.needForkBranch).toBe(false);
    const adjustTerminal = await awaitTaskTerminal(ctx, session, adjust.taskId, AWAIT_MS);
    expect(adjustTerminal.taskStatus).toBe('SUCCEEDED');
    const v2 = adjustTerminal.resultVersionId;
    expect(v2).toBeTruthy();
    expect(v2).not.toBe(v1);

    // 6. 版本对比（Mock 产物内容不同 → 非 sameHash；树 v1→v2）
    const compare = okData(
      await postJson(ctx, session, '/ver/version/compare', {
        deckId,
        leftVersionId: v1,
        rightVersionId: v2,
      }),
      '版本对比',
    );
    expect(compare.sameHash).toBe(false);
    const tree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }),
      '版本树',
    );
    expect(tree.activeBranch).toBe('main');
    expect(tree.currentVersionId).toBe(v2);

    // 7. 定稿
    okData(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: true }),
      '定稿',
    );
    const finalized = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '定稿后 deck',
    );
    expect(finalized.deckStatus).toBe('FINALIZED');
    expect(finalized.finalVersionId).toBe(v2);

    // 8. 导出（ADR-015 客户端渲染：submit 创建意图 → 客户端回传产物）→ 票据 → 下载
    const exportSubmit = okData(
      await postJson(ctx, session, '/deliver/export/submit', { deckId, exportFormat: 'PDF' }),
      '发起导出',
    );
    const exportId = exportSubmit.exportId;
    const pdfFixture = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.from('\n%%EOF\n', 'latin1'),
    ]);
    const uploadRes = await request(ctx.server as never)
      .post('/deliver/export/upload')
      .set('x-auth-token', session.token)
      .field('exportId', exportId)
      .attach('file', pdfFixture, 'deck.pdf');
    expect(uploadRes.status).toBe(200);
    expect(okData(uploadRes.body, '客户端回传产物').exportStatus).toBe('SUCCEEDED');

    const ticket = okData(
      await postJson(ctx, session, '/deliver/export/download-ticket', { exportId }),
      '签发票据',
    );
    const url: string = ticket.url;
    const token = decodeURIComponent(url.slice(url.indexOf('token=') + 'token='.length));

    const artifact = await request(ctx.server as never)
      .get(`/deliver/export/download?exportId=${exportId}&token=${encodeURIComponent(token)}`);
    expect(artifact.status).toBe(200);
    expect(artifact.body.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(String(artifact.headers['content-disposition'])).toContain('.pdf');
    expect(artifact.headers['content-type']).toBe('application/pdf');

    // 9. 演示数据（FINALIZED 定稿版本组装）
    const present = okData(
      await postJson(ctx, session, '/deliver/present/data', { deckId }),
      '演示数据',
    );
    expect(present.deckId).toBe(deckId);
    expect(present.deckName).toBe('融资路演');
    expect(present.finalVersionSeq).toBe(2);
    expect(present.pages.length).toBeGreaterThan(0);
  });
});
