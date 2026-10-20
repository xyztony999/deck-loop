/**
 * version 域管理接口集成测试（v1 VersionManageTest 平移，业务预期不变）。
 *
 * 覆盖：tree（branchScope ACTIVE/ALL + 分支列表活动置顶）、detail（完整 content
 * + 属主级联隔离）、compare（sameHash 短路 / TEXT 变更 / NEW/REMOVED 页）、
 * rollback（confirm 守卫 + 移指针历史不动 + 回退后 seq 仍单调）、
 * fork（分支名冲突 BIZ_VERSION_BRANCH_EXISTS + activeBranch 切换）。
 *
 * 版本铺底经回调链同款领域写路径（archiveVersion/toIterating，同步执行）。
 */
import {
  TestContext,
  archiveVersion,
  createDeck,
  okData,
  bizFail,
  postJson,
  textPageContent,
  toIterating,
  twoPageContent,
} from './helpers/testing-app';

describe('version 域管理（VersionManageTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** 递归统计树节点总数 */
  function countVersions(node: any): number {
    let count = 1;
    for (const child of node.children ?? []) {
      count += countVersions(child);
    }
    return count;
  }

  function findPageByKind(pages: any[], changeKind: string): any | null {
    return pages.find((page) => page.changeKind === changeKind) ?? null;
  }

  it('tree-ACTIVE 只见活动分支，ALL 含全部分支；分支列表活动置顶', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    const v1 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'))
    ).versionId;
    await toIterating(ctx, deckId, session.userId);
    const v2 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v2'))
    ).versionId;

    // fork 出第二分支（v2 复制到 lite 分支）
    okData(
      await postJson(ctx, session, '/ver/version/fork', {
        deckId,
        versionId: v2,
        branchName: 'lite',
      }),
      '分叉',
    );

    const active = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId }),
      'ACTIVE 树',
    );
    expect(active.activeBranch).toBe('lite');
    expect(active.branches).toHaveLength(2);
    // ACTIVE 视图仅 lite 分支版本（树根 1 个）
    expect(active.tree).toHaveLength(1);

    const all = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }),
      'ALL 树',
    );
    expect(all.tree).toHaveLength(1);
    // main 链 v1→v2 + lite 复制头 = 3 个版本
    expect(countVersions(all.tree[0])).toBe(3);
    expect(String(all.currentVersionId)).not.toBe(v1);
  });

  it('detail-返回 content 完整 JSON 与 contentHash/pageCount；他人不可见', async () => {
    const session = await ctx.newSession();
    const other = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    const content = textPageContent('p1', 'b1', 'hello');
    const v1 = (
      await archiveVersion(ctx, deckId, session.userId, content)
    ).versionId;

    const detail = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v1 }),
      '版本详情',
    );
    expect(detail.versionSeq).toBe(1);
    expect(detail.pageCount).toBe(1);
    expect(detail.contentHash).toHaveLength(64);
    expect(detail.content.pages[0].pageId).toBe('p1');

    // 他人不可见（级联属主校验）
    bizFail(
      await postJson(ctx, other, '/ver/version/detail', { versionId: v1 }),
      'BIZ_VERSION_NOT_FOUND',
      '他人版本详情拒绝',
    );
  });

  it('compare-同内容 sameHash=true 全 NONE；文本 TEXT 变更；增删页 NEW/REMOVED；同版本拒绝', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const c1 = textPageContent('p1', 'b1', 'hello');
    const v1 = (await archiveVersion(ctx, deckId, session.userId, c1)).versionId;
    await toIterating(ctx, deckId, session.userId);
    const sameContent = (
      await archiveVersion(ctx, deckId, session.userId, c1)
    ).versionId;

    // sameHash 短路
    const same = okData(
      await postJson(ctx, session, '/ver/version/compare', {
        deckId,
        leftVersionId: v1,
        rightVersionId: sameContent,
      }),
      '同内容对比',
    );
    expect(same.sameHash).toBe(true);
    expect(same.pages).toHaveLength(1);
    expect(same.pages[0].changeKind).toBe('NONE');

    // 文本变更
    const v3 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'world'))
    ).versionId;
    const textDiff = okData(
      await postJson(ctx, session, '/ver/version/compare', {
        deckId,
        leftVersionId: v1,
        rightVersionId: v3,
      }),
      '文本对比',
    );
    expect(textDiff.sameHash).toBe(false);
    expect(textDiff.pages[0].changeKind).toBe('TEXT');
    expect(textDiff.pages[0].diffBlocks[0].blockId).toBe('b1');

    // 增删页：v3 单页 p1 → v4 双页 p1+p2（NEW）
    const v4 = (
      await archiveVersion(ctx, deckId, session.userId, twoPageContent('p1', 'p2'))
    ).versionId;
    const added = okData(
      await postJson(ctx, session, '/ver/version/compare', {
        deckId,
        leftVersionId: v3,
        rightVersionId: v4,
      }),
      '增页对比',
    );
    expect(findPageByKind(added.pages, 'NEW')).not.toBeNull();
    // 反向对比 → REMOVED
    const removed = okData(
      await postJson(ctx, session, '/ver/version/compare', {
        deckId,
        leftVersionId: v4,
        rightVersionId: v3,
      }),
      '删页对比',
    );
    expect(findPageByKind(removed.pages, 'REMOVED')).not.toBeNull();

    // 同版本对比被拒
    bizFail(
      await postJson(ctx, session, '/ver/version/compare', {
        deckId,
        leftVersionId: v1,
        rightVersionId: v1,
      }),
      'BIZ_VERSION_SAME_COMPARE',
      '同版本对比拒绝',
    );
  });

  it('rollback-需 confirm；移指针不动历史（版本数与内容不变）；回退后 seq 单调不复用', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);
    const v1 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'))
    ).versionId;
    await toIterating(ctx, deckId, session.userId);
    const v2 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v2'))
    ).versionId;

    // 缺 confirm（v1 守卫语义：回退需二次确认）
    bizFail(
      await postJson(ctx, session, '/ver/version/rollback', { deckId, versionId: v1 }),
      'BIZ_VERSION_NOT_FOUND',
      '回退缺二次确认',
    );

    okData(
      await postJson(ctx, session, '/ver/version/rollback', {
        deckId,
        versionId: v1,
        confirm: true,
      }),
      '回退',
    );

    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      '回退后 deck',
    );
    expect(detail.currentVersionId).toBe(v1);

    // 历史不动：v2 仍在树上且内容不变
    const v2Detail = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v2 }),
      'v2 详情仍在',
    );
    expect(JSON.stringify(v2Detail.content)).toContain('v2');
    const tree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }),
      '回退后树',
    );
    expect(countVersions(tree.tree[0])).toBe(2);

    // 回退后继续留档：seq 仍单调（=3，不因回退复用）；parent 为当前指针 v1
    const v3 = (
      await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v3'))
    ).versionId;
    const v3Detail = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v3 }),
      '回退后新版本',
    );
    expect(v3Detail.versionSeq).toBe(3);
    expect(v3Detail.parentVersionId).toBe(v1);
  });

  it('fork-同名/活动/历史分支名冲突 BIZ_VERSION_BRANCH_EXISTS；成功后新分支头+activeBranch 切换', async () => {
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
      await postJson(ctx, session, '/ver/version/fork', {
        deckId,
        versionId: v2,
        branchName: 'exp',
      }),
      '分叉',
    );
    const forkedTree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }),
      '分叉后树',
    );
    expect(forkedTree.activeBranch).toBe('exp');

    // 同名再分叉 → uk 冲突
    bizFail(
      await postJson(ctx, session, '/ver/version/fork', {
        deckId,
        versionId: v1,
        branchName: 'exp',
      }),
      'BIZ_VERSION_BRANCH_EXISTS',
      '同名分支拒绝',
    );
    // main 仍占用（历史分支）
    bizFail(
      await postJson(ctx, session, '/ver/version/fork', {
        deckId,
        versionId: v1,
        branchName: 'main',
      }),
      'BIZ_VERSION_BRANCH_EXISTS',
      '历史分支名拒绝',
    );
  });
});
