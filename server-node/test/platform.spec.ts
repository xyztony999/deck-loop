/**
 * platform 域账号/同步集成测试（v1 PlatformAuthSyncTest 平移 + ADR-018 收窄）。
 *
 * 覆盖：注册守卫（重复 email BIZ_AUTH_EMAIL_EXISTS / 非法 email）、
 * 登录（错密码/未注册 BIZ_AUTH_CREDENTIALS；5 次失败锁定 10 分钟）、
 * profile（新 token 半期内不重签 refreshedToken 空；改昵称）、
 * 登出撤销（原 token 失效）、无 token 拉取拒绝、
 * sync/pull（DECK/VERSION 活跃 + TASK 历史只读 / 游标分页边界 / 毫秒不重投；
 * PREFERENCE 聚合随渠道域退役缺席）、
 * 历史审计读（deck detail withLatestTask 读 dl_generation_task 历史行）。
 *
 * ADR-018：网关退役——SSE/用量入账链随模块删除；个人 token 三端点见 api-token.spec。
 */
import request from 'supertest';
import {
  TestContext,
  archiveVersion,
  createDeck,
  okData,
  bizFail,
  TEST_PASSWORD,
  WRONG_PASSWORD,
  postPublic,
  postJson,
  seedHistoricalTask,
  textPageContent,
  toIterating,
} from './helpers/testing-app';

describe('platform 域账号与同步（PlatformAuthSyncTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** 注册（返回 {email}），不登录 */
  async function registerOnly(tag: string): Promise<string> {
    const email = `${tag}@sync.test`;
    okData(
      await postPublic(ctx, 'register', {
        email,
        password: TEST_PASSWORD,
        nickname: `用户${tag}`,
      }),
      '注册',
    );
    return email;
  }

  // ------------------------------------------------------------------
  // 账号
  // ------------------------------------------------------------------

  it('注册-重复邮箱拒绝（BIZ_AUTH_EMAIL_EXISTS）；非法邮箱拒绝（BIZ_AUTH_CREDENTIALS）', async () => {
    const tag = `reg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = await registerOnly(tag);
    expect(email).toBeTruthy();

    // 重复邮箱（v3 全局 Filter 已转译，HTTP 直陈；v1 走服务直调）
    bizFail(
      await postPublic(ctx, 'register', {
        email,
        password: TEST_PASSWORD,
        nickname: '重复',
      }),
      'BIZ_AUTH_EMAIL_EXISTS',
      '重复邮箱拒绝',
    );

    // 非法邮箱
    bizFail(
      await postPublic(ctx, 'register', {
        email: 'not-an-email',
        password: TEST_PASSWORD,
        nickname: '坏邮箱',
      }),
      'BIZ_AUTH_CREDENTIALS',
      '非法邮箱拒绝',
    );
  });

  it('登录-错密码/未注册账号拒绝（BIZ_AUTH_CREDENTIALS）；成功返回 token+syncCursor', async () => {
    const tag = `login-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = await registerOnly(tag);

    bizFail(
      await postPublic(ctx, 'login', { email, password: WRONG_PASSWORD }),
      'BIZ_AUTH_CREDENTIALS',
      '错密码拒绝',
    );

    bizFail(
      await postPublic(ctx, 'login', {
        email: 'nobody@sync.test',
        password: WRONG_PASSWORD,
      }),
      'BIZ_AUTH_CREDENTIALS',
      '未注册账号拒绝',
    );

    const login = okData(
      await postPublic(ctx, 'login', { email, password: TEST_PASSWORD }),
      '登录成功',
    );
    expect(login.token).toBeTruthy();
    expect(login.syncCursor).toBeGreaterThan(0);
  });

  it('登录锁定-连续 5 次失败后锁定，正确口令也被拒（约 10 分钟）', async () => {
    const tag = `lock-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = await registerOnly(tag);

    // 5 次连续失败触发锁定
    for (let i = 0; i < 5; i++) {
      bizFail(
        await postPublic(ctx, 'login', { email, password: WRONG_PASSWORD }),
        'BIZ_AUTH_CREDENTIALS',
        `第${i + 1}次失败`,
      );
    }

    // 锁定中：正确口令也被拒（提示锁定）
    const locked = bizFail(
      await postPublic(ctx, 'login', { email, password: TEST_PASSWORD }),
      'BIZ_AUTH_CREDENTIALS',
      '锁定中正确口令拒绝',
    );
    expect(locked).toContain('锁定');
  });

  it('profile-读改昵称；新 token 半期内不刷新（refreshedToken 空）；登出后 token 失效', async () => {
    const session = await ctx.newSession('prof');
    const token = session.token;

    const profile = okData(
      await postJson(ctx, session, '/auth/account/profile', {}),
      '读资料',
    );
    expect(profile.accountId).toBe(session.userId);
    expect(profile.email).toBe(session.email);
    // 新签 token 剩余超半程 → 不触发滑动重签（字段空=未重签）
    expect(
      profile.refreshedToken === null ||
        profile.refreshedToken === undefined ||
        String(profile.refreshedToken).trim().length === 0,
    ).toBe(true);

    const updated = okData(
      await postJson(ctx, session, '/auth/account/profile', { nickname: '新昵称' }),
      '改昵称',
    );
    expect(updated.nickname).toBe('新昵称');

    // 登出撤销后原 token 失效（HTTP：AuthGuard verify 失败 → SESSION_EXPIRED）
    okData(await postJson(ctx, session, '/auth/account/logout', { token }), '登出');
    const revokedRes = await request(ctx.server as never)
      .post('/auth/account/profile')
      .set('x-auth-token', token)
      .send({});
    expect(revokedRes.status).toBe(200);
    bizFail(revokedRes.body, 'BIZ_AUTH_SESSION_EXPIRED', '登出后 token 失效');
  });

  // ------------------------------------------------------------------
  // sync pull（游标）
  // ------------------------------------------------------------------

  it('同步-建 deck→版本→历史任务行后 pull 出现 VERSION+TASK（PREFERENCE 退役缺席）；游标推进后增量严格为空', async () => {
    const session = await ctx.newSession('sync');

    // 造变更：deck + 版本（agent 直写同款领域写路径）+ 历史任务行（TASK 历史只读扫描）
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'));
    await toIterating(ctx, deckId, session.userId);
    await seedHistoricalTask(ctx, deckId, session.userId);

    const pull1 = okData(
      await postJson(ctx, session, '/auth/sync/pull', { lastCursor: 0 }),
      '首次全量拉取',
    );
    expect(pull1.changes.length).toBeGreaterThanOrEqual(2);

    const aggregates = new Set<string>();
    for (const change of pull1.changes) {
      aggregates.add(change.aggregate);
      expect(change.cursor).toBeGreaterThan(0);
    }
    expect(aggregates.has('TASK')).toBe(true);
    expect(aggregates.has('VERSION')).toBe(true);
    // ADR-018：PREFERENCE 聚合随渠道域退役（dl_channel_preference 表删除）
    expect(aggregates.has('PREFERENCE')).toBe(false);
    const newCursor: number = pull1.newCursor;
    expect(newCursor).toBeGreaterThan(0);
    expect(pull1.hasMore).toBe(false);

    // v3 改进点重点验：游标推进后再拉，增量严格为空（复合游标 + 毫秒边界裁剪，
    // exactly-once；v1 该断言因 H2 毫秒截断重投 @Disabled）
    const pull2 = okData(
      await postJson(ctx, session, '/auth/sync/pull', { lastCursor: newCursor }),
      '游标后增量',
    );
    expect(pull2.changes).toHaveLength(0);
    expect(pull2.newCursor).toBe(newCursor);

    // 游标分页边界：以页中位游标再拉，只回后续变更（不回 ≤ 游标的行）
    const midCursor = pull1.changes[0].cursor;
    const pullMid = okData(
      await postJson(ctx, session, '/auth/sync/pull', { lastCursor: midCursor }),
      '游标分页',
    );
    for (const change of pullMid.changes) {
      expect(change.cursor).toBeGreaterThan(midCursor);
    }

    // 无 token 拉取拒绝（AuthGuard → SESSION_EXPIRED）
    const noSessionRes = await request(ctx.server as never)
      .post('/auth/sync/pull')
      .send({ lastCursor: 0 });
    expect(noSessionRes.status).toBe(200);
    bizFail(noSessionRes.body, 'BIZ_AUTH_SESSION_EXPIRED', '无会话拉取拒绝');
  });

  it('历史审计-deck detail withLatestTask/withStats 读 dl_generation_task 历史行（ADR-018 只读保留）', async () => {
    const session = await ctx.newSession('hist');
    const deckId = await createDeck(ctx, session);
    const taskId = await seedHistoricalTask(ctx, deckId, session.userId, 'SUCCEEDED', 'FULL_ADJUST');

    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', {
        deckId,
        withStats: true,
        withLatestTask: true,
      }),
      '历史审计详情',
    );
    expect(detail.latestTask).not.toBeNull();
    expect(detail.latestTask.taskId).toBe(taskId);
    expect(detail.latestTask.taskStatus).toBe('SUCCEEDED');
    // 历史成功调整任务计入 adjustCount（任务表停写，历史行仍可统计）
    expect(detail.stats.adjustCount).toBeGreaterThanOrEqual(1);
  });
});
