/**
 * adjust 域提交校验集成测试（v1 AdjustmentSubmitTest 平移，业务预期不变）。
 *
 * 覆盖：whole 四类校验（基线无效 BIZ_ADJUST_BASE_VERSION_INVALID / INV-10 占位符
 * / applyBrandKit 严格拒 / 话术模板存在性）、合法提交快照落 instruction_snapshot
 * （applyBrandKit=false 丢弃 brandKitId）、targeted TEXT_BLOCK/IMAGE_BLOCK 命中与
 * INV-9 五类作用域失配、scope/validate 命中/失配。
 *
 * 基线版本经回调链同款领域写路径铺底（content 带 pageId/blockId，
 * api-version §4.1 内容契约；Mock 产物无 pageId，故用种子版本——v1 同口径）。
 */
import {
  Session,
  TestContext,
  archiveVersion,
  awaitTaskTerminal,
  createDeck,
  okData,
  bizFail,
  postJson,
  textAndImageBlockContent,
  toIterating,
} from './helpers/testing-app';

const AWAIT_MS = 20_000;

describe('adjust 域提交校验（AdjustmentSubmitTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** 建一个 ITERATING deck + 当前版本（单页 TEXT 块 + 单 IMAGE 块）。 */
  async function iteratingDeckWithBaseVersion(
    session: Session,
  ): Promise<{ deckId: string; versionId: string }> {
    const deckId = await createDeck(ctx, session);
    const versionId = (
      await archiveVersion(ctx, deckId, session.userId, textAndImageBlockContent())
    ).versionId;
    await toIterating(ctx, deckId, session.userId);
    return { deckId, versionId };
  }

  // ------------------------------------------------------------------
  // 整稿调整（whole）
  // ------------------------------------------------------------------

  it('whole-基线无效/占位符/品牌规范/话术模板四类校验', async () => {
    const session = await ctx.newSession();
    const { deckId, versionId } = await iteratingDeckWithBaseVersion(session);

    // 基线版本不存在
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: 'no-such-version',
        instructionText: '改一下',
      }),
      'BIZ_ADJUST_BASE_VERSION_INVALID',
      '基线不存在',
    );

    // INV-10 占位符未替换
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: versionId,
        instructionText: '把{主题}改得更正式',
      }),
      'BIZ_ADJUST_PLACEHOLDER_UNRESOLVED',
      '占位符未替换',
    );

    // applyBrandKit=true 但无可用规范
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: versionId,
        instructionText: '改一下',
        applyBrandKit: true,
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '无默认规范时严格拒绝',
    );

    // applyBrandKit=true + 不存在规范
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: versionId,
        instructionText: '改一下',
        applyBrandKit: true,
        brandKitId: 'no-such-kit',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '品牌规范不存在拒绝',
    );

    // 话术模板不存在
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: versionId,
        instructionText: '改一下',
        usedTemplateIds: ['no-such-tpl'],
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '话术模板不存在拒绝',
    );
  });

  it('whole-合法提交建 FULL_ADJUST 任务；applyBrandKit=false 丢弃 brandKitId', async () => {
    const session = await ctx.newSession();
    const { deckId, versionId } = await iteratingDeckWithBaseVersion(session);

    const submitted = okData(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: versionId,
        instructionText: '整体更精简',
        applyBrandKit: false,
        brandKitId: 'whatever-ignored',
      }),
      '合法整稿调整',
    );
    const taskId = submitted.taskId;
    expect(taskId).toBeTruthy();
    expect(submitted.needForkBranch).toBe(false);

    const detail = okData(
      await postJson(ctx, session, '/gen/task/detail', { taskId }),
      '任务详情',
    );
    expect(detail.taskType).toBe('FULL_ADJUST');
    expect(detail.baseVersionId).toBe(versionId);
    // v3 instruction_snapshot 为整体嵌入 object（D5），不再 JSON 字符串
    const snapshot = detail.instructionSnapshot;
    expect(snapshot.instructionText).toBe('整体更精简');
    expect(snapshot.baseVersionId).toBe(versionId);
    expect(snapshot.applyBrandKit).toBe(false);
    expect(snapshot.brandKitId ?? null).toBeNull();
    // F02a：基线原稿随快照固化（网关执行链不回库加载）
    expect(Array.isArray(snapshot.baseContent?.pages)).toBe(true);
    expect(snapshot.baseContent?.pages?.[0]?.pageId).toBe('p1');

    // 等任务终态（避免 afterAll 关库时回调仍在飞——teardown 竞态噪音）
    const terminal = await awaitTaskTerminal(ctx, session, taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');
  });

  // ------------------------------------------------------------------
  // 定向调整（targeted，INV-9 内联）
  // ------------------------------------------------------------------

  it('targeted-TEXT_BLOCK 命中 TEXT 块：建 TARGETED_ADJUST 任务并成功', async () => {
    const session = await ctx.newSession();
    const { deckId, versionId } = await iteratingDeckWithBaseVersion(session);

    const textSubmit = okData(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'TEXT_BLOCK',
        targetPath: { pageId: 'p1', blockId: 'b-text' },
        instructionText: '这段更口语化',
      }),
      '定向文本调整',
    );
    const textTaskId = textSubmit.taskId;
    expect(textTaskId).toBeTruthy();
    expect(textSubmit.needForkBranch).toBe(false);
    const textDetail = okData(
      await postJson(ctx, session, '/gen/task/detail', { taskId: textTaskId }),
      '文本任务详情',
    );
    const textSnapshot = textDetail.instructionSnapshot;
    expect(textSnapshot.targetKind).toBe('TEXT_BLOCK');
    expect(textSnapshot.targetPath?.blockId).toBe('b-text');

    const terminal = await awaitTaskTerminal(ctx, session, textTaskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');
    expect(terminal.taskType).toBe('TARGETED_ADJUST');
  });

  it('targeted-IMAGE_BLOCK 命中 IMAGE 块：建 TARGETED_ADJUST 任务并成功', async () => {
    const session = await ctx.newSession();
    // 独立 deck：定向调整成功留档会前移指针且 Mock 产物不保留种子 pageId，
    // 与 TEXT 用例分开铺底避免基线漂移（v1 同口径）
    const { deckId, versionId } = await iteratingDeckWithBaseVersion(session);

    const imageSubmit = okData(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'IMAGE_BLOCK',
        targetPath: { pageId: 'p1', blockId: 'b-img' },
        instructionText: '换张图',
      }),
      '定向图片调整',
    );
    expect(imageSubmit.needForkBranch).toBe(false);
    const terminal = await awaitTaskTerminal(ctx, session, imageSubmit.taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');
    expect(terminal.taskType).toBe('TARGETED_ADJUST');
  });

  it('targeted-作用域失配：TEXT 指向 IMAGE 块/页不存在/PAGE 带 blockId/缺 blockId', async () => {
    const session = await ctx.newSession();
    const { deckId, versionId } = await iteratingDeckWithBaseVersion(session);

    // targetKind 与 blockType 不匹配（INV-9）
    bizFail(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'TEXT_BLOCK',
        targetPath: { pageId: 'p1', blockId: 'b-img' },
        instructionText: '改',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      'TEXT 指向 IMAGE 块',
    );

    // 页不存在
    bizFail(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'PAGE',
        targetPath: { pageId: 'no-page' },
        instructionText: '改',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '页不存在',
    );

    // 块不存在
    bizFail(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'TEXT_BLOCK',
        targetPath: { pageId: 'p1', blockId: 'no-block' },
        instructionText: '改',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '块不存在',
    );

    // PAGE 作用域携带 blockId
    bizFail(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'PAGE',
        targetPath: { pageId: 'p1', blockId: 'b-text' },
        instructionText: '改',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      'PAGE 带 blockId',
    );

    // 非 PAGE 缺 blockId
    bizFail(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'TEXT_BLOCK',
        targetPath: { pageId: 'p1' },
        instructionText: '改',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '非 PAGE 缺 blockId',
    );

    // targetKind 语法非法：AO @IsIn 校验层拒绝（code 固定 500；
    // BIZ_ADJUST_SCOPE_INVALID 只用于语义作用域失配——上面五类，v1 同口径）
    bizFail(
      await postJson(ctx, session, '/adjust/targeted/submit', {
        deckId,
        baseVersionId: versionId,
        targetKind: 'NOT_A_KIND',
        targetPath: { pageId: 'p1' },
        instructionText: '改',
      }),
      '500',
      'targetKind 非法',
    );
  });

  // ------------------------------------------------------------------
  // 作用域预校验（scope/validate）
  // ------------------------------------------------------------------

  it('scope-validate-命中返回 valid+summary；失配返回 SCOPE_INVALID', async () => {
    const session = await ctx.newSession();
    const { deckId, versionId } = await iteratingDeckWithBaseVersion(session);

    const pageScope = okData(
      await postJson(ctx, session, '/adjust/scope/validate', {
        deckId,
        versionId,
        targetKind: 'PAGE',
        targetPath: { pageId: 'p1' },
      }),
      'PAGE 作用域',
    );
    expect(pageScope.valid).toBe(true);
    expect(pageScope.pageNo).toBe(1);
    expect(String(pageScope.targetSummary)).toContain('第1页');

    const blockScope = okData(
      await postJson(ctx, session, '/adjust/scope/validate', {
        deckId,
        versionId,
        targetKind: 'TEXT_BLOCK',
        targetPath: { pageId: 'p1', blockId: 'b-text' },
      }),
      '块作用域',
    );
    expect(blockScope.blockType).toBe('TEXT');

    bizFail(
      await postJson(ctx, session, '/adjust/scope/validate', {
        deckId,
        versionId,
        targetKind: 'TEXT_BLOCK',
        targetPath: { pageId: 'p1', blockId: 'b-img' },
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '作用域预校验失配',
    );
  });
});
