/**
 * outline-save 迁移端点集成测试（POST /deck/deck/outline-save，api-web-agent §4.3，
 * ADR-018 自 /gen/outline/save 迁入；AO/VO 逐字沿用）。
 *
 * 覆盖：DRAFT 守卫（首版后只读，BIZ_DECK_OUTLINE_INVALID）、属主隔离、
 * 节点序列化（nodeId 补全/points 剔空白/note/pageHint 空不落键）、
 * 节点校验（1~50/title≤50）、双凭证（会话或 token）、旧路径退役（404）。
 */
import request from 'supertest';
import { DeckDomainService } from '../src/deck/deck.domain-service';
import {
  TestContext,
  archiveVersion,
  createDeck,
  issueToken,
  okData,
  bizFail,
  postJson,
  postWithToken,
  textPageContent,
} from './helpers/testing-app';

describe('outline-save 迁移（api-web-agent §4.3）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('DRAFT 保存-序列化落 draft_outline（nodeId 补全/空键不落）；detail 可读', async () => {
    const session = await ctx.newSession('ol');
    const deckId = await createDeck(ctx, session);
    okData(
      await postJson(ctx, session, '/deck/deck/outline-save', {
        deckId,
        outline: [
          { title: '背景', points: ['订阅错配', '  ', 'MCP 形态'], pageHint: 1 },
          { title: '方案', points: ['agent 直写'], note: '备注' },
        ],
      }),
      '保存大纲',
    );
    const detail = okData(await postJson(ctx, session, '/deck/deck/detail', { deckId }), '详情');
    const outline = detail.draftOutline as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(outline)).toBe(true);
    expect(outline[0].nodeId).toBe('n1');
    expect(outline[0].points).toEqual(['订阅错配', 'MCP 形态']);
    expect(outline[0].pageHint).toBe(1);
    expect(outline[0].note).toBeUndefined();
    expect(outline[1].nodeId).toBe('n2');
    expect(outline[1].note).toBe('备注');
  });

  it('DRAFT 守卫-首版后只读（BIZ_DECK_OUTLINE_INVALID，替代原 BIZ_TASK_SCOPE_INVALID）', async () => {
    const session = await ctx.newSession('ol2');
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'));
    // 首版后 deck=ITERATING（archiveVersion 不自动流转，经 toIterating 同款编排）
    await ctx.get(DeckDomainService).onFirstVersionCreated(deckId, session.userId);
    bizFail(
      await postJson(ctx, session, '/deck/deck/outline-save', {
        deckId,
        outline: [{ title: 'x' }],
      }),
      'BIZ_DECK_OUTLINE_INVALID',
      '首版后只读',
    );
  });

  it('属主隔离-他人 deck 拒绝；节点校验（空/超 50/title 超长）', async () => {
    const session = await ctx.newSession('ol3');
    const other = await ctx.newSession('ol3b');
    const deckId = await createDeck(ctx, session);

    bizFail(
      await postJson(ctx, other, '/deck/deck/outline-save', {
        deckId,
        outline: [{ title: '越权' }],
      }),
      'BIZ_DECK_NOT_FOUND',
      '他人 deck 拒绝',
    );
    // 空大纲
    const empty = await postJson(ctx, session, '/deck/deck/outline-save', { deckId, outline: [] });
    expect((empty as { status: boolean }).status).toBe(false);
    // 超 50 节点
    const tooMany = await postJson(ctx, session, '/deck/deck/outline-save', {
      deckId,
      outline: Array.from({ length: 51 }, (_, i) => ({ title: `n${i}` })),
    });
    expect((tooMany as { status: boolean }).status).toBe(false);
    // title 超 50
    const longTitle = await postJson(ctx, session, '/deck/deck/outline-save', {
      deckId,
      outline: [{ title: 'a'.repeat(51) }],
    });
    expect((longTitle as { status: boolean }).status).toBe(false);
  });

  it('双凭证-个人 token 可保存（MCP outline_save 远程映射）；旧路径 /gen/outline/save 退役', async () => {
    const session = await ctx.newSession('ol4');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    okData(
      await postWithToken(ctx, token, '/deck/deck/outline-save', {
        deckId,
        outline: [{ nodeId: 'n1', title: '远程大纲', points: ['token 凭证'] }],
      }),
      'token 保存大纲',
    );
    const detail = okData(await postJson(ctx, session, '/deck/deck/detail', { deckId }), '详情');
    const outline = detail.draftOutline as unknown as Array<Record<string, unknown>>;
    expect(outline[0].title).toBe('远程大纲');

    // 旧路径退役（generation 模块删除 → 路由不存在，全局 Filter 转 Result 失败）
    const legacy = await request(ctx.server as never)
      .post('/gen/outline/save')
      .set('x-auth-token', session.token)
      .send({ deckId, outline: [{ title: 'x' }] });
    expect(legacy.status).toBe(200);
    expect((legacy.body as { status: boolean }).status).toBe(false);
  });
});