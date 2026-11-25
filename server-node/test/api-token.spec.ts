/**
 * 个人 API token 体系集成测试（api-web-agent §4.1，ADR-018）。
 *
 * 覆盖：签发（dlpat_+43 明文仅一次/前缀回显/缺省 90 天/永久/入参守卫）、
 * 列表（属主隔离/created_time DESC/status 派生/operList/永不回显明文与哈希）、
 * 吊销（幂等/即时生效——每次查库）、双凭证回落（会话优先/皆无 SESSION_EXPIRED/
 * 无效 TOKEN_INVALID）、token 管理端点仅会话（SessionOnlyGuard）、
 * last_used_at 节流（≤1 次/分钟）。
 */
import request from 'supertest';
import {
  TestContext,
  createDeck,
  issueToken,
  okData,
  bizFail,
  postJson,
  postWithToken,
} from './helpers/testing-app';

describe('个人 API token（api-web-agent §4.1）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('签发-明文 dlpat_+43 仅回执一次；前缀=前 12 字符；缺省 90 天；列表不回显明文/哈希', async () => {
    const session = await ctx.newSession('tok');
    const issued = await issueToken(ctx, session, { tokenName: 'MCP 远程' });
    expect(issued.token).toMatch(/^dlpat_[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenPrefix).toBe(issued.token.slice(0, 12));
    expect(issued.tokenId).toBeTruthy();
    expect(issued.expiresAt).toBeTruthy();

    const list = okData(await postJson(ctx, session, '/auth/token/list', {}), 'token 列表');
    expect(list.total).toBe(1);
    const row = list.records[0];
    expect(row.tokenId).toBe(issued.tokenId);
    expect(row.tokenName).toBe('MCP 远程');
    expect(row.tokenPrefix).toBe(issued.tokenPrefix);
    expect(row.status).toBe('ACTIVE');
    expect(row.operList.map((o: { code: string }) => o.code)).toContain('revoke');
    // INV-28：明文与哈希永不回显
    expect(JSON.stringify(list)).not.toContain(issued.token);
    expect(row.token).toBeUndefined();
    expect(row.tokenHash).toBeUndefined();

    // 库内只存哈希（SHA-256 hex 64），明文不落库
    const stored = (
      await ctx.dataSource().query('SELECT token_hash, token_prefix FROM dl_api_token WHERE token_id = $1', [
        issued.tokenId,
      ])
    )[0];
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toBe(issued.token);
  });

  it('签发-permanent=true 永久（expiresAt 空）；expiresDays 自定义；入参守卫', async () => {
    const session = await ctx.newSession('tokp');
    const permanent = await issueToken(ctx, session, { tokenName: '永久', permanent: true });
    expect(permanent.expiresAt).toBeNull();
    const custom = await issueToken(ctx, session, { tokenName: '短期', expiresDays: 7 });
    expect(custom.expiresAt).toBeTruthy();

    // tokenName 空 / expiresDays 越界 → 参数错误（ValidationPipe）
    const badName = await postJson(ctx, session, '/auth/token/issue', { tokenName: '' });
    expect((badName as { status: boolean }).status).toBe(false);
    const badDays = await postJson(ctx, session, '/auth/token/issue', {
      tokenName: 'x',
      expiresDays: 366,
    });
    expect((badDays as { status: boolean }).status).toBe(false);
  });

  it('列表-属主隔离 + created_time DESC + 分页', async () => {
    const session = await ctx.newSession('tokl');
    const other = await ctx.newSession('tokl2');
    const first = await issueToken(ctx, session, { tokenName: '甲' });
    // 确保 created_time 可分辨（毫秒精度）
    await new Promise((r) => setTimeout(r, 5));
    const second = await issueToken(ctx, session, { tokenName: '乙' });

    const list = okData(
      await postJson(ctx, session, '/auth/token/list', { pageNum: 1, pageSize: 1 }),
      '分页列表',
    );
    expect(list.total).toBe(2);
    expect(list.records).toHaveLength(1);
    expect(list.records[0].tokenId).toBe(second.tokenId); // DESC 最新在前

    const otherList = okData(await postJson(ctx, other, '/auth/token/list', {}), '他人列表');
    expect(otherList.total).toBe(0);
    expect(first.tokenId).not.toBe(second.tokenId);
  });

  it('吊销-幂等 + 即时生效（双凭证回落与 agent-create 同时拒绝）', async () => {
    const session = await ctx.newSession('tokr');
    const { tokenId, token } = await issueToken(ctx, session);
    const deckId = await createDeck(ctx, session);

    // 吊销前：token 可走双凭证回落读本人 deck
    okData(await postWithToken(ctx, token, '/deck/deck/list', {}), 'token 回落列表');

    okData(await postJson(ctx, session, '/auth/token/revoke', { tokenId }), '吊销');
    // 幂等：重复吊销成功
    okData(await postJson(ctx, session, '/auth/token/revoke', { tokenId }), '重复吊销');

    // 即时生效（verify 每次查库，无缓存）：回落与 agent-create 均拒绝
    bizFail(
      await postWithToken(ctx, token, '/deck/deck/list', {}),
      'BIZ_AUTH_TOKEN_INVALID',
      '吊销后回落拒绝',
    );
    bizFail(
      await postWithToken(ctx, token, '/ver/version/agent-create', {
        deckId,
        instruction: 'x',
        content: { pages: [{ pageId: 'p1', blocks: [] }] },
      }),
      'BIZ_AUTH_TOKEN_INVALID',
      '吊销后 agent-create 拒绝',
    );

    // 列表 status=REVOKED，operList 空
    const list = okData(await postJson(ctx, session, '/auth/token/list', {}), '吊销后列表');
    expect(list.records[0].status).toBe('REVOKED');
    expect(list.records[0].operList).toHaveLength(0);

    // 他人 tokenId 吊销拒绝（属主校验，统一码防枚举）
    const other = await ctx.newSession('tokr2');
    bizFail(
      await postJson(ctx, other, '/auth/token/revoke', { tokenId }),
      'BIZ_AUTH_TOKEN_INVALID',
      '他人 token 吊销拒绝',
    );
  });

  it('双凭证-会话优先；皆无 SESSION_EXPIRED；无效 token TOKEN_INVALID；管理端点仅会话', async () => {
    const session = await ctx.newSession('tokd');
    const { token } = await issueToken(ctx, session);

    // 无凭证 → SESSION_EXPIRED
    const anon = await request(ctx.server as never).post('/deck/deck/list').send({});
    expect(anon.status).toBe(200);
    bizFail(anon.body, 'BIZ_AUTH_SESSION_EXPIRED', '无凭证拒绝');

    // 无效 token → TOKEN_INVALID（防枚举统一码）
    bizFail(
      await postWithToken(ctx, 'dlpat_invalid-invalid-invalid-invalid-invalid-xxx', '/deck/deck/list', {}),
      'BIZ_AUTH_TOKEN_INVALID',
      '无效 token 拒绝',
    );
    // 格式错（非 dlpat_ 前缀）同码
    bizFail(
      await postWithToken(ctx, 'Bearer abc', '/deck/deck/list', {}),
      'BIZ_AUTH_TOKEN_INVALID',
      '格式错拒绝',
    );

    // 会话优先：会话头存在时即使无效也不回落（现状不变）
    const badSession = await request(ctx.server as never)
      .post('/deck/deck/list')
      .set('x-auth-token', 'bad-session')
      .set('x-api-token', token)
      .send({});
    bizFail(badSession.body, 'BIZ_AUTH_SESSION_EXPIRED', '会话优先不回落');

    // token 管理端点仅会话：个人 token 回落被 SessionOnlyGuard 拒绝
    bizFail(
      await postWithToken(ctx, token, '/auth/token/list', {}),
      'BIZ_AUTH_SESSION_EXPIRED',
      'token 不可自管理',
    );
    bizFail(
      await postWithToken(ctx, token, '/auth/token/issue', { tokenName: '自我续命' }),
      'BIZ_AUTH_SESSION_EXPIRED',
      'token 不可签发 token',
    );
  });

  it('last_used_at 节流-一分钟内多次校验仅回写一次', async () => {
    const session = await ctx.newSession('toku');
    const { tokenId, token } = await issueToken(ctx, session);

    okData(await postWithToken(ctx, token, '/deck/deck/list', {}), '第一次校验');
    const first = (
      await ctx.dataSource().query('SELECT last_used_at FROM dl_api_token WHERE token_id = $1', [tokenId])
    )[0].last_used_at;
    expect(first).not.toBeNull();

    // 连续多次校验（节流窗口内）→ last_used_at 不变
    for (let i = 0; i < 3; i += 1) {
      okData(await postWithToken(ctx, token, '/deck/deck/list', {}), '窗口内校验');
    }
    const again = (
      await ctx.dataSource().query('SELECT last_used_at FROM dl_api_token WHERE token_id = $1', [tokenId])
    )[0].last_used_at;
    expect(new Date(again).getTime()).toBe(new Date(first).getTime());

    // 列表回显 lastUsedAt
    const list = okData(await postJson(ctx, session, '/auth/token/list', {}), '使用痕迹');
    expect(list.records[0].lastUsedAt).toBeTruthy();
  });

  it('过期-token 到期后校验拒绝（EXPIRED 派生）', async () => {
    const session = await ctx.newSession('toke');
    const { tokenId, token } = await issueToken(ctx, session, { tokenName: '过期', expiresDays: 1 });
    // 直接改库 expires_at 到过去（模拟到期；不改代码时钟）
    await ctx.dataSource().query(
      'UPDATE dl_api_token SET expires_at = $2 WHERE token_id = $1',
      [tokenId, new Date(Date.now() - 1000)],
    );
    bizFail(
      await postWithToken(ctx, token, '/deck/deck/list', {}),
      'BIZ_AUTH_TOKEN_INVALID',
      '过期拒绝',
    );
    const list = okData(await postJson(ctx, session, '/auth/token/list', {}), '过期列表');
    expect(list.records[0].status).toBe('EXPIRED');
    // EXPIRED 仍可吊销（operList 含 revoke）
    expect(list.records[0].operList.map((o: { code: string }) => o.code)).toContain('revoke');
  });
});