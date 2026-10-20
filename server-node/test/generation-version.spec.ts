/**
 * generation+version 联链集成测试（最核心链路；v1 GenerationVersionFlowTest +
 * GenerationFailureFlowTest 平移）：createTask（INV-8 互斥、路由快照）→ Mock 网关
 * 回调 SUCCEEDED → 版本留档（seq/不可变/引用计数/单事务）→ 首版 DRAFT→ITERATING →
 * D3 分叉留档；FAILED 不产版本（ADR-003）、CANCELLED 幂等、retry 新实例、用量入账。
 *
 * FAILED 注入：GATEWAY_CHANNELS 注册 MOCK-NOADAPTER（清单 enabled 但无适配器实现，
 * v1 application-test.yml 同款）——网关派发失败 → FAILED。经 GenerationTaskDomainService
 * 显式路由建任务（回调线程语义，无会话直调）。
 */
import { GenerationTaskDomainService } from '../src/generation/generation.domain-service';
import { GenerationTaskCreateCommand } from '../src/generation/generation.dto';
import {
  TestContext,
  archiveVersion,
  awaitTaskTerminal,
  awaitUntil,
  bizFail,
  createDeck,
  okData,
  postJson,
  textPageContent,
  toIterating,
} from './helpers/testing-app';

/** 测试渠道注册：MOCK（enabled+适配器）/ MOCK-NOADAPTER（enabled+无适配器，FAILED 注入） */
const TEST_GATEWAY_CHANNELS = JSON.stringify([
  {
    channelCode: 'MOCK',
    channelName: '内置模拟渠道',
    priority: 100,
    enabled: true,
    apiKey: 'local-mock-key-not-a-secret',
    models: [
      {
        modelCode: 'MOCK-LITE',
        modelName: '模拟轻量模型',
        capabilityTags: ['OUTLINE', 'FULL_GENERATE', 'FULL_ADJUST', 'TARGETED_ADJUST'],
        enabled: true,
      },
    ],
  },
  {
    channelCode: 'MOCK-NOADAPTER',
    channelName: '无适配器渠道',
    priority: 50,
    enabled: true,
    models: [
      {
        modelCode: 'MOCK-NA-1',
        modelName: '仅整稿模型',
        capabilityTags: ['FULL_GENERATE', 'FULL_ADJUST', 'TARGETED_ADJUST'],
        enabled: true,
      },
    ],
  },
]);

const AWAIT_MS = 20_000;
const OUTLINE_JSON = '[{"nodeId":"n1","title":"开篇"}]';

describe('generation+version 联链（GenerationVersionFlowTest/GenerationFailureFlowTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    process.env.GATEWAY_CHANNELS = TEST_GATEWAY_CHANNELS;
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.GATEWAY_CHANNELS;
  });

  /** 经领域服务显式路由 MOCK-NOADAPTER 建任务（回调线程语义，无会话直调）。 */
  async function createNoAdapterTask(
    deckId: string,
    userId: string,
    taskType = 'FULL_GENERATE',
  ): Promise<string> {
    const command = new GenerationTaskCreateCommand();
    command.deckId = deckId;
    command.userId = userId;
    command.taskType = taskType;
    command.instructionSnapshot = { topic: '失败注入', userId };
    command.explicitChannelCode = 'MOCK-NOADAPTER';
    command.explicitModelCode = 'MOCK-NA-1';
    return (await ctx.get(GenerationTaskDomainService).createTask(command)).taskId;
  }

  it('大纲链-OUTLINE 生成回调写 draftOutline；save 后仅 DRAFT 可编辑；OUTLINE 不产版本', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    // 手动保存大纲（DRAFT 可编辑）；nodeId 缺省按序补全
    okData(
      await postJson(ctx, session, '/gen/outline/save', {
        deckId,
        outline: [
          { nodeId: 'n1', title: '第一章', points: ['要点'] },
          { title: '第二章（nodeId 自动补全）' },
        ],
      }),
      '保存大纲',
    );

    // 大纲生成（Mock 回调覆写 draftOutline）
    const submit = okData(
      await postJson(ctx, session, '/gen/outline/generate', { deckId }),
      '发起大纲生成',
    );
    const terminal = await awaitTaskTerminal(ctx, session, submit.taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');
    expect(terminal.taskType).toBe('OUTLINE');
    expectBlankish(terminal.resultVersionId);

    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      'deck 详情',
    );
    expect(Array.isArray(detail.draftOutline)).toBe(true);
    // F03：Mock 大纲为 topic 驱动（含背景/目标章节），nodeId/points 契约不变
    expect(String(detail.draftOutline[0].title)).toContain('背景与目标');
    expect(detail.draftOutline[0].nodeId).toBe('n1');

    // OUTLINE 任务不产版本：deck 指针仍空、状态仍 DRAFT
    expect(detail.deckStatus).toBe('DRAFT');
    expectBlankish(detail.currentVersionId);

    // 首版后大纲转只读（ITERATING 后 save 被拒）——铺一版后验证
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'v1'));
    await toIterating(ctx, deckId, session.userId);
    bizFail(
      await postJson(ctx, session, '/gen/outline/save', {
        deckId,
        outline: [{ nodeId: 'n1', title: '再改' }],
      }),
      'BIZ_TASK_SCOPE_INVALID',
      '首版后大纲只读',
    );
  });

  it('整稿链-首版留档：SUCCEEDED 后版本 seq=1、指针回写、DRAFT→ITERATING、task 回填版本', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const submit = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '发起整稿',
    );
    expect(['QUEUED', 'RUNNING']).toContain(submit.taskStatus);
    expect(String(submit.taskCode)).toMatch(/^GT/);

    const terminal = await awaitTaskTerminal(ctx, session, submit.taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');

    // 任务详情：resultVersionId 回填 + 路由快照（平台兜底 MOCK/MOCK-LITE）
    expect(terminal.resultVersionId).toBeTruthy();
    expect(terminal.resultVersionSeq).toBe(1);
    expect(terminal.channelCode).toBe('MOCK');
    expect(terminal.modelCode).toBe('MOCK-LITE');

    // deck 指针回写 + 首版状态流转
    const deck = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      'deck 详情',
    );
    expect(deck.deckStatus).toBe('ITERATING');
    expect(deck.currentVersionId).toBe(terminal.resultVersionId);

    // 版本树：单版本 main 分支
    const tree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId }),
      '版本树',
    );
    expect(tree.tree).toHaveLength(1);
    expect(tree.tree[0].versionSeq).toBe(1);
    expect(tree.tree[0].branchName).toBe('main');
    expect(tree.branches[0].branchName).toBe('main');
  });

  it('二版留档-seq 递增=2、parent=首版；首版内容不可变', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const first = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '首版任务',
    );
    const firstTerminal = await awaitTaskTerminal(ctx, session, first.taskId, AWAIT_MS);
    const v1 = firstTerminal.resultVersionId;
    const v1Detail = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v1 }),
      '首版详情',
    );

    const second = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '二版任务',
    );
    const secondTerminal = await awaitTaskTerminal(ctx, session, second.taskId, AWAIT_MS);
    const v2 = secondTerminal.resultVersionId;
    expect(v2).not.toBe(v1);
    expect(secondTerminal.resultVersionSeq).toBe(2);

    // 首版内容未被二版留档改动（不可变）
    const v1After = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v1 }),
      '首版复查',
    );
    expect(v1After.content).toEqual(v1Detail.content);
    expect(v1After.contentHash).toBe(v1Detail.contentHash);

    // 指针=二版，谱系树 v1→v2
    const tree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }),
      '版本树',
    );
    const v1Node = tree.tree[0];
    expect(v1Node.versionSeq).toBe(1);
    expect(v1Node.children).toHaveLength(1);
    expect(v1Node.children[0].versionSeq).toBe(2);
  });

  it('INV-8 互斥-同 deck 进行中任务时再建任务被拒', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '首个任务',
    );
    // Mock provider 睡 300-800ms，立即并发创建必落在 QUEUED/RUNNING 窗口
    bizFail(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      'BIZ_TASK_DUPLICATE_RUNNING',
      'INV-8 互斥',
    );
  });

  it('取消链-QUEUED/RUNNING 取消→CANCELLED；成功回调竞态不复活任务、不产版本；终态再取消拒绝', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const submit = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '任务',
    );
    const taskId = submit.taskId;

    okData(await postJson(ctx, session, '/gen/task/cancel', { taskId }), '取消');
    const afterCancel = await awaitTaskTerminal(ctx, session, taskId, AWAIT_MS);
    expect(afterCancel.taskStatus).toBe('CANCELLED');

    // 网关回调竞态窗口后状态仍 CANCELLED、无版本、deck 仍 DRAFT
    await awaitUntil(async () => {
      const task = okData(
        await postJson(ctx, session, '/gen/task/detail', { taskId }),
        '复查',
      );
      const tree = okData(
        await postJson(ctx, session, '/ver/version/tree', { deckId }),
        '树',
      );
      return task.taskStatus === 'CANCELLED' && tree.tree.length === 0;
    }, 5_000, '取消后状态稳定');

    // 终态任务再次取消 → BIZ_TASK_NOT_CANCELLABLE（幂等键=taskId+前置状态未命中）
    bizFail(
      await postJson(ctx, session, '/gen/task/cancel', { taskId }),
      'BIZ_TASK_NOT_CANCELLABLE',
      '终态再取消拒绝',
    );

    const deck = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      'deck 详情',
    );
    expect(deck.deckStatus).toBe('DRAFT');
    expectBlankish(deck.currentVersionId);
  });

  it('进度轮询-批量 taskIds 返回状态派生进度；非属主/不存在静默跳过', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const submit = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '任务',
    );
    const taskId = submit.taskId;
    await awaitTaskTerminal(ctx, session, taskId, AWAIT_MS);

    const progress = okData(
      await postJson(ctx, session, '/gen/task/progress', { taskIds: [taskId, 'not-exist'] }),
      '进度',
    );
    expect(progress).toHaveLength(1);
    expect(progress[0].taskId).toBe(taskId);
    expect(progress[0].taskStatus).toBe('SUCCEEDED');
    expect(progress[0].progressPercent).toBe(100);
  });

  // ------------------------------------------------------------------
  // D3 分叉（adjust 整稿链 + 版本留档落新分支）
  // ------------------------------------------------------------------

  it('D3 分叉-基线≠当前：未 confirm 返回提示态不建任务；confirm 后留档落新分支并切 activeBranch', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    // 真链铺两版：v1（基线）→ v2（当前指针移走，v1 成为历史基线）
    const first = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '首版任务',
    );
    const v1 = (
      await awaitTaskTerminal(ctx, session, first.taskId, AWAIT_MS)
    ).resultVersionId;
    const second = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '二版任务',
    );
    await awaitTaskTerminal(ctx, session, second.taskId, AWAIT_MS);

    // 基线 v1 ≠ 当前：confirm 缺省 → needForkBranch 提示、不创建任务
    const prompt = okData(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: v1,
        instructionText: '语气更正式',
      }),
      '分叉提示',
    );
    expect(prompt.needForkBranch).toBe(true);
    expectBlankish(prompt.taskId);

    // confirm=true + branchName → 建任务（forked=true）
    const submitted = okData(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: v1,
        instructionText: '语气更正式',
        confirm: true,
        branchName: 'formal',
      }),
      '确认分叉提交',
    );
    expect(submitted.forked).toBe(true);
    expect(submitted.branchName).toBe('formal');
    expect(submitted.taskId).toBeTruthy();

    const terminal = await awaitTaskTerminal(ctx, session, submitted.taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');
    expect(terminal.taskType).toBe('FULL_ADJUST');
    const v3 = terminal.resultVersionId;

    // 留档落新分支：branch=formal、parentVersionId=基线 v1、seq=3（deck 级单调）
    const v3Detail = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v3 }),
      '分叉版本详情',
    );
    expect(v3Detail.branchName).toBe('formal');
    expect(v3Detail.parentVersionId).toBe(v1);
    expect(v3Detail.versionSeq).toBe(3);

    // activeBranch 切换 + 指针=分叉版本
    const tree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId, branchScope: 'ALL' }),
      '分叉后版本树',
    );
    expect(tree.activeBranch).toBe('formal');
    expect(tree.currentVersionId).toBe(v3);
    // 分支列表：main 与 formal 并存，formal 活动置顶
    expect(tree.branches).toHaveLength(2);
    expect(tree.branches[0].branchName).toBe('formal');
    expect(tree.branches[0].isActive).toBe(true);
  });

  it('D3 分支名冲突-confirm 指向已占用分支名/缺分支名 → BIZ_ADJUST_SCOPE_INVALID', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const first = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '首版任务',
    );
    const v1 = (
      await awaitTaskTerminal(ctx, session, first.taskId, AWAIT_MS)
    ).resultVersionId;
    const second = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '二版任务',
    );
    await awaitTaskTerminal(ctx, session, second.taskId, AWAIT_MS);

    // main 已被占用（活动分支）
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: v1,
        instructionText: '语气更正式',
        confirm: true,
        branchName: 'main',
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '分叉分支名冲突',
    );

    // 确认分叉但未命名
    bizFail(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: v1,
        instructionText: '语气更正式',
        confirm: true,
      }),
      'BIZ_ADJUST_SCOPE_INVALID',
      '确认分叉缺分支名',
    );
  });

  it('基线=当前-常规整稿调整：不提示分叉，直接建任务并产版本', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const first = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: OUTLINE_JSON,
      }),
      '首版任务',
    );
    const v1 = (
      await awaitTaskTerminal(ctx, session, first.taskId, AWAIT_MS)
    ).resultVersionId;

    const submitted = okData(
      await postJson(ctx, session, '/adjust/whole/submit', {
        deckId,
        baseVersionId: v1,
        instructionText: '更精简一些',
      }),
      '常规整稿调整',
    );
    expect(submitted.needForkBranch).toBe(false);
    expect(submitted.forked).toBe(false);

    const terminal = await awaitTaskTerminal(ctx, session, submitted.taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');
    const v2 = terminal.resultVersionId;
    const v2Detail = okData(
      await postJson(ctx, session, '/ver/version/detail', { versionId: v2 }),
      '调整版本详情',
    );
    // 常规留档：仍 main 分支、parent=当前（v1）、seq=2
    expect(v2Detail.branchName).toBe('main');
    expect(v2Detail.parentVersionId).toBe(v1);
    expect(v2Detail.versionSeq).toBe(2);
    expect(v2Detail.sourceType).toBe('FULL_ADJUST');
  });

  // ------------------------------------------------------------------
  // 失败 / 重试 / 用量
  // ------------------------------------------------------------------

  it('FAILED-provider 失败：任务终态 FAILED+error_msg，不产版本，deck 保持 DRAFT（ADR-003）', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const taskId = await createNoAdapterTask(deckId, session.userId, 'FULL_GENERATE');
    const terminal = await awaitTaskTerminal(ctx, session, taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('FAILED');
    expect(terminal.errorMsg).toBeTruthy();
    expectBlankish(terminal.resultVersionId);

    const tree = okData(
      await postJson(ctx, session, '/ver/version/tree', { deckId }),
      '版本树',
    );
    expect(tree.tree).toHaveLength(0);
    const deck = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      'deck 详情',
    );
    expect(deck.deckStatus).toBe('DRAFT');
    expectBlankish(deck.currentVersionId);
  });

  it('retry-仅 FAILED 可重试；重试为新任务实例（新 taskId/taskCode），原任务保持 FAILED', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const failedTaskId = await createNoAdapterTask(deckId, session.userId, 'FULL_GENERATE');
    const failedTerminal = await awaitTaskTerminal(ctx, session, failedTaskId, AWAIT_MS);
    expect(failedTerminal.taskStatus).toBe('FAILED');

    // 非 FAILED 任务不可重试（造一个成功任务验证）
    const successSubmit = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: '[{"nodeId":"n1","title":"t"}]',
      }),
      '成功任务',
    );
    const successTaskId = successSubmit.taskId;
    await awaitTaskTerminal(ctx, session, successTaskId, AWAIT_MS);
    bizFail(
      await postJson(ctx, session, '/gen/task/retry', { taskId: successTaskId }),
      'BIZ_TASK_SCOPE_INVALID',
      '成功任务不可重试',
    );

    // FAILED 重试 → 新实例（快照复制 + 当前偏好重新路由 → MOCK 成功）
    const retried = okData(
      await postJson(ctx, session, '/gen/task/retry', { taskId: failedTaskId }),
      '重试失败任务',
    );
    const newTaskId = retried.taskId;
    expect(newTaskId).not.toBe(failedTaskId);
    expect(retried.taskCode).toBeTruthy();

    const terminal = await awaitTaskTerminal(ctx, session, newTaskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');

    const failedDetail = okData(
      await postJson(ctx, session, '/gen/task/detail', { taskId: failedTaskId }),
      '原任务详情',
    );
    expect(failedDetail.taskStatus).toBe('FAILED');
  });

  it('用量入账-SUCCEEDED 回调后 dl_usage_record 出现该 task 行（channel/model/tokens）', async () => {
    const session = await ctx.newSession();
    const deckId = await createDeck(ctx, session);

    const submit = okData(
      await postJson(ctx, session, '/gen/full/generate', {
        deckId,
        outlineSnapshot: '[{"nodeId":"n1","title":"t"}]',
      }),
      '任务',
    );
    const taskId = submit.taskId;
    const terminal = await awaitTaskTerminal(ctx, session, taskId, AWAIT_MS);
    expect(terminal.taskStatus).toBe('SUCCEEDED');

    const record = await ctx
      .connection()
      .collection('dl_usage_record')
      .findOne({ task_id: taskId });
    expect(record).not.toBeNull();
    expect(record!.user_id).toBe(session.userId);
    expect(record!.channel_code).toBe('MOCK');
    expect(record!.model_code).toBe('MOCK-LITE');
    expect(record!.task_type).toBe('FULL_GENERATE');
    expect(record!.prompt_tokens).toBeGreaterThan(0);
    expect(record!.completion_tokens).toBeGreaterThan(0);
  });
});

/** 「无值」断言（null/undefined/空串） */
function expectBlankish(value: unknown): void {
  expect(
    value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0),
  ).toBe(true);
}
