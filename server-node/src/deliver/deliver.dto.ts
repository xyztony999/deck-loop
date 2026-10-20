import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ExportFormat,
  ExportStatus,
  getExportFormatLabel,
  getExportStatusLabel,
} from '../common/enums';
import { OperItem, PageQuery, SelectOption } from '../common/result';
import type { ExportTaskDocument } from './schemas/dl_export_task.schema';

/**
 * deliver 域 AO/VO（api-delivery §4.4 契约冻结平移；v1 ao/vo/deliver 包逐字对齐）。
 *
 * - AO：class-validator 校验（NR-04：id 格式/枚举值域；whitelist 管道剥未知字段）
 * - VO：_id 不进 VO（NR-08）；*Name 标签冗余与 *Str 时间格式化随 VO 组装
 *   （v1 setting() 语义）
 */

/** id 入参格式（NR-04：长度≤32、[A-Za-z0-9_-]；与 deck/version 域同口径；
 *  ExportService#download GET 查询前校验复用） */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 时间入参格式：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss（前端 timeRange 拆分） */
const TIME_RANGE_PATTERN = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/** 空串→undefined（可选字段「空=未提供」语义，v1 isBlank 口径） */
const blankToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

/** Date → 'yyyy-MM-dd HH:mm:ss'（本地时区，v1 DATE_TIME_FORMATTER 对齐） */
export function formatDateTime(date: Date | null | undefined): string | null {
  if (date == null) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * timeRange 解析：date-only 时 start 补 00:00:00 / end 补 23:59:59.999（闭区间）；
 * 格式在 DTO Matches 已拦截，此处仅做形状解析（deck 域同款）。
 */
export function parseTimeRangeBound(
  value: string | null | undefined,
  boundary: 'start' | 'end',
): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const full = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(full)) {
    return new Date(`${full}T${boundary === 'start' ? '00:00:00' : '23:59:59.999'}`);
  }
  return new Date(full.replace(' ', 'T'));
}

/* ------------------------------------------------------------------ */
/* AO — 导出任务                                                        */
/* ------------------------------------------------------------------ */

/** 发起导出 AO（POST /deliver/export/submit；PPTX beta 需 confirm=true 受理） */
export class ExportSubmitAO {
  /** 归属创作物（须 FINALIZED，D2 守卫） */
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;

  /** 导出格式：ExportFormat code（PDF/IMAGES/PPTX；PPTX beta 需 confirm） */
  @IsString({ message: 'exportFormat不能为空' })
  @IsIn(Object.values(ExportFormat), { message: '导出格式仅支持 PDF/IMAGES/PPTX' })
  exportFormat!: string;

  /** PPTX beta 二次确认（api-delivery §4.4：confirm 才受理，否则 BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP） */
  @IsOptional()
  @IsBoolean()
  confirm: boolean = false;
}

/** 导出记录列表查询 AO（POST /deliver/export/list；分页/按 deck/格式/状态/时间窗） */
export class ExportListAO extends PageQuery {
  /** 页码（重声明补校验注解；declare 不重置父类默认值 1/20） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'pageNum必须为正整数' })
  declare pageNum: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'pageSize必须为正整数' })
  declare pageSize: number;

  /** 归属创作物精确匹配（null=全部） */
  @IsOptional()
  @Transform(blankToUndefined)
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId?: string;

  /** 导出格式精确匹配（ExportFormat code） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(ExportFormat), { message: 'exportFormat值不合法' })
  exportFormat?: string;

  /** 导出状态精确匹配（ExportStatus code） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(ExportStatus), { message: 'exportStatus值不合法' })
  exportStatus?: string;

  /** 创建时间起（yyyy-MM-dd HH:mm:ss，前端 timeRange 拆分） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Matches(TIME_RANGE_PATTERN, {
    message: 'createdTimeStart格式须为yyyy-MM-dd或yyyy-MM-dd HH:mm:ss',
  })
  createdTimeStart?: string;

  /** 创建时间止 */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Matches(TIME_RANGE_PATTERN, {
    message: 'createdTimeEnd格式须为yyyy-MM-dd或yyyy-MM-dd HH:mm:ss',
  })
  createdTimeEnd?: string;
}

/** 导出取消 AO（POST /deliver/export/cancel；QUEUED/RENDERING 可取消，终态幂等返回） */
export class ExportCancelAO {
  @IsString({ message: 'exportId不能为空' })
  @Matches(ID_PATTERN, { message: 'exportId格式不合法' })
  exportId!: string;
}

/** 渲染失败上报 AO（api-delivery v1.3：POST /deliver/export/fail，ADR-015 客户端渲染） */
export class ExportFailAO {
  /** 导出任务 ID */
  @IsString()
  @Matches(ID_PATTERN, { message: 'exportId 格式非法' })
  exportId!: string;

  /** 失败摘要（≤512 截断；可空） */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  errorMsg?: string;
}

/** 下载凭证签发 AO（POST /deliver/export/download-ticket；须 SUCCEEDED 且属主一致） */
export class ExportDownloadTicketAO {
  @IsString({ message: 'exportId不能为空' })
  @Matches(ID_PATTERN, { message: 'exportId格式不合法' })
  exportId!: string;
}

/* ------------------------------------------------------------------ */
/* AO — 演示放映 / 字典                                                 */
/* ------------------------------------------------------------------ */

/** 演示数据查询 AO（POST /deliver/present/data；FINALIZED 守卫，锚定 finalVersionId） */
export class PresentDataAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;
}

/** deliver 域枚举字典批量查询 AO（POST /deliver/dict/batch；key=exportFormat/exportStatus） */
export class DeliverDictBatchAO {
  @IsArray()
  @ArrayNotEmpty({ message: 'keys不能为空' })
  @IsString({ each: true })
  keys!: string[];
}

/* ------------------------------------------------------------------ */
/* VO — 发起 / 列表 / 凭证                                              */
/* ------------------------------------------------------------------ */

/** 发起导出结果 VO（POST /deliver/export/submit；PPTX 响应 needConfirm=true beta 提示） */
export class ExportSubmitVO {
  /** 导出任务 ID */
  exportId!: string;
  /** 受理状态（受理即 QUEUED；后续经 list/同步拉取观察推进） */
  exportStatus!: string;
  /** 是否 beta 需确认格式（PPTX=true；客户端据此展示 beta 标识） */
  needConfirm!: boolean;

  static of(exportId: string, exportStatus: string, needConfirm: boolean): ExportSubmitVO {
    const vo = new ExportSubmitVO();
    vo.exportId = exportId;
    vo.exportStatus = exportStatus;
    vo.needConfirm = needConfirm;
    return vo;
  }

  /**
   * PPTX beta 提示态（api-delivery §4.4：PPTX 响应 needConfirm=true，confirm 才受理）：
   * 不创建任务，exportId 空串（客户端据此弹二次确认，取消则无任务产生）。
   * 对齐 adjustment 域 AdjustSubmitVO.forkPrompt 先例（功能核查 F05：原实现抛
   * BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP 违反契约——客户端确认闭环无法走通）。
   */
  static confirmPrompt(): ExportSubmitVO {
    const vo = new ExportSubmitVO();
    vo.exportId = '';
    vo.exportStatus = 'QUEUED';
    vo.needConfirm = true;
    return vo;
  }
}

/**
 * 导出记录列表行 VO（api-delivery §4.4 行字段清单；operList 由 Service 经
 * ExportOperResolver 注入：download=SUCCEEDED；cancel=QUEUED/RENDERING；
 * retry=FAILED——retry 无独立端点，客户端经 submit 重新发起）。
 */
export class ExportListVO {
  exportId!: string;
  exportCode!: string;
  deckId!: string;
  /** deckName 冗余（deliver 域只读直查 dl_deck） */
  deckName!: string | null;
  versionId!: string;
  /** versionSeq 冗余（dl_deck_version 只读投影） */
  versionSeq!: number | null;
  exportFormat!: string;
  /** exportFormat 中文标签（v1 exportFormatName） */
  exportFormatName!: string;
  exportStatus!: string;
  /** exportStatus 中文标签（v1 exportStatusName） */
  exportStatusName!: string;
  /** 产物大小（字节；未成功为 null） */
  fileSize!: number | null;
  /** 失败摘要（FAILED 终态） */
  errorMsg!: string | null;
  /** 属主判断必需（OperResolver isOwner） */
  createdBy!: string | null;
  createdTime!: Date | null;
  createdTimeStr!: string | null;
  /** 操作列（Service 注入，禁止手动 set） */
  operList: OperItem[] = [];

  static of(
    task: ExportTaskDocument,
    deckName: string | null,
    versionSeq: number | null,
    operList: OperItem[],
  ): ExportListVO {
    const vo = new ExportListVO();
    vo.exportId = task.export_id;
    vo.exportCode = task.export_code;
    vo.deckId = task.deck_id;
    vo.deckName = deckName;
    vo.versionId = task.version_id;
    vo.versionSeq = versionSeq;
    vo.exportFormat = task.export_format;
    vo.exportFormatName = getExportFormatLabel(task.export_format);
    vo.exportStatus = task.export_status;
    vo.exportStatusName = getExportStatusLabel(task.export_status);
    vo.fileSize = task.file_size ?? null;
    vo.errorMsg = task.error_msg ?? null;
    vo.createdBy = task.created_by ?? null;
    vo.createdTime = task.created_time ?? null;
    vo.createdTimeStr = formatDateTime(task.created_time);
    vo.operList = operList;
    return vo;
  }
}

/** 下载凭证签发结果 VO（POST /deliver/export/download-ticket；url + expiresIn 30min） */
export class ExportDownloadTicketVO {
  exportId!: string;
  /** 限时下载 URL（GET /deliver/export/download?exportId=...&token=...） */
  url!: string;
  /** 凭证有效期（秒，默认 1800） */
  expiresIn!: number;

  static of(exportId: string, url: string, expiresIn: number): ExportDownloadTicketVO {
    const vo = new ExportDownloadTicketVO();
    vo.exportId = exportId;
    vo.url = url;
    vo.expiresIn = expiresIn;
    return vo;
  }
}

/** 导出产物载体（GET /deliver/export/download 内部返回值，进程内值对象不序列化）：
 *  Controller 据此构建文件流响应（Content-Disposition 附件 DL-{deck_code}-v{seq}.{ext}） */
export class ExportArtifactVO {
  /** 附件文件名 */
  fileName!: string;
  /** Content-Type */
  contentType!: string;
  /** 产物字节 */
  bytes!: Buffer;

  static of(fileName: string, contentType: string, bytes: Buffer): ExportArtifactVO {
    const vo = new ExportArtifactVO();
    vo.fileName = fileName;
    vo.contentType = contentType;
    vo.bytes = bytes;
    return vo;
  }
}

/* ------------------------------------------------------------------ */
/* VO — 演示放映                                                        */
/* ------------------------------------------------------------------ */

/**
 * 演示放映数据 VO（POST /deliver/present/data；deckName、finalVersionSeq、
 * pages[{pageId,index,title,note,blocks[...]}]）。组装自 finalVersionId.content 快照
 * + 演讲者备注（pages[].note），图片块注入素材限时 URL（asset 域 OHS），
 * 渲染就绪结构供演示模式全屏消费；blocks 结构与 api-version §4.1 content 契约一致
 * （blockType：TEXT|IMAGE|PLACEHOLDER）。
 */
export class PresentDataVO {
  deckId!: string;
  deckName!: string;
  /** 定稿版本谱系序号 */
  finalVersionSeq!: number | null;
  pages: PresentPageVO[] = [];

  static of(
    deckId: string,
    deckName: string,
    finalVersionSeq: number | null,
    pages: PresentPageVO[],
  ): PresentDataVO {
    const vo = new PresentDataVO();
    vo.deckId = deckId;
    vo.deckName = deckName;
    vo.finalVersionSeq = finalVersionSeq;
    vo.pages = pages;
    return vo;
  }
}

/** 页（渲染就绪结构；index 1 起） */
export class PresentPageVO {
  pageId!: string | null;
  /** 页序（1 起） */
  index!: number;
  title!: string | null;
  /** 演讲者备注 */
  note!: string | null;
  blocks: PresentBlockVO[] = [];
}

/** 块（content 契约值对象透传 + 素材 URL 注入） */
export class PresentBlockVO {
  blockId!: string | null;
  /** TEXT/IMAGE/PLACEHOLDER（api-version §4.1，未入枚举池的值对象字符串） */
  blockType!: string | null;
  text!: string | null;
  /** 图片块素材引用 */
  assetId!: string | null;
  /** 图片块素材限时 URL（签发未命中为 null；演示端按 URL 渲染） */
  assetFileUrl!: string | null;
  /** 样式（契约透传，object 结构） */
  style!: Record<string, unknown> | null;
}

/** 字典批量返回 VO（Record 而非 Map——JSON 序列化安全，v1 Map→Jackson 对齐） */
export type DeliverDictBatchVO = Record<string, SelectOption[]>;
