/**
 * channel 域集成测试（v1 ChannelPreferenceResolveTest 平移，业务预期不变）。
 *
 * 覆盖：resolve 四层链（第 1 级任务显式不可用直抛 BIZ_CHANNEL_UNAVAILABLE 不降级/
 * 未注册/不成对拒、第 2 级偏好档位命中 TIER + 渠道下线自动降级 DEFAULT（D3 容错）、
 * 第 4 级平台兜底 priority 最高 enabled 渠道）、偏好 upsert INV-22
 * （默认/档位未启用拒、合法插入+更新同 preferenceId、detail 全量反映）、
 * 模型选择池按能力标签过滤。
 *
 * resolve 为进程内跨域契约（无 HTTP 端点，消费方 generation/adjustment）——
 * 服务直调（ChannelPreferenceService#resolve），与 v1 同口径。
 *
 * 测试渠道（GATEWAY_CHANNELS，v1 application-test.yml 对齐）：MOCK（enabled+适配器）、
 * MOCK-NOADAPTER（enabled+无适配器）、MOCK-DISABLED（注册但停用）。
 */
import { ChannelPreferenceService } from '../src/channel/channel.service';
import {
  MOCK_CHANNEL_API_KEY,
  TestContext,
  okData,
  bizFail,
  postJson,
} from './helpers/testing-app';

const TEST_GATEWAY_CHANNELS = JSON.stringify([
  {
    channelCode: 'MOCK',
    channelName: '内置模拟渠道',
    priority: 100,
    enabled: true,
    apiKey: MOCK_CHANNEL_API_KEY,
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
  {
    channelCode: 'MOCK-DISABLED',
    channelName: '已停用渠道',
    priority: 30,
    enabled: false,
    models: [
      { modelCode: 'MOCK-OFF-1', modelName: '停用模型', capabilityTags: [], enabled: true },
    ],
  },
]);

/** 偏好保存 body 构造（v1 preferenceBody 对齐） */
function preferenceBody(
  channel: string,
  model: string,
  tiers: Record<string, [string, string]> | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    defaultChannelCode: channel,
    defaultModelCode: model,
  };
  if (tiers !== null) {
    const tierMap: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tiers)) {
      tierMap[key] = { channelCode: value[0], modelCode: value[1] };
    }
    body.preferenceMap = tierMap;
  }
  return body;
}

describe('channel 域偏好与路由（ChannelPreferenceResolveTest 对齐）', () => {
  let ctx: TestContext;
  let service: ChannelPreferenceService;

  beforeAll(async () => {
    process.env.GATEWAY_CHANNELS = TEST_GATEWAY_CHANNELS;
    ctx = await TestContext.create();
    service = ctx.get(ChannelPreferenceService);
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.GATEWAY_CHANNELS;
  });

  // ------------------------------------------------------------------
  // resolve 四层链（服务直调，路由为进程内契约）
  // ------------------------------------------------------------------

  it('第4级平台兜底-无偏好用户解析到 MOCK/MOCK-LITE（priority 最高 enabled 渠道）', async () => {
    const session = await ctx.newSession();
    const decision = await service.resolve('FULL_GENERATE', session.userId);
    expect(decision.channelCode).toBe('MOCK');
    expect(decision.modelCode).toBe('MOCK-LITE');
    expect(decision.source).toBe('PLATFORM_FALLBACK');
  });

  it('第1级任务显式-成对可用直返 EXPLICIT；停用渠道/未注册渠道/不成对均拒绝', async () => {
    const session = await ctx.newSession();

    // 可用显式直返
    const decision = await service.resolve('FULL_GENERATE', session.userId, {
      channelCode: 'MOCK',
      modelCode: 'MOCK-LITE',
    });
    expect(decision.channelCode).toBe('MOCK');
    expect(decision.source).toBe('EXPLICIT');

    // 显式不可用（已注册但停用）：直接失败不降级
    await expect(
      service.resolve('FULL_GENERATE', session.userId, {
        channelCode: 'MOCK-DISABLED',
        modelCode: 'MOCK-OFF-1',
      }),
    ).rejects.toMatchObject({ code: 'BIZ_CHANNEL_UNAVAILABLE' });

    // 显式未注册
    await expect(
      service.resolve('FULL_GENERATE', session.userId, {
        channelCode: 'NO-SUCH-CHANNEL',
        modelCode: 'NO-SUCH-MODEL',
      }),
    ).rejects.toMatchObject({ code: 'BIZ_CHANNEL_UNAVAILABLE' });

    // 不成对（仅渠道无模型）
    await expect(
      service.resolve('FULL_GENERATE', session.userId, { channelCode: 'MOCK' }),
    ).rejects.toThrow(/成对/);
  });

  it('第2级偏好档位-命中直返 TIER；渠道下线自动降级到默认（D3 容错）', async () => {
    const session = await ctx.newSession();

    // 偏好：默认 MOCK/MOCK-LITE + OUTLINE 档位 MOCK/MOCK-LITE（经 upsert 正常写入）
    okData(
      await postJson(ctx, session, '/channel/preference/save', preferenceBody('MOCK', 'MOCK-LITE', {
        OUTLINE: ['MOCK', 'MOCK-LITE'],
      })),
      '保存偏好',
    );

    const tierHit = await service.resolve('OUTLINE', session.userId);
    expect(tierHit.channelCode).toBe('MOCK');
    expect(tierHit.source).toBe('TIER');

    // FULL_GENERATE 无档位 → 默认级
    const defaultHit = await service.resolve('FULL_GENERATE', session.userId);
    expect(defaultHit.source).toBe('DEFAULT');

    // 档位渠道下线（直改 preference_map 模拟保存后渠道被停用）→ 降级到默认
    await ctx
      .connection()
      .collection('dl_channel_preference')
      .updateOne(
        { user_id: session.userId },
        {
          $set: {
            preference_map: {
              FULL_GENERATE: { channelCode: 'MOCK-DISABLED', modelCode: 'MOCK-OFF-1' },
            },
          },
        },
      );
    const degraded = await service.resolve('FULL_GENERATE', session.userId);
    expect(degraded.channelCode).toBe('MOCK');
    expect(degraded.modelCode).toBe('MOCK-LITE');
    expect(degraded.source).toBe('DEFAULT');
  });

  // ------------------------------------------------------------------
  // 偏好 upsert（INV-22/23）
  // ------------------------------------------------------------------

  it('upsert-默认渠道未启用拒绝；档位未启用拒绝；合法 upsert 后 detail 全量反映；更新同 preferenceId', async () => {
    const session = await ctx.newSession();

    // INV-22：默认渠道未在清单启用
    bizFail(
      await postJson(ctx, session, '/channel/preference/save', preferenceBody('MOCK-DISABLED', 'MOCK-OFF-1', null)),
      'BIZ_CHANNEL_UNAVAILABLE',
      '默认渠道未启用',
    );

    // INV-22：档位渠道未启用
    bizFail(
      await postJson(
        ctx,
        session,
        '/channel/preference/save',
        preferenceBody('MOCK', 'MOCK-LITE', { OUTLINE: ['NO-SUCH-CHANNEL', 'NO-SUCH-MODEL'] }),
      ),
      'BIZ_CHANNEL_UNAVAILABLE',
      '档位渠道未启用',
    );

    // 合法保存（插入）
    okData(
      await postJson(
        ctx,
        session,
        '/channel/preference/save',
        preferenceBody('MOCK', 'MOCK-LITE', { TARGETED_ADJUST: ['MOCK', 'MOCK-LITE'] }),
      ),
      '合法保存',
    );

    const detail = okData(
      await postJson(ctx, session, '/channel/preference/detail', {}),
      '偏好详情',
    );
    expect(detail.defaultChannel.code).toBe('MOCK');
    expect(detail.defaultModel.code).toBe('MOCK-LITE');
    expect(detail.fallbackChannel.code).toBe('MOCK');
    const tier = detail.preferenceMap.TARGETED_ADJUST;
    expect(tier.channelCode).toBe('MOCK');
    expect(tier.usingDefault).toBe(false);
    expect(detail.preferenceMap.OUTLINE.usingDefault).toBe(true);

    // 再保存（更新路径）：换档位并清除 TARGETED_ADJUST
    okData(
      await postJson(ctx, session, '/channel/preference/save', {
        defaultChannelCode: 'MOCK',
        defaultModelCode: 'MOCK-LITE',
        preferenceMap: { OUTLINE: { channelCode: 'MOCK', modelCode: 'MOCK-LITE' } },
      }),
      '更新保存',
    );

    const detailAfter = okData(
      await postJson(ctx, session, '/channel/preference/detail', {}),
      '更新后详情',
    );
    expect(detailAfter.preferenceMap.OUTLINE.usingDefault).toBe(false);
    // 清除后回落默认展示
    expect(detailAfter.preferenceMap.TARGETED_ADJUST.channelCode).toBe('MOCK');
    expect(detailAfter.preferenceId).toBe(detail.preferenceId);
  });

  it('模型选择池-按能力标签过滤（channel.select.modelOptions）', async () => {
    const session = await ctx.newSession();
    const all = okData(
      await postJson(ctx, session, '/channel/select/model-options', {}),
      '全部模型',
    );
    // MOCK-LITE（全能力）+ MOCK-NA-1（仅 FULL_GENERATE；MOCK-DISABLED 停用不可见）
    expect(all).toHaveLength(2);

    // OUTLINE 能力只有 MOCK-LITE 声明
    const outlineOnly = okData(
      await postJson(ctx, session, '/channel/select/model-options', {
        capabilityTag: 'OUTLINE',
      }),
      'OUTLINE 能力模型',
    );
    expect(outlineOnly).toHaveLength(1);
    expect(outlineOnly[0].modelCode).toBe('MOCK-LITE');

    const fullOnly = okData(
      await postJson(ctx, session, '/channel/select/model-options', {
        capabilityTag: 'FULL_GENERATE',
      }),
      'FULL_GENERATE 能力模型',
    );
    expect(fullOnly).toHaveLength(2);
  });
});
