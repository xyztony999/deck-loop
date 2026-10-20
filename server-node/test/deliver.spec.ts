/**
 * deliver 域导出链路集成测试（v1 ExportFlowTest 平移；ADR-015 客户端渲染改造）。
 *
 * 覆盖：submit（FINALIZED 守卫 / PPTX beta 提示态）→ **客户端产物回传 upload**
 * （魔数/属主/QUEUED 前置校验）→ 票据签发（HMAC 30min）→ GET 下载验签
 * （Content-Disposition / 字节往返 / 篡改拒）→ cancel 幂等 → fail 上报 →
 * 上传校验负面（魔数不符/重复回传拒绝）→ 导出列表冗余列。
 *
 * v1 下载经服务直调（HTTP 端点 -parameters 缺陷）；v3 GET /deliver/export/download
 * 为 @Public + 显式 @Query 参数，HTTP 全管道直测（覆盖面含 v1 @Disabled 复现用例）。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  Session,
  TestContext,
  archiveVersion,
  createDeck,
  okData,
  bizFail,
  postJson,
  textPageContent,
  toIterating,
} from './helpers/testing-app';

/** 回传产物夹具（合法魔数）：PDF=%PDF- 头；ZIP 系=PK 头 */
const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n', 'latin1'),
  Buffer.from([0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a]), // "1 0 obj"
  Buffer.from('\n%%EOF\n', 'latin1'),
]);
const ZIP_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
  Buffer.alloc(32, 0),
]);

describe('deliver 域导出链路（ExportFlowTest 对齐）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // 导出产物落盘指向临时目录（不污染仓库工作区；ArtifactStorage 构造时读 env）
    process.env.EXPORT_ARTIFACT_DIR = join(tmpdir(), 'deck-loop-test-exports');
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.close();
    delete process.env.EXPORT_ARTIFACT_DIR;
  });

  /** 建一个 FINALIZED deck（含定稿版本），返回 deckId。 */
  async function finalizedDeck(session: Session): Promise<string> {
    const deckId = await createDeck(ctx, session);
    await archiveVersion(ctx, deckId, session.userId, textPageContent('p1', 'b1', 'final'));
    await toIterating(ctx, deckId, session.userId);
    okData(
      await postJson(ctx, session, '/deck/deck/finalize', { deckId, confirm: true }),
      '定稿',
    );
    return deckId;
  }

  /** 落一行 QUEUED 导出任务（绕过渲染网关，冻结在未就绪态；v1 seedQueuedExport 对齐） */
  async function seedQueuedExport(session: Session, deckId: string): Promise<string> {
    const detail = okData(
      await postJson(ctx, session, '/deck/deck/detail', { deckId }),
      'deck 详情',
    );
    const now = new Date();
    const exportId = `9${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await ctx.connection().collection('dl_export_task').insertOne({
      export_id: exportId,
      export_code: `EXTEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
      deck_id: deckId,
      version_id: detail.finalVersionId,
      export_format: 'PDF',
      export_status: 'QUEUED',
      file_key: null,
      file_size: null,
      error_msg: null,
      user_id: session.userId,
      created_by: session.userId,
      created_name: session.userId,
      created_time: now,
      updated_by: session.userId,
      updated_name: session.userId,
      updated_time: now,
      data_version: 0,
      delete_sign: 0,
    });
    return exportId;
  }

  /** 客户端产物回传（multipart：file + exportId；ADR-015） */
  async function uploadArtifact(
    session: Session,
    exportId: string,
    bytes: Buffer,
    filename: string,
  ): Promise<unknown> {
    const res = await request(ctx.server as never)
      .post('/deliver/export/upload')
      .set('x-auth-token', session.token)
      .field('exportId', exportId)
      .attach('file', bytes, filename);
    expect(res.status).toBe(200);
    return res.body;
  }

  it('导出链-非 FINALIZED 拒绝；PDF 提交→客户端回传 SUCCEEDED→票据→HTTP 下载（字节往返+Disposition）；篡改拒', async () => {
    const session = await ctx.newSession();

    // 未定稿拒绝（deck 域守卫：ExportService 委托 BIZ_DECK_STATUS_FORBIDDEN）
    const iteratingDeck = await createDeck(ctx, session);
    await archiveVersion(
      ctx,
      iteratingDeck,
      session.userId,
      textPageContent('p1', 'b1', 'v1'),
    );
    await toIterating(ctx, iteratingDeck, session.userId);
    bizFail(
      await postJson(ctx, session, '/deliver/export/submit', {
        deckId: iteratingDeck,
        exportFormat: 'PDF',
      }),
      'BIZ_DECK_STATUS_FORBIDDEN',
      '未定稿导出拒绝',
    );

    // 定稿后 PDF 导出全链
    const deckId = await finalizedDeck(session);
    const submit = okData(
      await postJson(ctx, session, '/deliver/export/submit', {
        deckId,
        exportFormat: 'PDF',
      }),
      '提交导出',
    );
    const exportId = submit.exportId;
    expect(exportId).toBeTruthy();
    expect(submit.exportStatus).toBe('QUEUED');

    const uploaded = okData(
      await uploadArtifact(session, exportId, PDF_BYTES, 'deck.pdf'),
      '客户端回传产物',
    );
    expect(uploaded.exportStatus).toBe('SUCCEEDED');

    // 票据
    const ticket = okData(
      await postJson(ctx, session, '/deliver/export/download-ticket', { exportId }),
      '签发票据',
    );
    expect(ticket.expiresIn).toBe(1800);
    const url: string = ticket.url;
    expect(url).toContain(`/deliver/export/download?exportId=${exportId}&token=`);
    // url 中 token 经 URL 编码（':' → %3A），下载前需还原
    const token = decodeURIComponent(url.slice(url.indexOf('token=') + 'token='.length));

    // GET 下载（@Public 全管道：真实响应头 + 文件字节）
    const download = await request(ctx.server as never)
      .get(`/deliver/export/download?exportId=${exportId}&token=${encodeURIComponent(token)}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(String(download.headers['content-disposition'])).toContain('attachment;');
    expect(String(download.headers['content-disposition'])).toContain('.pdf');
    expect(download.body.slice(0, 5).toString('ascii')).toBe('%PDF-');

    // 篡改凭证 → 拒绝（业务异常经全局 Filter 转 Result，HTTP 200）
    const tamperedRes = await request(ctx.server as never)
      .get(
        `/deliver/export/download?exportId=${exportId}&token=${encodeURIComponent(
          token.slice(0, -2) + 'zz',
        )}`,
      );
    expect(tamperedRes.status).toBe(200);
    bizFail(tamperedRes.body, 'BIZ_EXPORT_NOT_DOWNLOADABLE', '篡改凭证拒绝');
  });

  it('未就绪下载-QUEUED 阶段签票被拒（BIZ_EXPORT_NOT_DOWNLOADABLE）', async () => {
    const session = await ctx.newSession();
    const deckId = await finalizedDeck(session);

    const frozenExportId = await seedQueuedExport(session, deckId);
    bizFail(
      await postJson(ctx, session, '/deliver/export/download-ticket', {
        exportId: frozenExportId,
      }),
      'BIZ_EXPORT_NOT_DOWNLOADABLE',
      '未就绪签票拒绝',
    );
  });

  it('取消幂等-QUEUED 取消→CANCELLED；重复取消静默成功不改状态', async () => {
    const session = await ctx.newSession();
    const deckId = await finalizedDeck(session);

    const exportId = await seedQueuedExport(session, deckId);
    okData(await postJson(ctx, session, '/deliver/export/cancel', { exportId }), '取消');
    const list1 = okData(
      await postJson(ctx, session, '/deliver/export/list', { pageNum: 1, pageSize: 50 }),
      '导出列表',
    );
    const row1 = list1.records.find((record: any) => String(record.exportId) === exportId);
    expect(row1.exportStatus).toBe('CANCELLED');

    // 重复取消：幂等返回（Result 成功、状态不变）
    okData(await postJson(ctx, session, '/deliver/export/cancel', { exportId }), '重复取消幂等');
    const list2 = okData(
      await postJson(ctx, session, '/deliver/export/list', { pageNum: 1, pageSize: 50 }),
      '导出列表复查',
    );
    const row2 = list2.records.find((record: any) => String(record.exportId) === exportId);
    expect(row2.exportStatus).toBe('CANCELLED');
  });

  it('PPTX beta-缺 confirm 返回提示态（不建任务）；confirm=true 受理并渲染成功', async () => {
    const session = await ctx.newSession();
    const deckId = await finalizedDeck(session);

    // F05（功能核查 2026-10-20）：契约要求提示态成功回执而非业务错误
    const prompt = okData(
      await postJson(ctx, session, '/deliver/export/submit', {
        deckId,
        exportFormat: 'PPTX',
      }),
      'PPTX beta 提示态',
    );
    expect(prompt.needConfirm).toBe(true);
    expect(prompt.exportId).toBe('');
    const submit = okData(
      await postJson(ctx, session, '/deliver/export/submit', {
        deckId,
        exportFormat: 'PPTX',
        confirm: true,
      }),
      'PPTX 确认提交',
    );
    expect(submit.needConfirm).toBe(true);

    const uploaded = okData(
      await uploadArtifact(session, submit.exportId, ZIP_BYTES, 'deck.pptx'),
      'PPTX 客户端回传',
    );
    expect(uploaded.exportStatus).toBe('SUCCEEDED');
  });

  it('导出列表-按 deck 过滤含 deckName/versionSeq 冗余', async () => {
    const session = await ctx.newSession();
    const deckId = await finalizedDeck(session);
    const submit = okData(
      await postJson(ctx, session, '/deliver/export/submit', { deckId, exportFormat: 'PDF' }),
      '提交导出',
    );
    okData(await uploadArtifact(session, submit.exportId, PDF_BYTES, 'deck.pdf'), '回传产物');

    const list = okData(
      await postJson(ctx, session, '/deliver/export/list', { deckId }),
      '导出列表',
    );
    expect(list.total).toBe(1);
    const row = list.records[0];
    expect(row.deckName).toBeTruthy();
    expect(row.versionSeq).toBe(1);
    expect(row.exportStatus).toBe('SUCCEEDED');
  });

  it('上传校验-魔数不符拒绝；重复回传拒绝；fail 上报 FAILED 且幂等', async () => {
    const session = await ctx.newSession();
    const deckId = await finalizedDeck(session);

    // 魔数不符：PDF 任务回传 ZIP 字节 → BIZ_EXPORT_UPLOAD_INVALID（任务仍 QUEUED）
    const submit = okData(
      await postJson(ctx, session, '/deliver/export/submit', { deckId, exportFormat: 'PDF' }),
      '提交导出',
    );
    bizFail(
      await uploadArtifact(session, submit.exportId, ZIP_BYTES, 'deck.pdf'),
      'BIZ_EXPORT_UPLOAD_INVALID',
      '魔数不符拒绝',
    );
    let list = okData(
      await postJson(ctx, session, '/deliver/export/list', { deckId }),
      '列表复查',
    );
    expect(list.records.find((r: any) => r.exportId === submit.exportId).exportStatus).toBe('QUEUED');

    // 合法回传 → SUCCEEDED；重复回传 → 拒绝（已离开 QUEUED）
    okData(await uploadArtifact(session, submit.exportId, PDF_BYTES, 'deck.pdf'), '合法回传');
    bizFail(
      await uploadArtifact(session, submit.exportId, PDF_BYTES, 'deck.pdf'),
      'BIZ_EXPORT_UPLOAD_INVALID',
      '重复回传拒绝',
    );

    // fail 上报：新任务 QUEUED→FAILED（error_msg 截断落库）；重复上报幂等
    const submit2 = okData(
      await postJson(ctx, session, '/deliver/export/submit', { deckId, exportFormat: 'IMAGES' }),
      '提交导出2',
    );
    okData(
      await postJson(ctx, session, '/deliver/export/fail', {
        exportId: submit2.exportId,
        errorMsg: '客户端渲染失败：本地字体缺失',
      }),
      '失败上报',
    );
    list = okData(await postJson(ctx, session, '/deliver/export/list', { deckId }), '列表复查2');
    const failedRow = list.records.find((r: any) => r.exportId === submit2.exportId);
    expect(failedRow.exportStatus).toBe('FAILED');
    // 重复上报：幂等返回（已终态，不报错）
    okData(
      await postJson(ctx, session, '/deliver/export/fail', { exportId: submit2.exportId }),
      '重复上报幂等',
    );
  });
});
