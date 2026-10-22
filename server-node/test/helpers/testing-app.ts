/**
 * 集成测试基建（v1 BaseTest/TestFixtures 的 TS 平移 + v3 会话形态适配）。
 *
 * - 全管道 HTTP：Test.createTestingModule(AppModule) → createNestApplication，
 *   注册与 main.ts 相同的全局 ValidationPipe（whitelist+transform），supertest
 *   走真实 Express 管道（AuthGuard/ValidationPipe/BizExceptionFilter 全经过）；
 * - 会话：v3 鉴权为 X-Auth-Token（platform SessionTokenService）——先注册再登录，
 *   accountId 即业务 userId（token 校验返回 userId=accountId）；
 * - 数据隔离：每用例自建数据（唯一 email/accountId/deckId），不依赖执行顺序；
 * - 版本铺底（deck/version/deliver 域）：经 VersionArchiveService#createVersionFromTask
 *   ——与 generation 成功回调同款领域写路径（回调线程无会话语境，服务直调），
 *   首版 DRAFT→ITERATING 经 DeckDomainService#onFirstVersionCreated（回调链同款编排）。
 */
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { DeckDomainService } from '../../src/deck/deck.domain-service';
import { VersionArchiveService } from '../../src/version/version.archive-service';
import { VersionArchiveCommand } from '../../src/version/version.dto';

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

export interface Session {
  /** accountId（=业务 userId：SessionTokenService.verify 返回 userId=accountId） */
  userId: string;
  token: string;
  email: string;
}

/** 测试账号统一口令（合成夹具非真实凭据；可经 DECK_TEST_PASSWORD 覆盖，8~64 位注册约束） */
export const TEST_PASSWORD = process.env.DECK_TEST_PASSWORD ?? 'passw0rd!';

/** 登录失败用例口令（合成夹具；与 TEST_PASSWORD 不同即可） */
export const WRONG_PASSWORD = process.env.DECK_TEST_WRONG_PASSWORD ?? 'wrong-pass';

/** 模拟渠道 apiKey（合成夹具非真实密钥；可经 DECK_TEST_MOCK_API_KEY 覆盖） */
export const MOCK_CHANNEL_API_KEY =
  process.env.DECK_TEST_MOCK_API_KEY ?? 'local-mock-key-not-a-secret';

let userSeq = 0;

/** 每用例唯一 userId/email（数据隔离，v1 uniqueUserId 对齐） */
export function uniqueTag(prefix: string): string {
  userSeq += 1;
  return `${prefix}-${process.pid.toString(36)}-${Date.now().toString(36)}-${userSeq}`;
}

/* ------------------------------------------------------------------ */
/* 应用上下文                                                          */
/* ------------------------------------------------------------------ */

export class TestContext {
  private constructor(
    readonly app: INestApplication,
    readonly server: unknown,
  ) {}

  /** 启动完整 Nest 应用（含与 main.ts 一致的全局管道），不监听端口 */
  static async create(): Promise<TestContext> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    return new TestContext(app, app.getHttpServer());
  }

  /** 进程内服务获取（夹具/直调场景） */
  get<T>(tokenOrClass: abstract new (...args: never[]) => T): T {
    return this.app.get<T>(tokenOrClass, { strict: false });
  }

  /** mongoose 默认连接（直查铺底/断言用） */
  connection(): Connection {
    return this.app.get<Connection>(getConnectionToken(), { strict: false });
  }

  /** 注册 + 登录 → 会话（业务数据以 accountId 为 userId） */
  async newSession(prefix = 'u'): Promise<Session> {
    const email = `${uniqueTag(prefix)}@test.local`;
    const registered = await postPublic(this, 'register', {
      email,
      password: TEST_PASSWORD,
      nickname: `tester-${prefix}`,
    });
    const userId = okData(registered, '注册').accountId;
    const login = okData(
      await postPublic(this, 'login', { email, password: TEST_PASSWORD }),
      '登录',
    );
    return { userId, token: login.token, email };
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}

/* ------------------------------------------------------------------ */
/* HTTP 助手（Result 断言口径与 v1 assertOkData/assertBizError 对齐）     */
/* ------------------------------------------------------------------ */

/** 业务成功断言：status=true / code=0，返回 data（v1 assertOkData 对齐） */
export function okData(body: unknown, scene: string): any {
  expect(body).toBeDefined();
  const result = body as { status?: unknown; code?: unknown; data?: unknown };
  expect(result.status).toBe(true);
  expect(String(result.code)).toBe('0');
  return result.data;
}

/** 业务失败断言：status=false 且 code=期望错误码，返回 msg */
export function bizFail(body: unknown, expectedCode: string, scene: string): string {
  const result = body as { status?: unknown; code?: unknown; msg?: unknown };
  expect(result.status).toBe(false);
  expect(String(result.code)).toBe(expectedCode);
  return String(result.msg ?? '');
}

/** 「无值」断言：null/undefined/空串/字段缺席均视为空（v1 assertBlankNode 对齐） */
export function expectBlank(value: unknown, scene: string): void {
  const blank =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0);
  expect(blank).toBe(true);
}

/** POST JSON（带会话头），HTTP 200 + 解析后的 Result 树（不断言业务 status） */
export async function postJson(
  ctx: TestContext,
  session: Session,
  path: string,
  body: unknown,
): Promise<unknown> {
  assertRelativePath(path);
  const res = await request(ctx.server as never)
    .post(path)
    .set('x-auth-token', session.token)
    .send(body ?? {});
  expect(res.status).toBe(200);
  return res.body;
}

/** 相对路径守卫：仅允许应用内路径，杜绝绝对 URL / 越权主机（防 SSRF 约束） */
function assertRelativePath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`测试助手仅接受应用内相对路径: ${path}`);
  }
}

/** @Public 端点路由白名单（编译期键约束：不接受任意 URL 字符串） */
const PUBLIC_ROUTES = {
  register: '/auth/account/register',
  login: '/auth/account/login',
} as const;

/** POST JSON（匿名，@Public 端点；路由仅限白名单键） */
export async function postPublic(
  ctx: TestContext,
  route: keyof typeof PUBLIC_ROUTES,
  body: unknown,
): Promise<unknown> {
  const res = await request(ctx.server as never)
    .post(PUBLIC_ROUTES[route])
    .send(body ?? {});
  expect(res.status).toBe(200);
  return res.body;
}

/* ------------------------------------------------------------------ */
/* 异步网关等待助手（v1 awaitTaskTerminal/awaitExportTerminal 对齐）      */
/* ------------------------------------------------------------------ */

const TASK_TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const EXPORT_TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

/** 轮询任务详情至终态，返回终态 data */
export async function awaitTaskTerminal(
  ctx: TestContext,
  session: Session,
  taskId: string,
  timeoutMillis = 20_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMillis;
  let data: any = null;
  while (Date.now() < deadline) {
    data = okData(
      await postJson(ctx, session, '/gen/task/detail', { taskId }),
      '任务详情轮询',
    );
    if (TASK_TERMINAL.includes(data.taskStatus)) {
      return data;
    }
    await sleep(100);
  }
  return data;
}

/** 轮询导出行至终态（经 /deliver/export/list 单条筛出） */
export async function awaitExportTerminal(
  ctx: TestContext,
  session: Session,
  exportId: string,
  timeoutMillis = 20_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMillis;
  let row: any = null;
  while (Date.now() < deadline) {
    const data = okData(
      await postJson(ctx, session, '/deliver/export/list', { pageNum: 1, pageSize: 50 }),
      '导出列表轮询',
    );
    for (const record of data.records ?? []) {
      if (String(record.exportId) === String(exportId)) {
        row = record;
        if (EXPORT_TERMINAL.includes(record.exportStatus)) {
          return row;
        }
        break;
      }
    }
    await sleep(100);
  }
  return row;
}

/** 轮询直到谓词为真（默认间隔 100ms；超时抛错） */
export async function awaitUntil(
  condition: () => Promise<boolean> | boolean,
  timeoutMillis: number,
  waitingFor: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`等待超时: ${waitingFor}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* 铺底夹具（deck/版本种子，v1 TestFixtures 对齐）                       */
/* ------------------------------------------------------------------ */

let seedSeq = 0;

/** 建 deck（DRAFT，经 /deck/deck/save 正常 HTTP 写路径） */
export async function createDeck(
  ctx: TestContext,
  session: Session,
  namePrefix = '测试创作物',
): Promise<string> {
  seedSeq += 1;
  const saved = okData(
    await postJson(ctx, session, '/deck/deck/save', {
      deckName: `${namePrefix}-${seedSeq}`,
      deckType: 'DECK',
      topic: `测试主题-${seedSeq}`,
    }),
    '新建 deck',
  );
  return saved.deckId;
}

/**
 * 在 deck 上留档一个版本（VersionArchiveService#createVersionFromTask，
 * generation 成功回调同款领域写路径，同步执行）。
 * DRAFT 首版后再留档需先 toIterating（movePointer 状态守卫）。
 */
export async function archiveVersion(
  ctx: TestContext,
  deckId: string,
  userId: string,
  content: Record<string, unknown>,
): Promise<{ versionId: string; versionSeq: number }> {
  const archiveService = ctx.get(VersionArchiveService);
  const command = new VersionArchiveCommand();
  command.deckId = deckId;
  command.userId = userId;
  command.taskId = `seed-task-${Date.now().toString(36)}-${(seedSeq += 1)}`;
  command.sourceType = 'FULL_GENERATE';
  command.instructionSnapshot = { topic: 'seed', instruction: 'seed' };
  command.content = content;
  return archiveService.createVersionFromTask(command);
}

/** DRAFT → ITERATING（回调链首版状态编排同款） */
export async function toIterating(ctx: TestContext, deckId: string, userId: string): Promise<void> {
  await ctx.get(DeckDomainService).onFirstVersionCreated(deckId, userId);
}

/* ------------------------------------------------------------------ */
/* 版本内容构造（pageId/blockId 契约字段，api-version §4.1）             */
/* ------------------------------------------------------------------ */

/** 单页文本版本内容 */
export function textPageContent(
  pageId: string,
  blockId: string,
  text: string,
): Record<string, unknown> {
  return {
    pages: [
      {
        pageId,
        title: `第${pageId}页`,
        blocks: [{ blockId, blockType: 'TEXT', text }],
      },
    ],
  };
}

/** 双页内容（compare NEW/REMOVED 场景） */
export function twoPageContent(pageId1: string, pageId2: string): Record<string, unknown> {
  return {
    pages: [
      { pageId: pageId1, title: '页一', blocks: [] },
      { pageId: pageId2, title: '页二', blocks: [] },
    ],
  };
}

/** 图片引用版本内容（INV-18 引用计数输入） */
export function imageRefContent(
  pageId: string,
  assetId: string,
): Record<string, unknown> {
  return {
    pages: [
      {
        pageId,
        title: '图片页',
        blocks: [{ blockId: 'b-img', blockType: 'IMAGE', assetId }],
      },
    ],
  };
}

/** 单页 TEXT+IMAGE 双块内容（adjust 作用域铺底，v1 iteratingDeckWithBaseVersion 对齐） */
export function textAndImageBlockContent(): Record<string, unknown> {
  return {
    pages: [
      {
        pageId: 'p1',
        title: '首页',
        blocks: [
          { blockId: 'b-text', blockType: 'TEXT', text: 'hello' },
          { blockId: 'b-img', blockType: 'IMAGE', assetId: 'a-none' },
        ],
      },
    ],
  };
}
