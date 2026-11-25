/**
 * 一条端到端主链路（ADR-018 agent 直写形态，原 EndToEndFlowTest 网关链退役）：
 * 注册→登录→建 deck→保存大纲（/deck/deck/outline-save 迁移端点）→签发个人 token→
 * agent 直写首版（FULL_GENERATE，DRAFT→ITERATING）→整稿调整（FULL_ADJUST 二版）→
 * 版本对比→定稿→导出（submit→upload 回传）→票据→下载→演示数据。
 *
 * 下载走 GET /deliver/export/download HTTP 全管道（@Public+凭证自证；
 * Content-Disposition 覆盖）。agent-create 仅 X-Api-Token（会话拒绝）。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  TestContext,
  TEST_PASSWORD,
  issueToken,
  okData,
  bizFail,
  postPublic,
  postJson,
  postWithToken,
} from './helpers/testing-app';

describe('E2E 全链路（ADR-018 agent 直写）', () => {
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

  it('注册→建 deck→大纲→token→agent 首版→调整二版→对比→定稿→导出→下载→演示数据', async () => {
    // 1. 注册 + 登录（accountId 即业务 userId）
    const tag = `e2e-${process.pid.toString(36)}-${Date.now().toString(36)}`;
    const email = `${tag}@e2e.test`;
    const register = okData(
      await postPublic(ctx, 'register', {
        email,
        password: TEST_PASSWORD,
        nickname: 'e2e 用户',
      }),
      '注册',
    );
    const accountId = register.accountId;
    const login = okData(
      await postPublic(ctx, 'login', { email, password: TEST_PASSWORD }),
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

    // 3. 保存大纲（迁移端点 /deck/deck/outline-save，AO/VO 不变）
    okData(
      await postJson(ctx, session, '/deck/deck/outline-save', {
        deckId,
        outline: [
          { nodeId: 'n1', title: '问题', points: ['行业痛点'] },
          { nodeId: 'n2', title: '方案', points: ['产品能力'] },
          { nodeId: 'n3', title: '融资', points: ['额度与用途'] },
        ],
      }),
      '保存大纲',
    );

    // 4. 签发个人 token（明文仅此次）；agent-create 仅认 token（会话拒绝）
    const issued = await issueToken(ctx, session, { tokenName: 'e2e agent' });
    expect(issued.token).toMatch(/^dlpat_[A-Za-z0-9_-]{43}$/);
    bizFail(
      await postJson(ctx, session, '/ver/version/agent-create', {
        deckId,
        instruction: '会话写版本',
        content: { pages: [{ pageId: 'p1', blocks: [] }] },
      }),
      'BIZ_AUTH_TOKEN_INVALID',
      '会话不可调用 agent-create',
    );

    // 5. agent 直写首版（FULL_GENERATE；DRAFT→ITERATING；taskId=agent-<snowflake> 不建任务行）
    const gen1 = okData(
      await postWithToken(ctx, issued.token, '/ver/version/agent-create', {
        deckId,
        instruction: '按大纲生成三页整稿',
        content: {
          pages: [
            { pageId: 'p1', title: '问题', blocks: [{ blockId: 'b1', blockType: 'TEXT', text: '行业痛点' }] },
            { pageId: 'p2', title: '方案', blocks: [{ blockId: 'b2', blockType: 'TEXT', text: '产品能力' }] },
            { pageId: 'p3', title: '融资', blocks: [{ blockId: 'b3', blockType: 'TEXT', text: '额度与用途' }] },
          ],
        },
      }),
      'agent 首版',
    );
    const v1 = gen1.versionId;
    expect(gen1.versionSeq).toBe(1);
    expect(gen1.sourceType).toBe('FULL_GENERATE');
    expect(gen1.taskId).toMatch(/^agent-\d+$/);
    expect(gen1.branchName).toBe('main');
    const taskRows = await ctx
      .dataSource()
      .query('SELECT COUNT(*)::int AS cnt FROM dl_generation_task WHERE task_id = $1', [gen1.taskId]);
    expect(Number(taskRows[0].cnt)).toBe(0);

    const deckDetail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '首版后 deck',
    );
    expect(deckDetail.deckStatus).toBe('ITERATING');
    expect(deckDetail.currentVersionId).toBe(v1);

    // 6. 整稿调整（基线=当前）→ 二版（FULL_ADJUST）
    const adjust = okData(
      await postWithToken(ctx, issued.token, '/ver/version/agent-create', {
        deckId,
        instruction: '整体语气更自信',
        content: {
          pages: [
            { pageId: 'p1', title: '问题', blocks: [{ blockId: 'b1', blockType: 'TEXT', text: '行业痛点（自信版）' }] },
            { pageId: 'p2', title: '方案', blocks: [{ blockId: 'b2', blockType: 'TEXT', text: '产品能力' }] },
            { pageId: 'p3', title: '融资', blocks: [{ blockId: 'b3', blockType: 'TEXT', text: '额度与用途' }] },
          ],
        },
      }),
      'agent 整稿调整',
    );
    const v2 = adjust.versionId;
    expect(adjust.versionSeq).toBe(2);
    expect(adjust.sourceType).toBe('FULL_ADJUST');
    expect(v2).not.toBe(v1);

    // 7. 版本对比（内容不同 → 非 sameHash；树 v1→v2）
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

    // 8. 定稿
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

    // 9. 导出（ADR-015 零渲染：submit 创建意图 → MCP/客户端回传产物）→ 票据 → 下载
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
    expect(okData(uploadRes.body, '产物回传').exportStatus).toBe('SUCCEEDED');

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

    // 10. 演示数据（FINALIZED 定稿版本组装）
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