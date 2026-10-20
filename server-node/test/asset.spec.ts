/**
 * asset 域素材/品牌规范/话术模板集成测试（v1 AssetDomainTest + BrandKitPromptTest
 * 平移，业务预期不变）。
 *
 * 覆盖：
 * - 素材：hash 查重（首传 duplicated=false / 同 hash 复用同 assetId / 他人隔离）、
 *   INV-19 非法扩展名、ADR-004 被引用禁删（BIZ_ASSET_IN_USE）+ 停用放行 + 启用恢复、
 *   Select 仅 ACTIVE、hash 复活（删除后同 hash 重传复用原 assetId）、编辑改名/分类；
 * - 品牌规范：INV-17 默认切换（旧默认卸任）、默认禁删 BIZ_BRANDKIT_IS_DEFAULT、
 *   deck 引用禁删、INV-16 logo 绑定校验（不存在/停用拒，有效 logo 引用计数 +1）、
 *   provider-get（logo 停用后不签 URL）；
 * - 话术模板：INV-21 占位符语法（嵌套/空格/超量拒）、touch 计数、删除。
 *
 * v1 因主代码 advice 缺失走服务直调的用例，v3 全局 BizExceptionFilter 已覆盖
 * BizException → HTTP 200 Result 转译，统一走 HTTP 断言（覆盖面对齐）。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  TestContext,
  archiveVersion,
  createDeck,
  imageRefContent,
  okData,
  bizFail,
  postJson,
  toIterating,
} from './helpers/testing-app';

/** 1x1 透明 PNG（67B，合法 IHDR；v1 TINY_PNG 同款） */
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
  0xda, 0x63, 0xf8, 0xcd, 0xc2, 0xd6, 0xe0, 0x1f, 0x00, 0x09, 0x44, 0x01, 0xdf, 0x9e,
  0x3d, 0x8a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('asset 域（AssetDomainTest + BrandKitPromptTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // 素材落盘指向临时目录（不污染仓库工作区；AssetStorageService 构造时读 env）
    process.env.ASSET_STORAGE_DIR = join(tmpdir(), 'deck-loop-test-assets');
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.ASSET_STORAGE_DIR;
  });

  /** multipart 上传素材（HTTP 全管道：AuthGuard+FileInterceptor+ValidationPipe） */
  async function upload(
    session: { token: string },
    fileName: string,
    bytes: Buffer = TINY_PNG,
  ): Promise<any> {
    const res = await request(ctx.server as never)
      .post('/asset/asset/upload')
      .set('x-auth-token', session.token)
      .field('assetName', fileName)
      .attach('file', bytes, { filename: fileName, contentType: 'image/png' });
    expect(res.status).toBe(200);
    return res.body;
  }

  /** 保存品牌规范（HTTP body 等价 v1 kitAO） */
  function kitBody(name: string, logoAssetId: string | null) {
    const body: Record<string, unknown> = {
      kitName: name,
      colors: { primary: '#1A1A1A', assistants: ['#F5F5F5'] },
      fonts: { title: '思源黑体', body: '思源宋体' },
    };
    if (logoAssetId !== null) {
      body.logoAssetId = logoAssetId;
    }
    return body;
  }

  // ------------------------------------------------------------------
  // 素材上传（INV-19/INV-20）
  // ------------------------------------------------------------------

  it('上传-hash 查重：首传 duplicated=false，同 hash 重传复用同 assetId；他人同 hash 不复用', async () => {
    const session = await ctx.newSession();
    const first = okData(await upload(session, 'a.png'), '首传');
    const assetId = first.assetId;
    expect(assetId).toBeTruthy();
    expect(first.duplicated).toBe(false);

    const second = okData(await upload(session, 'b.png'), '重传');
    expect(second.duplicated).toBe(true);
    expect(second.assetId).toBe(assetId);

    // 他人同 hash 不复用（user_id 隔离）
    const other = await ctx.newSession();
    const otherUpload = okData(await upload(other, 'c.png'), '他人上传');
    expect(otherUpload.assetId).not.toBe(assetId);
    expect(otherUpload.duplicated).toBe(false);
  });

  it('上传守卫-非法扩展名拒绝（INV-19 BIZ_ASSET_TYPE_INVALID）', async () => {
    const session = await ctx.newSession();
    const body = await upload(session, 'evil.exe', Buffer.from('not-a-image'));
    bizFail(body, 'BIZ_ASSET_TYPE_INVALID', '非法扩展名拒绝');
  });

  // ------------------------------------------------------------------
  // ADR-004 引用守卫 + 生命周期
  // ------------------------------------------------------------------

  it('ADR-004-被引用素材禁删 BIZ_ASSET_IN_USE；停用放行；Select 仅 ACTIVE；启用恢复', async () => {
    const session = await ctx.newSession();
    const assetId = okData(await upload(session, 'ref.png'), '上传').assetId;

    // 版本引用（回调链同款留档 → 引用计数 +1）
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, imageRefContent('p1', assetId));
    await toIterating(ctx, deckId, session.userId);

    const listRow = okData(
      await postJson(ctx, session, '/asset/asset/list', { keyword: 'ref.png' }),
      '素材列表',
    );
    expect(listRow.records[0].refCount).toBe(1);

    // 被引用禁删（v3 全局 Filter 已转译 BizException，HTTP 直陈）
    bizFail(
      await postJson(ctx, session, '/asset/asset/delete', { assetId }),
      'BIZ_ASSET_IN_USE',
      '被引用禁删',
    );

    // 停用放行（ADR-004：引用中仅可停用）
    okData(await postJson(ctx, session, '/asset/asset/disable', { assetId }), '停用');
    const disabled = okData(
      await postJson(ctx, session, '/asset/asset/list', { assetStatus: 'DISABLED' }),
      '停用列表',
    );
    expect(disabled.records[0].assetId).toBe(assetId);

    // Select 选择池仅 ACTIVE：停用素材不可见
    const selectActive = okData(
      await postJson(ctx, session, '/asset/select/asset-list', {}),
      'ACTIVE 选择池',
    );
    expect(selectActive).toHaveLength(0);
    const selectDisabled = okData(
      await postJson(ctx, session, '/asset/select/asset-list', { assetType: 'IMAGE' }),
      '按类型选择池',
    );
    expect(selectDisabled).toHaveLength(0);

    // 启用恢复
    okData(await postJson(ctx, session, '/asset/asset/enable', { assetId }), '启用');
    const selectBack = okData(
      await postJson(ctx, session, '/asset/select/asset-list', {}),
      '恢复后选择池',
    );
    expect(selectBack).toHaveLength(1);
  });

  it('hash 复活-删除后同 hash 重传复用原 assetId（逻辑删除行复活）', async () => {
    const session = await ctx.newSession();
    const assetId = okData(await upload(session, 'x.png'), '首传').assetId;

    // 无引用 → 可删
    okData(await postJson(ctx, session, '/asset/asset/delete', { assetId }), '删除');
    const afterDelete = okData(
      await postJson(ctx, session, '/asset/asset/list', {}),
      '删除后列表',
    );
    expect(afterDelete.total).toBe(0);

    // 同 hash 重传 → 复活（同 assetId，非复用提示）
    const revived = okData(await upload(session, 'x-again.png'), '复活上传');
    expect(revived.assetId).toBe(assetId);
    expect(revived.duplicated).toBe(false);
    const list = okData(await postJson(ctx, session, '/asset/asset/list', {}), '复活后列表');
    expect(list.total).toBe(1);
  });

  it('编辑-save 改名/分类生效', async () => {
    const session = await ctx.newSession();
    const assetId = okData(await upload(session, 'edit.png'), '上传').assetId;

    okData(
      await postJson(ctx, session, '/asset/asset/save', {
        assetId,
        assetName: '品牌主视觉',
        category: '品牌',
      }),
      '编辑',
    );
    const list = okData(await postJson(ctx, session, '/asset/asset/list', {}), '列表');
    expect(list.records[0].assetName).toBe('品牌主视觉');
    expect(list.records[0].category).toBe('品牌');
  });

  // ------------------------------------------------------------------
  // 品牌规范（INV-16/INV-17 + deck 引用守卫）
  // ------------------------------------------------------------------

  it('brandkit-保存/编辑/默认切换单事务（INV-17 旧默认自动卸任）', async () => {
    const session = await ctx.newSession();
    const kitA = okData(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('规范A', null)),
      '保存A',
    ).brandKitId;
    const kitB = okData(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('规范B', null)),
      '保存B',
    ).brandKitId;

    okData(
      await postJson(ctx, session, '/asset/brandkit/set-default', { brandKitId: kitA }),
      'A 设默认',
    );
    okData(
      await postJson(ctx, session, '/asset/brandkit/set-default', { brandKitId: kitB }),
      'B 设默认',
    );

    const list = okData(
      await postJson(ctx, session, '/asset/brandkit/list', {}),
      '规范列表',
    );
    const rowA = list.records.find((row: any) => row.brandKitId === kitA);
    const rowB = list.records.find((row: any) => row.brandKitId === kitB);
    expect(rowB.isDefault).toBe(1);
    expect(rowA.isDefault).toBe(0);
  });

  it('brandkit-默认规范禁删（BIZ_BRANDKIT_IS_DEFAULT）；非默认未引用可删', async () => {
    const session = await ctx.newSession();
    const kitA = okData(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('默认规范', null)),
      '保存A',
    ).brandKitId;
    const kitB = okData(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('备用规范', null)),
      '保存B',
    ).brandKitId;
    okData(
      await postJson(ctx, session, '/asset/brandkit/set-default', { brandKitId: kitA }),
      'A 设默认',
    );

    bizFail(
      await postJson(ctx, session, '/asset/brandkit/delete', { brandKitId: kitA }),
      'BIZ_BRANDKIT_IS_DEFAULT',
      '默认规范禁删',
    );

    okData(
      await postJson(ctx, session, '/asset/brandkit/delete', { brandKitId: kitB }),
      '非默认可删',
    );
  });

  it('brandkit-被 deck 引用禁删；deck 默认规范校验（deck save 挂非法规范被拒）', async () => {
    const session = await ctx.newSession();
    const kit = okData(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('被引用规范', null)),
      '保存',
    ).brandKitId;

    // deck 引用该规范
    const deckSaved = okData(
      await postJson(ctx, session, '/deck/deck/save', {
        deckName: '引用规范的作品',
        deckType: 'DECK',
        topic: '品牌一致',
        defaultBrandKitId: kit,
      }),
      '建 deck 挂规范',
    );
    expect(deckSaved.deckId).toBeTruthy();

    // 被 deck 引用 → 禁删（域内复用 BIZ_ASSET_IN_USE 语义，v1 同）
    bizFail(
      await postJson(ctx, session, '/asset/brandkit/delete', { brandKitId: kit }),
      'BIZ_ASSET_IN_USE',
      '被 deck 引用禁删',
    );

    // deck 默认规范守卫：不存在规范拒绝
    bizFail(
      await postJson(ctx, session, '/deck/deck/save', {
        deckName: '非法规范',
        deckType: 'DECK',
        topic: 'x',
        defaultBrandKitId: 'no-such-kit',
      }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      'deck 挂非法规范拒绝',
    );
  });

  it('brandkit-logo 绑定校验（INV-16）：非法/停用 logo 拒绝；有效 logo 引用计数 +1', async () => {
    const session = await ctx.newSession();
    const logoId = okData(await upload(session, 'logo.png'), '上传 logo').assetId;

    // logo 不存在
    bizFail(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('坏logo规范', 'no-such-asset')),
      'BIZ_BRANDKIT_LOGO_INVALID',
      'logo 不存在拒绝',
    );

    const kitId = okData(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('好logo规范', logoId)),
      '绑定 logo',
    ).brandKitId;

    // logo 引用计数 +1
    const assets = okData(
      await postJson(ctx, session, '/asset/asset/list', {}),
      '素材列表',
    );
    expect(assets.records[0].refCount).toBe(1);

    // 停用 logo 后再绑定新规范 → 拒绝
    okData(await postJson(ctx, session, '/asset/asset/disable', { assetId: logoId }), '停用 logo');
    bizFail(
      await postJson(ctx, session, '/asset/brandkit/save', kitBody('停用logo规范', logoId)),
      'BIZ_BRANDKIT_LOGO_INVALID',
      'logo 停用拒绝',
    );

    // provider-get：有效会话读取返回 colors；logo 停用后不签 URL
    const provided = okData(
      await postJson(ctx, session, '/asset/brandkit/provider-get', { brandKitId: kitId }),
      'provider-get',
    );
    expect(provided.colors.primary).toBe('#1A1A1A');
    expect(
      provided.logoUrl === null ||
        provided.logoUrl === undefined ||
        String(provided.logoUrl).trim().length === 0,
    ).toBe(true);
  });

  // ------------------------------------------------------------------
  // 话术模板（INV-21 + 计数/删除）
  // ------------------------------------------------------------------

  it('话术模板-INV-21 占位符语法：合法保存；嵌套/空格/超量拒绝', async () => {
    const session = await ctx.newSession();

    const saved = okData(
      await postJson(ctx, session, '/asset/prompt/save', {
        title: '开场模板',
        content: '围绕{主题}写{页数}页',
        category: '开场',
        templateScene: 'WHOLE',
      }),
      '合法占位符保存',
    );
    const templateId = saved.templateId;
    expect(templateId).toBeTruthy();

    bizFail(
      await postJson(ctx, session, '/asset/prompt/save', {
        title: '嵌套',
        content: '{{主题}}',
        templateScene: 'WHOLE',
      }),
      'BIZ_PROMPT_PLACEHOLDER_SYNTAX',
      '嵌套拒绝',
    );

    bizFail(
      await postJson(ctx, session, '/asset/prompt/save', {
        title: '空格',
        content: '{主 题}',
        templateScene: 'WHOLE',
      }),
      'BIZ_PROMPT_PLACEHOLDER_SYNTAX',
      '空格占位拒绝',
    );

    bizFail(
      await postJson(ctx, session, '/asset/prompt/save', {
        title: '超量',
        content: '{1}{2}{3}{4}{5}{6}{7}{8}{9}{10}{11}',
        templateScene: 'WHOLE',
      }),
      'BIZ_PROMPT_PLACEHOLDER_SYNTAX',
      '超量拒绝',
    );

    // 合法模板在 Select 选择池可见（adjust usedTemplateIds 存在性来源）
    const select = okData(
      await postJson(ctx, session, '/asset/select/prompt-list', {}),
      '话术选择池',
    );
    expect(select).toHaveLength(1);
    expect(select[0].value).toBe(templateId);
  });

  it('话术模板-删除与使用计数', async () => {
    const session = await ctx.newSession();
    const templateId = okData(
      await postJson(ctx, session, '/asset/prompt/save', {
        title: '计数模板',
        content: '写{主题}',
        templateScene: 'TARGETED',
      }),
      '保存',
    ).templateId;

    okData(await postJson(ctx, session, '/asset/prompt/touch', { templateId }), 'touch');
    okData(await postJson(ctx, session, '/asset/prompt/touch', { templateId }), 'touch again');
    const list = okData(
      await postJson(ctx, session, '/asset/prompt/list', {}),
      '话术列表',
    );
    expect(list.records[0].useCount).toBe(2);

    okData(await postJson(ctx, session, '/asset/prompt/delete', { templateId }), '删除');
    const after = okData(
      await postJson(ctx, session, '/asset/prompt/list', {}),
      '删除后列表',
    );
    expect(after.total).toBe(0);
  });
});
