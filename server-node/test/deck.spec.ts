/**
 * deck 域状态机全流转集成测试（v1 DeckManageFlowTest 平移，业务预期不变）。
 *
 * 覆盖：保存/编辑/属主隔离、状态机流转（DRAFT→ITERATING→FINALIZED→ITERATING、
 * 归档/恢复/软删）、守卫序（状态→confirm→无进行中任务→指针锚定）、
 * INV-1 指针回写 FINALIZED 拒（rollback 通道）、INV-3 FINALIZED/ARCHIVED 禁建任务、
 * 进行中任务归档被拒。
 *
 * 状态推进到 ITERATING/FINALIZED 依赖版本存在——版本经回调链同款领域写路径
 * （archiveVersion/toIterating）同步铺底，异步网关链在 generation 域测试覆盖。
 */
import {
  TestContext,
  archiveVersion,
  awaitTaskTerminal,
  createDeck,
  okData,
  bizFail,
  postJson,
  textPageContent,
  toIterating,
} from './helpers/testing-app';

describe('deck 域状态机（DeckManageFlowTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ------------------------------------------------------------------
  // 基础 CRUD / 属主隔离
  // ------------------------------------------------------------------

  it('保存-新建返回 deckId/deckCode（DL 前缀），列表可见，他人不可见（user_id 隔离）', async () => {
    const session = await ctx.newSession();
    const other = await ctx.newSession();

    const saved = okData(
      await postJson(ctx, session, '/deck/deck/save', {
        deckName: '营销方案',
        deckType: 'DECK',
        topic: 'Q4 增长',
      }),
      '新建 deck',
    );
    expect(saved.deckId).toBeTruthy();
    expect(String(saved.deckCode)).toMatch(/^DL/);

    const list = okData(await postJson(ctx, session, '/deck/deck/list', {}), '本人列表');
    expect(list.total).toBe(1);
    expect(list.records[0].deckId).toBe(saved.deckId);
    expect(list.records[0].deckStatus).toBe('DRAFT');

    const otherList = okData(await postJson(ctx, other, '/deck/deck/list', {}), '他人列表');
    expect(otherList.total).toBe(0);

    // 他人 detail 不可见（属主隔离）
    bizFail(
      await postJson(ctx, other, '/deck/deck/detail', { deckId: saved.deckId }),
      'BIZ_DECK_NOT_FOUND',
      '他人详情拒绝',
    );
  });

  it('编辑-改名后 detail 生效；deckCode 不变', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const updated = okData(
      await postJson(ctx, session, '/deck/deck/save', {
        deckId,
        deckName: '改名后的方案',
        deckType: 'DECK',
        topic: 'Q4 增长',
      }),
      '编辑 deck',
    );
    expect(updated.deckId).toBe(deckId);

    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '详情',
    );
    expect(detail.deckName).toBe('改名后的方案');
    expect(detail.deckCode).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // 状态机：ITERATING → FINALIZED → ITERATING；归档/恢复；软删
  // ------------------------------------------------------------------

  it('定稿-ITERATING+confirm+有版本 → FINALIZED 且 finalVersionId=当前指针', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    const v1 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'))
    ).versionId;
    await toIterating(ctx, deckId, session.userId);

    okData(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: true }),
      '定稿',
    );

    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '定稿后详情',
    );
    expect(detail.deckStatus).toBe('FINALIZED');
    expect(detail.finalVersionId).toBe(v1);
    expect(detail.currentVersionId).toBe(v1);
  });

  it('定稿守卫-confirm 缺失 / DRAFT 无版本 → BIZ_DECK_STATUS_FORBIDDEN', async () => {
    const session = await ctx.newSession();

    // DRAFT 无版本
    const draftDeck = await createDeck(ctx, session);
    bizFail(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId: draftDeck, confirm: true }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'DRAFT 定稿拒绝',
    );

    // ITERATING 但 confirm=false（服务守卫拒绝）
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'));
    await toIterating(ctx, deckId, session.userId);
    bizFail(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: false }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      '未确认定稿拒绝',
    );
  });

  it('解锁-FINALIZED+confirm → ITERATING 且 finalVersionId 保留', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    const v1 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'))
    ).versionId;
    await toIterating(ctx, deckId, session.userId);
    okData(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: true }),
      '定稿',
    );

    bizFail(
      await postJson(ctx, session, '/deck/deck/unfinalize', { deckId, confirm: false }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      '解锁未确认拒绝',
    );

    okData(
      await postJson(ctx, session, '/deck/deck/unfinalize', { deckId, confirm: true }),
      '解锁',
    );
    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '解锁后详情',
    );
    expect(detail.deckStatus).toBe('ITERATING');
    expect(detail.finalVersionId).toBe(v1);
  });

  it('归档恢复-ITERATING 归档→ARCHIVED，恢复回 ITERATING；重复归档拒绝', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'));
    await toIterating(ctx, deckId, session.userId);

    okData(await postJson(ctx, session, '/deck/deck/archive', { deckId }), '归档');
    const archived = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '归档后详情',
    );
    expect(archived.deckStatus).toBe('ARCHIVED');

    bizFail(
      await postJson(ctx, session, '/deck/deck/archive', { deckId }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      '重复归档拒绝',
    );

    okData(await postJson(ctx, session, '/deck/deck/restore', { deckId }), '恢复');
    const restored = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '恢复后详情',
    );
    expect(restored.deckStatus).toBe('ITERATING');
  });

  it('软删-仅 ARCHIVED 可删，删除后 detail 404 化（BIZ_DECK_NOT_FOUND）', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    bizFail(
      await postJson(ctx, session, '/deck/deck/delete', { deckId }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'DRAFT 直接删除拒绝',
    );

    okData(await postJson(ctx, session, '/deck/deck/archive', { deckId }), '归档');
    okData(await postJson(ctx, session, '/deck/deck/delete', { deckId }), '删除');

    bizFail(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      'BIZ_DECK_NOT_FOUND',
      '删除后详情不可见',
    );
    const list = okData(await postJson(ctx, session, '/deck/deck/list', {}), '删除后列表');
    expect(list.total).toBe(0);
  });

  // ------------------------------------------------------------------
  // INV-1 指针守卫：FINALIZED 拒绝 movePointer（rollback 通道）
  // ------------------------------------------------------------------

  it('指针守卫-FINALIZED 回退被拒（BIZ_DECK_STATUS_FORBIDDEN），解锁后放行', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    const v1 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'))
    ).versionId;
    await toIterating(ctx, deckId, session.userId);
    const v2 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v2'))
    ).versionId;
    okData(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: true }),
      '定稿',
    );

    // FINALIZED：回退到 v1 被指针守卫拒绝
    bizFail(
      await postJson(ctx, session, '/ver/version/rollback', {
        deckId,
        versionId: v1,
        confirm: true,
      }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'FINALIZED 拒绝移指针',
    );

    // 解锁后同命令放行
    okData(
      await postJson(ctx, session, '/deck/deck/unfinalize', { deckId, confirm: true }),
      '解锁',
    );
    okData(
      await postJson(ctx, session, '/ver/version/rollback', {
        deckId,
        versionId: v1,
        confirm: true,
      }),
      '解锁后回退',
    );
    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '回退后详情',
    );
    expect(detail.currentVersionId).toBe(v1);
    expect(v2).not.toBe(v1);
  });

  // ------------------------------------------------------------------
  // INV-3：FINALIZED/ARCHIVED 创建生成任务被拒
  // ------------------------------------------------------------------

  it('任务守卫-FINALIZED/ARCHIVED 创建生成任务被拒（INV-3）', async () => {
    const session = await ctx.newSession();

    const finalizedDeck = await createDeck(ctx, session);
    await archiveVersion(ctx, finalizedDeck, session.userId, textPageContent('p1', 'b1', 'v1'));
    await toIterating(ctx, finalizedDeck, session.userId);
    okData(
      await postJson(ctx, session, '/deck/deck/finalize', {
        deckId: finalizedDeck,
        confirm: true,
      }),
      '定稿',
    );
    bizFail(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId: finalizedDeck,
        useDraft: true,
        outlineSnapshot: '[{"nodeId":"n1","title":"t"}]',
      }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'FINALIZED 禁建任务',
    );

    const archivedDeck = await createDeck(ctx, session);
    okData(
      await postJson(ctx, session, '/deck/deck/archive', { deckId: archivedDeck }),
      '归档',
    );
    bizFail(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId: archivedDeck,
        useDraft: true,
        outlineSnapshot: '[{"nodeId":"n1","title":"t"}]',
      }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'ARCHIVED 禁建任务',
    );
  });

  it('归档守卫-存在进行中任务时归档被拒（BIZ_DECK_TASK_RUNNING）', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    // 发起整稿生成（Mock 网关异步执行中，QUEUED/RUNNING 窗口内归档应被拒）
    const submit = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: '[{"nodeId":"n1","title":"t"}]',
      }),
      '发起生成',
    );

    bizFail(
      await postJson(ctx, session, '/deck/deck/archive', { deckId }),
      'BIZ_DECK_TASK_RUNNING',
      '进行中任务归档被拒',
    );

    // 等任务终态后归档放行（Mock 任务成功后 deck 转 ITERATING，归档合法）
    await awaitTaskTerminal(ctx, session, submit.taskId, 20_000);
    okData(await postJson(ctx, session, '/deck/deck/archive', { deckId }), '终态后归档');
  });
});
