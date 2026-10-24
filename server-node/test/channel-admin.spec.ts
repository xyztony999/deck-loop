/**
 * 渠道管理端集成测试（channel-admin-2026-10-23 §6）：
 * 覆盖 bootstrap 导入（MOCK seed + GATEWAY_CHANNELS 首次导入）、清单掩码、
 * 保存（加密落库不落明文）、编码唯一、builtin 只读、启停校验与选择池联动、
 * 连通性测试失败路径（SSRF 防线/缺参）。
 */
import request from 'supertest';
import { GatewayRuntimeStore } from '../src/platform/gateway/gateway-runtime-store';
import {
  TestContext,
  okData,
  postJson,
} from './helpers/testing-app';

/** 合成夹具 key（非真实凭据；可经 env 覆盖）——明文断言用，验证不落库 */
const TEST_GLM_ENV_KEY = process.env.DECK_TEST_GLM_KEY ?? 'glm-sk-test-key-not-a-secret';
const TEST_ZHIPU_PLAIN_KEY =
  process.env.DECK_TEST_ZHIPU_KEY ?? 'zhipu-sk-test-key-not-a-secret';

describe('渠道管理端（/channel/admin/*）', () => {
  let ctx: TestContext;
  let session: { userId: string; token: string; email: string };

  beforeAll(async () => {
    // env 首次导入路径：清空集合后直调引导（幂等，避免与其他套件的启动顺序耦合）
    process.env.GATEWAY_CHANNELS = JSON.stringify([
      {
        channelCode: 'GLM',
        channelName: '智谱 GLM',
        priority: 10,
        enabled: true,
        apiKey: TEST_GLM_ENV_KEY,
        apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: [
          {
            modelCode: 'glm-4.7',
            modelName: 'GLM-4.7',
            capabilityTags: ['OUTLINE', 'FULL_GENERATE', 'FULL_ADJUST', 'TARGETED_ADJUST'],
            enabled: true,
          },
        ],
      },
    ]);
    ctx = await TestContext.create();
    await ctx.connection().collection('dl_channel').deleteMany({});
    await ctx.get(GatewayRuntimeStore).bootstrapOnce();
    session = await ctx.newSession('admin');
  });

  afterAll(async () => {
    delete process.env.GATEWAY_CHANNELS;
    await ctx.close();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function adminList(): Promise<Record<string, unknown>[]> {
    const res = await postJson(ctx, session, '/channel/admin/list', {});
    return okData(res, '渠道清单').records as Record<string, unknown>[];
  }

  it('清单：MOCK builtin + env 首次导入的 GLM，密钥只回掩码', async () => {
    const records = await adminList();
    const codes = records.map((r) => r.channelCode);
    expect(codes).toContain('MOCK');
    expect(codes).toContain('GLM');

    const mock = records.find((r) => r.channelCode === 'MOCK');
    expect(mock?.builtin).toBe(true);
    expect(String(mock?.apiKeyMasked)).toContain('●●●●');

    const glm = records.find((r) => r.channelCode === 'GLM');
    expect(glm?.source).toBe('env-import');
    expect(String(glm?.apiKeyMasked)).toBe(`●●●●${TEST_GLM_ENV_KEY.slice(-4)}`);
    expect(JSON.stringify(glm)).not.toContain(TEST_GLM_ENV_KEY);
    expect((glm?.models as unknown[]).length).toBe(1);
  });

  it('保存：新建渠道加密落库（密文不含明文）并热生效进选择池', async () => {
    const saveRes = await postJson(ctx, session, '/channel/admin/save', {
      channelCode: 'ZHIPU',
      creating: true,
      channelName: '智谱直连',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: TEST_ZHIPU_PLAIN_KEY,
      priority: 50,
      enabled: true,
      models: [
        {
          modelCode: 'glm-4.6',
          modelName: 'GLM-4.6',
          capabilityTags: ['OUTLINE', 'FULL_GENERATE', 'FULL_ADJUST', 'TARGETED_ADJUST'],
          enabled: true,
        },
      ],
    });
    okData(saveRes, '保存渠道');

    // 选择池热生效（无需重启）
    const optRes = await request(ctx.server as never)
      .post('/channel/select/model-options')
      .set('x-auth-token', session.token)
      .send({ capabilityTag: 'OUTLINE' });
    const options = okData(optRes.body, '选择池') as Array<Record<string, unknown>>;
    expect(options.some((o) => o.channelCode === 'ZHIPU')).toBe(true);

    // 密文落库：明文不出现在 dl_channel
    const conn = ctx.connection();
    const doc = await conn.collection('dl_channel').findOne({ channel_code: 'ZHIPU' });
    expect(String(doc?.api_key_cipher ?? '')).toMatch(/^v1\./);
    expect(JSON.stringify(doc)).not.toContain(TEST_ZHIPU_PLAIN_KEY);
  });

  it('保存：编码唯一 / 启用须含启用模型 / builtin 只读', async () => {
    const dup = (await postJson(ctx, session, '/channel/admin/save', {
      channelCode: 'ZHIPU',
      creating: true,
      channelName: '重复编码',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: TEST_ZHIPU_PLAIN_KEY,
      enabled: true,
      models: [{ modelCode: 'm1', modelName: 'M1', capabilityTags: ['OUTLINE'], enabled: true }],
    })) as { code: string };
    expect(dup.code).toBe('BIZ_CHANNEL_CODE_EXISTS');

    const noEnabledModel = (await postJson(ctx, session, '/channel/admin/save', {
      channelCode: 'NOPE',
      creating: true,
      channelName: '无启用模型',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: TEST_ZHIPU_PLAIN_KEY,
      enabled: true,
      models: [{ modelCode: 'm1', modelName: 'M1', capabilityTags: ['OUTLINE'], enabled: false }],
    })) as { code: string };
    expect(noEnabledModel.code).toBe('BIZ_CHANNEL_NEEDS_ENABLED_MODEL');

    const builtin = (await postJson(ctx, session, '/channel/admin/save', {
      channelCode: 'MOCK',
      channelName: '篡改内置',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: TEST_ZHIPU_PLAIN_KEY,
      enabled: true,
      models: [{ modelCode: 'm', modelName: 'M', capabilityTags: ['OUTLINE'], enabled: true }],
    })) as { code: string };
    expect(builtin.code).toBe('BIZ_CHANNEL_BUILTIN_READONLY');
  });

  it('启停：停用后退出选择池，重新启用恢复', async () => {
    okData(
      await postJson(ctx, session, '/channel/admin/set-enabled', {
        channelCode: 'ZHIPU',
        enabled: false,
      }),
      '停用',
    );
    let options = (await request(ctx.server as never)
      .post('/channel/select/model-options')
      .set('x-auth-token', session.token)
      .send({})) as unknown as { body: { data: Array<Record<string, unknown>> } };
    expect((options.body.data ?? []).some((o) => o.channelCode === 'ZHIPU')).toBe(false);

    okData(
      await postJson(ctx, session, '/channel/admin/set-enabled', {
        channelCode: 'ZHIPU',
        enabled: true,
      }),
      '启用',
    );
    options = (await request(ctx.server as never)
      .post('/channel/select/model-options')
      .set('x-auth-token', session.token)
      .send({})) as unknown as { body: { data: Array<Record<string, unknown>> } };
    expect((options.body.data ?? []).some((o) => o.channelCode === 'ZHIPU')).toBe(true);
  });

  it('连通性测试：内网地址被 SSRF 防线拒绝（失败回显不抛错）', async () => {
    const res = await postJson(ctx, session, '/channel/admin/test', {
      apiBaseUrl: 'http://127.0.0.1:9999',
      apiKey: TEST_ZHIPU_PLAIN_KEY,
      modelCode: 'm',
    });
    const vo = okData(res, '连通性测试') as Record<string, unknown>;
    expect(vo.ok).toBe(false);
    expect(String(vo.errorMsg)).toContain('内网');
  });

  it('连通性测试：按渠道编码走已存密钥（MOCK 渠道回 ok 或明确原因）', async () => {
    const res = await postJson(ctx, session, '/channel/admin/test', { channelCode: 'MOCK' });
    const vo = okData(res, '连通性测试') as Record<string, unknown>;
    expect(typeof vo.ok).toBe('boolean');
  });

  it('自动获取模型：GET {baseUrl}/models 解析为模型行（密钥走已存渠道）', async () => {
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'glm-4.7' }, { id: 'glm-4.6' }, { id: 'glm-4.5-air' }] }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    try {
      const res = await postJson(ctx, session, '/channel/admin/fetch-models', {
        channelCode: 'GLM',
      });
      const vo = okData(res, '获取模型') as Record<string, unknown>;
      expect(vo.ok).toBe(true);
      const models = vo.models as Array<{ modelCode: string }>;
      expect(models.map((m) => m.modelCode)).toEqual(['glm-4.7', 'glm-4.6', 'glm-4.5-air']);
    } finally {
      spy.mockRestore();
    }
  });

  it('自动获取模型：内网地址被 SSRF 防线拒绝', async () => {
    const res = await postJson(ctx, session, '/channel/admin/fetch-models', {
      apiBaseUrl: 'http://192.168.1.1:8000',
      apiKey: TEST_ZHIPU_PLAIN_KEY,
    });
    const vo = okData(res, '获取模型') as Record<string, unknown>;
    expect(vo.ok).toBe(false);
    expect(String(vo.errorMsg)).toContain('内网');
  });
});
