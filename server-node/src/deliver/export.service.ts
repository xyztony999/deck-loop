import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ExportFormat, ExportStatus } from '../common/enums';
import { BizException } from '../common/exceptions';
import { PageResult } from '../common/result';
import { nextId } from '../common/utils/snowflake';
import { DeleteSign } from '../common/enums';
import { DeckDomainService } from '../deck/deck.domain-service';
import {
  EXPORT_NOT_DOWNLOADABLE,
  EXPORT_NOT_FINALIZED,
  EXPORT_UPLOAD_INVALID,
  EXPORT_UPLOAD_INVALID_MSG,
} from './deliver.errors';
import {
  ERROR_MSG_MAX_LENGTH,
  EXPORT_CODE_PREFIX,
  EXPORT_CODE_SEQ_WIDTH,
  contentTypeOfFormat,
  exportArtifactMaxBytes,
  extensionOfFormat,
} from './deliver.constant';
import { ExportEventPublisher } from './deliver.events';
import {
  ExportCancelAO,
  ExportFailAO,
  ExportArtifactVO,
  ExportDownloadTicketAO,
  ExportDownloadTicketVO,
  ExportListAO,
  ExportListVO,
  ExportSubmitAO,
  ExportSubmitVO,
  ID_PATTERN,
  parseTimeRangeBound,
} from './deliver.dto';
import { ExportTaskRepository } from './deliver.repository';
import { ExportArtifactStorageService } from './deliver.artifact-storage';
import { ExportDownloadTicketService } from './deliver.download-ticket.service';
import { ExportStatusFlow } from './deliver.status-flow';
import { resolveExportOperList } from './deliver.oper-resolver';

import { ExportTask } from './schemas/dl_export_task.schema';
import type { ExportTaskDocument } from './schemas/dl_export_task.schema';

/**
 * 导出应用服务（C-06，api-delivery §4.4）。聚合根 ExportTask 的全部写路径与
 * 渲染回调状态机推进集中在本类（v1 ExportServiceImpl 平移；仓储契约「提交/
 * 终态幂等更新/分页」由 ExportTaskRepository 承载）。
 *
 * - 状态流转全部以条件更新（exportId + 期望前置状态）承载，幂等键=exportId+
 *   前置状态，重复回调/并发取消未命中即幂等空转（api-delivery §4.2「渲染回调幂等」）
 * - 终态（SUCCEEDED/FAILED/CANCELLED）条件更新命中后经 ExportEventPublisher 发布
 *   deliver_export_finished（NR-07：单文档条件更新自动提交，提交后发布；
 *   未命中的幂等空转不发布）
 * - INV-14 提交时锚定 Deck.final_version_id；INV-15 SUCCEEDED ⇔ file_key 非空
 *   （回调缺 fileKey 按集成缺陷抛错，网关兜底转 FAILED）
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly repository: ExportTaskRepository,
    private readonly deckDomainService: DeckDomainService,
    private readonly artifactStorage: ExportArtifactStorageService,
    private readonly downloadTicketService: ExportDownloadTicketService,
    private readonly eventPublisher: ExportEventPublisher,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ------------------------------------------------------------------
  // 发起导出（FINALIZED 守卫 + PPTX beta confirm + INV-14 锚定；ADR-015：创建意图，客户端渲染）
  // ------------------------------------------------------------------

  /** 1. 发起导出：D2 守卫链 → PPTX confirm → 版本快照 → insert(QUEUED) → 异步渲染 */
  async submit(ao: ExportSubmitAO, userId: string): Promise<ExportSubmitVO> {
    const format = this.parseFormat(ao.exportFormat);

    // D2 守卫链：存在 → 属主 → FINALIZED（deck 域契约，deck 域错误码透传）
    const { deckId, finalVersionId } = await this.deckDomainService.assertFinalized(
      ao.deckId,
      userId,
    );

    // PPTX beta：未 confirm → 提示态回执（不创建任务；api-delivery §3.4/§4.4，
    // 功能核查 F05：原抛 BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP 违反契约）
    if (format === ExportFormat.PPTX && ao.confirm !== true) {
      this.logger.log(`PPTX 导出触发 beta 确认提示 deckId=${ao.deckId}（未创建任务）`);
      return ExportSubmitVO.confirmPrompt();
    }

    // INV-14：版本锚定 finalVersionId（FINALIZED 必有值 INV-2，防御性校验快照可用）
    if (isBlank(finalVersionId)) {
      throw new BizException(EXPORT_NOT_FINALIZED, '定稿版本缺失，无法导出');
    }
    const versionRefs = await this.repository.findVersionRefs([finalVersionId]);
    const versionRef = versionRefs.get(finalVersionId);
    if (versionRef == null || versionRef.deckId !== deckId) {
      throw new BizException(EXPORT_NOT_FINALIZED, '定稿版本快照缺失，无法导出');
    }

    const now = new Date();
    const task = new ExportTask();
    task.deck_id = deckId;
    task.version_id = finalVersionId;
    task.export_format = format;
    task.export_status = ExportStatus.QUEUED;
    task.file_key = null;
    task.file_size = null;
    task.error_msg = null;
    task.user_id = userId;
    task.created_by = userId;
    task.created_name = userId;
    task.created_time = now;
    task.updated_by = userId;
    task.updated_name = userId;
    task.updated_time = now;
    task.data_version = 0;
    task.delete_sign = DeleteSign.NOT_DELETED;
    // EX 取号 MAX+1 须在事务内（与插入同事务收窄并发窗口，deck 域同模式）
    await this.connection.transaction(async (session) => {
      const prefix = ExportService.todayCodePrefix();
      task.export_id = nextId();
      task.export_code = ExportService.buildNextExportCode(
        prefix,
        await this.repository.findMaxExportCode(prefix, session),
      );
      await this.repository.insert(task, session);
    });

    // ADR-015：渲染在客户端执行（api-delivery v1.3）——本接口创建导出意图（QUEUED）
    // 即返回；客户端本地渲染后经 upload（SUCCEEDED）/fail（FAILED）回传结果。
    this.logger.log(
      `导出意图已创建 exportId=${task.export_id} format=${format}（客户端渲染）`,
    );
    return ExportSubmitVO.of(task.export_id, task.export_status, format === ExportFormat.PPTX);
  }

  // ------------------------------------------------------------------
  // 导出记录分页（deckName/versionSeq 冗余 + operList）
  // ------------------------------------------------------------------

  /** 2. 导出记录列表：分页/按 deck/格式/状态/时间窗筛，行含 operList */
  async listPage(ao: ExportListAO, userId: string): Promise<PageResult<ExportListVO>> {
    const { records, total } = await this.repository.pageList({
      userId,
      deckId: ao.deckId,
      exportFormat: ao.exportFormat,
      exportStatus: ao.exportStatus,
      createdTimeStart: parseTimeRangeBound(ao.createdTimeStart, 'start'),
      createdTimeEnd: parseTimeRangeBound(ao.createdTimeEnd, 'end'),
      pageNum: ao.pageNum,
      pageSize: ao.pageSize,
    });
    if (records.length === 0) {
      return PageResult.of([], total, ao.pageNum, ao.pageSize);
    }
    // 冗余批量装配（deliver 域只读直查 dl_deck / dl_deck_version，ADR-006 单库）
    const [deckRefs, versionRefs] = await Promise.all([
      this.repository.findDeckRefs([...new Set(records.map((task) => task.deck_id))]),
      this.repository.findVersionRefs([...new Set(records.map((task) => task.version_id))]),
    ]);
    const vos = records.map((task) =>
      ExportListVO.of(
        task,
        deckRefs.get(task.deck_id)?.deckName ?? null,
        versionRefs.get(task.version_id)?.versionSeq ?? null,
        resolveExportOperList(task.export_status, task.created_by ?? null, userId),
      ),
    );
    return PageResult.of(vos, total, ao.pageNum, ao.pageSize);
  }

  // ------------------------------------------------------------------
  // 取消（[用户操作] QUEUED → CANCELLED（RENDERING 兼容历史）；终态幂等返回）
  // ------------------------------------------------------------------

  /** 3. 导出取消：条件更新未命中（并发终态/重复取消）= 幂等空转不报错 */
  async cancel(ao: ExportCancelAO, userId: string): Promise<void> {
    const task = await this.loadOwnedTask(ao.exportId, userId);
    if (ExportStatusFlow.isTerminal(task.export_status)) {
      // 幂等：operList 仅 QUEUED/RENDERING 暴露 cancel；并发终态/重复取消不报错
      this.logger.log(
        `导出任务已终态，取消幂等返回 exportId=${task.export_id} status=${task.export_status}`,
      );
      return;
    }
    const updated = await this.repository.conditionalTransition({
      exportId: task.export_id,
      fromStatuses: [ExportStatus.QUEUED, ExportStatus.RENDERING],
      toStatus: ExportStatus.CANCELLED,
      operatorId: userId,
    });
    if (updated === null) {
      // 并发：已被渲染回调推进终态或已被取消 → 幂等空转（不发布事件）
      this.logger.log(`导出取消条件更新未命中（并发终态），幂等返回 exportId=${task.export_id}`);
      return;
    }
    this.eventPublisher.publishFinished(updated);
  }

  // ------------------------------------------------------------------
  // 下载凭证签发 / 产物下载（SUCCEEDED + INV-15 + HMAC 凭证）
  // ------------------------------------------------------------------

  /** 4. 换取下载凭证：SUCCEEDED + 属主 → url + expiresIn（HMAC，30min） */
  async downloadTicket(ao: ExportDownloadTicketAO, userId: string): Promise<ExportDownloadTicketVO> {
    const task = await this.loadOwnedTask(ao.exportId, userId);
    this.assertDownloadable(task);
    const token = this.downloadTicketService.issue(task.export_id, userId);
    return ExportDownloadTicketVO.of(
      task.export_id,
      this.downloadTicketService.buildDownloadUrl(task.export_id, token),
      this.downloadTicketService.ttl(),
    );
  }

  /**
   * 5. 产物下载（GET，@Public 无会话依赖）：凭证即属主证明
   * （签名绑定 exportId+userId+exp，api-delivery §3.3；签发时已完成 SUCCEEDED+属主校验）。
   */
  async download(exportId: string, token: string): Promise<ExportArtifactVO> {
    // NR-04：id 格式校验后再查询（GET 入参；非白名单格式按参数缺失拒绝）
    if (isBlank(exportId) || isBlank(token) || !ID_PATTERN.test(exportId)) {
      throw new BizException(EXPORT_NOT_DOWNLOADABLE, '下载参数缺失');
    }
    const task = await this.repository.findById(exportId);
    if (task == null) {
      throw new BizException(EXPORT_NOT_DOWNLOADABLE, '导出任务不存在');
    }
    if (!this.downloadTicketService.verify(exportId, task.user_id, token)) {
      throw new BizException(EXPORT_NOT_DOWNLOADABLE, '下载凭证无效或已过期');
    }
    this.assertDownloadable(task);
    const bytes = await this.artifactStorage.load(task.file_key ?? '');
    if (bytes == null || bytes.length === 0) {
      throw new BizException(EXPORT_NOT_DOWNLOADABLE, '导出产物文件缺失');
    }
    return ExportArtifactVO.of(
      await this.buildFileName(task),
      contentTypeOfFormat(task.export_format),
      bytes,
    );
  }

  // ------------------------------------------------------------------
  // 产物接收（ADR-015 客户端渲染：upload→SUCCEEDED / fail→FAILED；幂等条件更新）
  // ------------------------------------------------------------------

  /**
   * 客户端渲染产物回传（api-delivery v1.3：POST /deliver/export/upload）。
   * 校验链：属主 → QUEUED 前置 → 格式魔数 → 大小上限；通过后落盘（产物存储
   * 白名单 key）→ 条件推进 SUCCEEDED（INV-15：file_key 必有）+ 终态事件。
   *
   * @throws BizException BIZ_EXPORT_UPLOAD_INVALID（前置状态/魔数/大小不合法）
   */
  async uploadArtifact(
    exportId: string,
    file: UploadedExportArtifact,
    userId: string,
  ): Promise<ExportSubmitVO> {
    if (isBlank(exportId) || !ID_PATTERN.test(exportId)) {
      throw new BizException(EXPORT_UPLOAD_INVALID, '导出任务 ID 非法');
    }
    if (file == null || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BizException(EXPORT_UPLOAD_INVALID, '缺少产物文件');
    }
    if (file.buffer.length > exportArtifactMaxBytes()) {
      throw new BizException(EXPORT_UPLOAD_INVALID, '产物超过大小上限');
    }
    const task = await this.loadOwnedTask(exportId, userId);
    if (task.export_status !== ExportStatus.QUEUED) {
      throw new BizException(
        EXPORT_UPLOAD_INVALID,
        `任务当前状态[${task.export_status}]不可回传产物`,
      );
    }
    this.assertArtifactMagic(task.export_format, file.buffer);

    const extension = extensionOfFormat(task.export_format);
    const fileKey = await this.artifactStorage.store(userId, task.export_id, extension, file.buffer);
    const updated = await this.repository.conditionalTransition({
      exportId: task.export_id,
      fromStatuses: [ExportStatus.QUEUED],
      toStatus: ExportStatus.SUCCEEDED,
      setFields: { file_key: fileKey, file_size: file.buffer.length, error_msg: null },
      operatorId: userId,
    });
    if (updated === null) {
      // 并发：已被取消/已回传（重复上传）→ 按不合法拒绝（幂等语义由状态机守卫）
      throw new BizException(EXPORT_UPLOAD_INVALID, '任务已离开 QUEUED，产物回传未生效');
    }
    this.eventPublisher.publishFinished(updated);
    this.logger.log(
      `导出产物已回传并落账 exportId=${task.export_id} format=${task.export_format}` +
        ` size=${file.buffer.length}`,
    );
    return ExportSubmitVO.of(task.export_id, updated.export_status, false);
  }

  /**
   * 客户端渲染失败上报（api-delivery v1.3：POST /deliver/export/fail）。
   * QUEUED→FAILED（error_msg 截断 512）；重复/取消竞态=幂等空转返回。
   */
  async reportFailure(ao: ExportFailAO, userId: string): Promise<void> {
    this.requireUserId(userId);
    const task = await this.loadOwnedTask(ao.exportId, userId);
    if (ExportStatusFlow.isTerminal(task.export_status)) {
      this.logger.log(
        `导出失败上报忽略：任务已终态 exportId=${task.export_id} status=${task.export_status}`,
      );
      return;
    }
    const truncated =
      ao.errorMsg == null || ao.errorMsg.length === 0
        ? null
        : ao.errorMsg.length <= ERROR_MSG_MAX_LENGTH
          ? ao.errorMsg
          : ao.errorMsg.slice(0, ERROR_MSG_MAX_LENGTH);
    const updated = await this.repository.conditionalTransition({
      exportId: task.export_id,
      fromStatuses: [ExportStatus.QUEUED],
      toStatus: ExportStatus.FAILED,
      setFields: { error_msg: truncated },
      operatorId: userId,
    });
    if (updated === null) {
      this.logger.log(`导出失败上报未生效（并发终态），幂等返回 exportId=${task.export_id}`);
      return;
    }
    this.eventPublisher.publishFinished(updated);
    this.logger.log(`导出失败已上报 exportId=${task.export_id} error=${truncated ?? '-'}`);
  }

  /** 格式魔数白名单（api-delivery v1.3：PDF=%PDF-；PPTX/IMAGES(ZIP)=ZIP 头） */
  private assertArtifactMagic(exportFormat: string, bytes: Buffer): void {
    const isPdf = bytes.subarray(0, 5).toString('latin1').startsWith('%PDF-');
    const isZip =
      bytes.length > 3 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
    if (exportFormat === ExportFormat.PDF && !isPdf) {
      throw new BizException(EXPORT_UPLOAD_INVALID, '产物魔数与 PDF 格式不符');
    }
    if ((exportFormat === ExportFormat.IMAGES || exportFormat === ExportFormat.PPTX) && !isZip) {
      throw new BizException(EXPORT_UPLOAD_INVALID, `产物魔数与 ${exportFormat} 格式不符`);
    }
  }

  /** 会话守卫（AuthGuard 正常流程已保证；防御） */
  private requireUserId(userId: string): void {
    if (userId == null || userId.trim().length === 0) {
      throw new BizException(EXPORT_UPLOAD_INVALID, '缺少用户会话上下文');
    }
  }

  // ------------------------------------------------------------------
  // 跨域只读契约（manifest §10：deck detail withStats exportCount）
  // ------------------------------------------------------------------

  /** deck 维度成功导出数（SUCCEEDED 终态即「导出记录」） */
  async countByDeck(deckId: string, userId: string): Promise<number> {
    return this.repository.countSucceededByDeck(deckId, userId);
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  /** SUCCEEDED + file_key（INV-15）守卫；否则 BIZ_EXPORT_NOT_DOWNLOADABLE */
  private assertDownloadable(task: ExportTaskDocument): void {
    if (task.export_status !== ExportStatus.SUCCEEDED || isBlank(task.file_key ?? undefined)) {
      throw new BizException(EXPORT_NOT_DOWNLOADABLE, '产物未就绪，不可下载');
    }
  }

  /** 附件名 DL-{deck_code}-v{seq}.{ext}（deckCode/seq 冗余缺失时回退 exportCode/0，v1 对齐） */
  private async buildFileName(task: ExportTaskDocument): Promise<string> {
    const [deckRefs, versionRefs] = await Promise.all([
      this.repository.findDeckRefs([task.deck_id]),
      this.repository.findVersionRefs([task.version_id]),
    ]);
    const deckCode = deckRefs.get(task.deck_id)?.deckCode ?? null;
    const versionSeq = versionRefs.get(task.version_id)?.versionSeq ?? null;
    const base =
      'DL-' + (isBlank(deckCode) ? task.export_code : deckCode) +
      '-v' + (versionSeq ?? 0);
    return `${base}.${extensionOfFormat(task.export_format)}`;
  }

  /** 格式解析（AO @IsIn 已拦值域；此处兜底，v1 parseFormat 对齐不新增错误码） */
  private parseFormat(exportFormat: string): string {
    const values = Object.values(ExportFormat) as readonly string[];
    if (values.includes(exportFormat)) {
      return exportFormat;
    }
    throw new BizException(EXPORT_NOT_FINALIZED, `导出格式非法: ${exportFormat}`);
  }

  /** 属主加载（user_id 隔离，ADR-005/api-delivery §3.3） */
  private async loadOwnedTask(exportId: string, userId: string): Promise<ExportTaskDocument> {
    const task = await this.repository.findByIdOwned(exportId, userId);
    if (task == null) {
      throw new BizException(EXPORT_NOT_DOWNLOADABLE, '导出任务不存在');
    }
    return task;
  }

  /** 当日取号前缀：EX+yyMMdd（服务器本地时区，v1 LocalDate.now 对齐） */
  private static todayCodePrefix(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const date = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return `${EXPORT_CODE_PREFIX}${date}`;
  }

  /** MAX+1 取号：前缀下最大 export_code 的 4 位序列 +1（%04d 不足补零，溢出自然进位） */
  private static buildNextExportCode(prefix: string, maxCode: string | null): string {
    let next = 1;
    if (maxCode != null && maxCode.length > prefix.length) {
      const parsed = Number.parseInt(maxCode.slice(prefix.length), 10);
      if (Number.isInteger(parsed)) {
        next = parsed + 1;
      }
    }
    return prefix + String(next).padStart(EXPORT_CODE_SEQ_WIDTH, '0');
  }
}

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim().length === 0;
}

/** 上传产物（multer 文件最小面；deliver.controller 组装） */
export interface UploadedExportArtifact {
  buffer: Buffer;
  size?: number;
  originalname?: string;
}
