/**
 * agent 直写端点集成测试（POST /ver/version/agent-create，api-web-agent §4.2，ADR-018）。
 *
 * 覆盖：仅 token（会话/缺头拒绝）、属主隔离、INV-3 状态守卫、sourceType 自动判定
 * （FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST）、定向基线固化+INV-9 scope 存在性+
 * 非目标不变性（越界 BIZ_VERSION_TARGET_INVARIANCE 不产版本）、载荷红线
 * （pages/instruction/content 体积）、首版 DRAFT→ITERATING、分叉留档、
 * INV-18 引用计数、taskId=agent-<snowflake> 不建任务行、单事务原子性。
 */
import request from 'supertest';
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
  toIterating,
} from './helpers/testing-app';

/** 双页内容（定向不变性场景） */
function twoPages(p1Text: string, p2Text: string): Record<string, unknown> {
  return {
    pages: [
      { pageId: 'p1', title: '一', blocks: [{ blockId: 'b1', blockType: 'TEXT', text: p1Text }] },
      { pageId: 'p2', title: '二', blocks: [{ blockId: 'b2', blockType: 'TEXT', text: p2Text }] },
    ],
  };
}

describe('agent 直写（api-web-agent §4.2）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('仅 token-缺头/会话调用拒绝（BIZ_AUTH_TOKEN_INVALID）', async () => {
    const session = await ctx.newSession('ac');
    const deckId = await createDeck(ctx, session);
    const body = { deckId, instruction: 'x', content: textPageContent('p1', 'b1', 'v') };

    // 缺头（@Public 旁路会话守卫后 ApiTokenGuard 拒绝）
    bizFail(await postJson(ctx, session, '/ver/version/agent-create', body), 'BIZ_AUTH_TOKEN_INVALID', '会话拒绝');
    const anon = await request(ctx.server as never)
      .post('/ver/version/agent-create')
      .send(body);
    bizFail(anon.body, 'BIZ_AUTH_TOKEN_INVALID', '缺头拒绝');
  });

  it('首版-FULL_GENERATE + DRAFT→ITERATING + taskId 不建任务行 + 指针/分支', async () => {
    const session = await ctx.newSession('ac1');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);

    const vo = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '生成首页',
        content: textPageContent('p1', 'b1', 'hello'),
      }),
      '首版',
    );
    expect(vo.versionSeq).toBe(1);
    expect(vo.sourceType).toBe('FULL_GENERATE');
    expect(vo.taskId).toMatch(/^agent-\d+$/);
    expect(vo.branchName).toBe('main');

    const detail = okData(await postJson(ctx, session, '/deck/deck/detail', { deckId }), '首版后');
    expect(detail.deckStatus).toBe('ITERATING');
    expect(detail.currentVersionId).toBe(vo.versionId);

    // 不建 dl_generation_task 行（D2）；树 taskStatusOfSource 回落 null
    const rows = await ctx
      .dataSource()
      .query('SELECT COUNT(*)::int AS cnt FROM dl_generation_task WHERE task_id = $1', [vo.taskId]);
    expect(Number(rows[0].cnt)).toBe(0);
    const tree = okData(await postJson(ctx, session, '/ver/version/tree', { deckId }), '树');
    expect(tree.tree[0].taskStatusOfSource ?? null).toBeNull();

    // instruction 落快照；version/detail 可读
    const vd = okData(await postJson(ctx, session, '/ver/version/detail', { versionId: vo.versionId }), '详情');
    expect(vd.instructionSnapshot.instruction).toBe('生成首页');
    expect(vd.taskId).toBe(vo.taskId);
  });

  it('属主隔离-他人 deck 拒绝（BIZ_DECK_NOT_FOUND）；deck 不存在同码', async () => {
    const owner = await ctx.newSession('ac2');
    const other = await ctx.newSession('ac2b');
    const deckId = await createDeck(ctx, owner);
    const { token } = await issueToken(ctx, other);
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '越权',
        content: textPageContent('p1', 'b1', 'x'),
      }),
      'BIZ_DECK_NOT_FOUND',
      '他人 deck 拒绝',
    );
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId: 'nonexistent00000000000000000',
        instruction: 'x',
        content: textPageContent('p1', 'b1', 'x'),
      }),
      'BIZ_DECK_NOT_FOUND',
      '不存在拒绝',
    );
  });

  it('二版-FULL_ADJUST（有基线）；parentVersionId 显式指定 + INV-13 跨 deck 拒绝', async () => {
    const session = await ctx.newSession('ac3');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    const v1 = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '首版',
        content: textPageContent('p1', 'b1', 'v1'),
      }),
      '首版',
    );
    const v2 = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '调整',
        parentVersionId: v1.versionId,
        content: textPageContent('p1', 'b1', 'v2'),
      }),
      '二版',
    );
    expect(v2.sourceType).toBe('FULL_ADJUST');
    expect(v2.versionSeq).toBe(2);

    // INV-13：parentVersionId 属他 deck → 拒绝
    const otherDeck = await createDeck(ctx, session);
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId: otherDeck,
        instruction: '跨 deck 父版本',
        parentVersionId: v1.versionId,
        content: textPageContent('p1', 'b1', 'x'),
      }),
      'BIZ_VERSION_NOT_FOUND',
      'INV-13 拒绝',
    );
  });

  it('定向-TARGETED_ADJUST 基线固化 + 非目标不变性（越界 BIZ_VERSION_TARGET_INVARIANCE 不产版本）', async () => {
    const session = await ctx.newSession('ac4');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    const base = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '基线',
        content: twoPages('hello', 'world'),
      }),
      '基线',
    );

    // 命中：仅改目标页 p1
    const hit = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '改 p1',
        scope: { pageId: 'p1' },
        content: twoPages('你好', 'world'),
      }),
      '定向命中',
    );
    expect(hit.sourceType).toBe('TARGETED_ADJUST');
    const vd = okData(await postJson(ctx, session, '/ver/version/detail', { versionId: hit.versionId }), '定向详情');
    expect(vd.instructionSnapshot.baseContent).toBeTruthy();
    expect(vd.instructionSnapshot.targetPath).toEqual({ pageId: 'p1' });

    // 越界：动了非目标页 p2 → BIZ 错误，不产版本
    const before = okData(await postJson(ctx, session, '/ver/version/tree', { deckId }), '越界前树');
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '越界',
        scope: { pageId: 'p1' },
        content: twoPages('你好', '被改'),
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '越界拒绝',
    );
    const after = okData(await postJson(ctx, session, '/ver/version/tree', { deckId }), '越界后树');
    expect(after.currentVersionId).toBe(before.currentVersionId);

    // INV-9：scope 页不存在 → 同码
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'scope 不存在',
        scope: { pageId: 'pX' },
        content: twoPages('你好', 'world'),
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      'scope 页不存在',
    );
    // INV-9：scope 块不存在 → 同码
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'scope 块不存在',
        scope: { pageId: 'p1', blockId: 'bX' },
        content: twoPages('你好', 'world'),
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      'scope 块不存在',
    );
    // 无基线定向拒绝（首版 deck）
    const fresh = await createDeck(ctx, session);
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId: fresh,
        instruction: '首版定向',
        scope: { pageId: 'p1' },
        content: twoPages('a', 'b'),
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '无基线定向拒绝',
    );
    expect(base.versionId).toBeTruthy();
  });

  it('定向块级-非目标块字节级不变；目标块自由变更', async () => {
    const session = await ctx.newSession('ac5');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    const baseContent = {
      pages: [
        {
          pageId: 'p1',
          title: '一',
          blocks: [
            { blockId: 'b1', blockType: 'TEXT', text: '块一' },
            { blockId: 'b2', blockType: 'TEXT', text: '块二' },
          ],
        },
      ],
    };
    await postWithToken(ctx, token, '/ver/version/agent-create', {
      deckId,
      instruction: '基线',
      content: baseContent,
    });
    const hitContent = JSON.parse(JSON.stringify(baseContent)) as typeof baseContent;
    hitContent.pages[0].blocks[0].text = '块一（改）';
    const hit = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '改块一',
        scope: { pageId: 'p1', blockId: 'b1' },
        content: hitContent,
      }),
      '块级命中',
    );
    expect(hit.sourceType).toBe('TARGETED_ADJUST');

    const badContent = JSON.parse(JSON.stringify(hitContent)) as typeof baseContent;
    badContent.pages[0].blocks[1].text = '块二（被改）';
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '越界改块二',
        scope: { pageId: 'p1', blockId: 'b1' },
        content: badContent,
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '非目标块越界',
    );
  });

  it('载荷红线-pages 越界/instruction 超长/content 超体积 → BIZ_VERSION_TARGET_INVARIANCE', async () => {
    const session = await ctx.newSession('ac6');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);

    // pages 0
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'x',
        content: { pages: [] },
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '空页拒绝',
    );
    // pages 201
    const manyPages = {
      pages: Array.from({ length: 201 }, (_, i) => ({
        pageId: `p${i}`,
        blocks: [{ blockId: 'b', blockType: 'TEXT', text: 'x' }],
      })),
    };
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'x',
        content: manyPages,
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '页数越界',
    );
    // instruction 2001（AO MaxLength 拦截，参数错误）
    const longInstruction = await postWithToken(ctx, token, '/ver/version/agent-create', {
      deckId,
      instruction: 'a'.repeat(2001),
      content: textPageContent('p1', 'b1', 'x'),
    });
    expect((longInstruction as { status: boolean }).status).toBe(false);

    // content 超体积（env 缺省 2MB；构造 >2MB 文本块）
    const bigContent = {
      pages: [
        { pageId: 'p1', blocks: [{ blockId: 'b1', blockType: 'TEXT', text: 'x'.repeat(2 * 1024 * 1024 + 1024) }] },
      ],
    };
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'x',
        content: bigContent,
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '体积越界',
    );
    // 形状非法（blockType 越界）
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'x',
        content: { pages: [{ pageId: 'p1', blocks: [{ blockId: 'b1', blockType: 'VIDEO' }] }] },
      }),
      'BIZ_VERSION_TARGET_INVARIANCE',
      '块类型非法',
    );
  });

  it('分叉留档-branchName≠活动分支 → 新分支首版 + 指针切换；重名拒绝（INV-12）', async () => {
    const session = await ctx.newSession('ac7');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    await postWithToken(ctx, token, '/ver/version/agent-create', {
      deckId,
      instruction: '首版',
      content: textPageContent('p1', 'b1', 'v1'),
    });
    const forked = okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '分叉',
        branchName: 'alt',
        content: textPageContent('p1', 'b1', 'alt-v1'),
      }),
      '分叉留档',
    );
    expect(forked.branchName).toBe('alt');
    const tree = okData(await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }), '树');
    expect(tree.activeBranch).toBe('alt');
    expect(tree.branches.map((b: { branchName: string }) => b.branchName)).toContain('alt');

    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '重名分叉',
        branchName: 'main',
        content: textPageContent('p1', 'b1', 'x'),
      }),
      'BIZ_VERSION_BRANCH_EXISTS',
      '重名分支拒绝',
    );
  });

  it('INV-18-图片引用计数同事务 +1；INV-11 版本不可变（无 update 路径）', async () => {
    const session = await ctx.newSession('ac8');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    // 铺底素材（经资产域上传 HTTP 全管道）
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = await request(ctx.server as never)
      .post('/asset/asset/upload')
      .set('x-auth-token', session.token)
      .field('assetType', 'IMAGE')
      .attach('file', png, 'pixel.png');
    const assetId = okData(upload.body, '素材上传').assetId;

    await postWithToken(ctx, token, '/ver/version/agent-create', {
      deckId,
      instruction: '图片版',
      content: {
        pages: [
          { pageId: 'p1', blocks: [{ blockId: 'b-img', blockType: 'IMAGE', assetId }] },
        ],
      },
    });
    const asset = (
      await ctx.dataSource().query('SELECT ref_count FROM dl_asset WHERE asset_id = $1', [assetId])
    )[0];
    expect(Number(asset.ref_count)).toBe(1);

    // 再留档一版引用同素材 → +1（每版本至多一次）
    await postWithToken(ctx, token, '/ver/version/agent-create', {
      deckId,
      instruction: '图片版二',
      content: {
        pages: [
          { pageId: 'p1', blocks: [{ blockId: 'b-img', blockType: 'IMAGE', assetId }] },
        ],
      },
    });
    const asset2 = (
      await ctx.dataSource().query('SELECT ref_count FROM dl_asset WHERE asset_id = $1', [assetId])
    )[0];
    expect(Number(asset2.ref_count)).toBe(2);
  });

  it('状态守卫-FINALIZED 拒绝（INV-3）；解锁后放行', async () => {
    const session = await ctx.newSession('ac9');
    const { token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'));
    await toIterating(ctx, deckId, session.userId);
    okData(await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: true }), '定稿');
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '定稿后写',
        content: textPageContent('p1', 'b1', 'v2'),
      }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'FINALIZED 拒绝',
    );
    okData(await postJson(ctx, session, '/deck/deck/unfinalize', { deckId, confirm: true }), '解锁');
    okData(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: '解锁后写',
        content: textPageContent('p1', 'b1', 'v2'),
      }),
      '解锁后放行',
    );
  });
});