import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PageResult, Result } from '../common/result';
import { ExportService } from './export.service';
import {
  ExportCancelAO,
  ExportDownloadTicketAO,
  ExportDownloadTicketVO,
  ExportFailAO,
  ExportListAO,
  ExportListVO,
  ExportSubmitAO,
  ExportSubmitVO,
} from './deliver.dto';
import { exportArtifactMaxBytes } from './deliver.constant';
import type { UploadedExportArtifact } from './export.service';

/**
 * 响应头设置最小结构类型（不依赖 @types/express；平台耦合零侵入，
 * platform 域 GatewayStreamController 的 CloseableRequest 同款口径）。
 */
interface HeaderSetter {
  set(field: string, value: string): unknown;
}

/**
 * 导出交付接口（api-delivery §4.4 接口清单 1-5；domain-manifest §5）。
 *
 * 个人单用户产品不建 RBAC（api-delivery §3.3）：无权限注解，业务 POST 接口=登录会话
 * + 任务级 user_id 属主隔离（@CurrentUser 服务端注入，NR-05；Service 层强制）。
 * HTTP 状态恒 200（v1 对齐：@HttpCode(OK)，异常经全局 Filter 转 Result）。
 *
 * GET /deliver/export/download（domain-manifest §0 全局 @Public 表）：
 * 文件下载 GET（栈规约：文件下载 GET，全 POST 风格的文档化例外），
 * **@Public + handler 内 HMAC 凭证自证**——凭证即属主证明（签名绑定
 * exportId+userId+exp 30min，先经 POST download-ticket 受保护换取），
 * 不得裸公开；业务异常（凭证无效/产物未就绪）经全局 Filter 转 Result JSON。
 */
@Controller('deliver/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /** 1. 发起导出：FINALIZED 守卫 + PPTX beta confirm → exportId（QUEUED） */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() ao: ExportSubmitAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<ExportSubmitVO>> {
    return Result.success(await this.exportService.submit(ao, userId));
  }

  /** 2. 导出记录列表：分页/按 deck/格式/状态/时间窗筛，行含 operList */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: ExportListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<ExportListVO>>> {
    return Result.success(await this.exportService.listPage(ao, userId));
  }

  /** 3. 导出取消：QUEUED/RENDERING → CANCELLED（终态幂等返回） */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Body() ao: ExportCancelAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.exportService.cancel(ao, userId);
    return Result.success();
  }

  /**
   * 3a. 产物回传（api-delivery v1.3：multipart file+exportId；ADR-015 客户端渲染）。
   * multer limits 与 Service 双重校验（大小）；魔数/前置状态/属主在 Service。
   */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: exportArtifactMaxBytes(), files: 1 } }),
  )
  async upload(
    @UploadedFile() file: UploadedExportArtifact | undefined,
    @Body('exportId') exportId: string | undefined,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<ExportSubmitVO>> {
    return Result.success(
      await this.exportService.uploadArtifact(exportId ?? '', file as UploadedExportArtifact, userId),
    );
  }

  /** 3b. 渲染失败上报（QUEUED→FAILED，error_msg ≤512 截断） */
  @Post('fail')
  @HttpCode(HttpStatus.OK)
  async fail(
    @Body() ao: ExportFailAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.exportService.reportFailure(ao, userId);
    return Result.success();
  }

  /** 4. 换取下载凭证：SUCCEEDED + 属主 → url + expiresIn（HMAC，30min） */
  @Post('download-ticket')
  @HttpCode(HttpStatus.OK)
  async downloadTicket(
    @Body() ao: ExportDownloadTicketAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<ExportDownloadTicketVO>> {
    return Result.success(await this.exportService.downloadTicket(ao, userId));
  }

  /**
   * 5. 产物下载（GET，@Public+凭证自证）：token 校验 + SUCCEEDED → 文件流
   * （Content-Disposition 附件 DL-{deck_code}-v{seq}.{ext}，附件名全 ASCII 安全）。
   * 凭证校验/产物加载全部在 Service（票据→属主→SUCCEEDED→INV-15 守卫链）。
   */
  @Public()
  @Header('X-Accel-Buffering', 'no')
  @Get('download')
  @HttpCode(HttpStatus.OK)
  async download(
    @Query('exportId') exportId?: string,
    @Query('token') token?: string,
    @Res({ passthrough: true }) res?: HeaderSetter,
  ): Promise<StreamableFile> {
    const artifact = await this.exportService.download(
      firstString(exportId) ?? '',
      firstString(token) ?? '',
    );
    res?.set('Content-Type', artifact.contentType);
    res?.set('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
    res?.set('Content-Length', String(artifact.bytes.length));
    return new StreamableFile(artifact.bytes);
  }
}

/** query 单值收敛（重复参数的数组形态按首值处理，其余忽略；platform 域同款） */
function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.trim().length > 0 ? first.trim() : undefined;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
