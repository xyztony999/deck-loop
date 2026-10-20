/**
 * deliver 域常量 —— 契约来源：api-delivery.md §3.4/§4.4/§4.5 + Java v1
 * DeliverMqConstants/DeliverProperties/MockExportRenderer（businessType 与
 * 错误码值冻结，禁私改；06-node-api-conventions §5 进程内事件）。
 */

/* ---------- 领域事件（businessType = deliver_export_finished，载荷 exportId/deckId/exportStatus） ---------- */

/** 导出终态：SUCCEEDED/FAILED/CANCELLED 任一终态（事务提交后发布），消费方=多端同步（P-02）/客户端通知 */
export const DELIVER_EXPORT_FINISHED = 'deliver_export_finished';

/* ---------- 规则编码（api-delivery §4.1：EX+yyMMdd+4位序列） ---------- */

export const EXPORT_CODE_PREFIX = 'EX';

/** 规则编码序列段长度（%04d 不足补零） */
export const EXPORT_CODE_SEQ_WIDTH = 4;

/* ---------- 素材 URL 签发单批上限（asset 域 OHS AssetFileUrlAO @Size(max=50) 契约） ---------- */

export const ASSET_URL_BATCH = 50;

/** 失败摘要截断（v1 DDL error_msg VARCHAR(512) 对齐） */
export const ERROR_MSG_MAX_LENGTH = 512;

/* ---------- 字典 key（v1 DeliverDictRegistry，驼峰字段名规则） ---------- */

export const DICT_KEY_EXPORT_FORMAT = 'exportFormat';
export const DICT_KEY_EXPORT_STATUS = 'exportStatus';

/* ---------- 下载（api-delivery §4.4 D3） ---------- */

/** GET 下载端点路径（download-ticket 返回 url 拼接基址） */
export const DOWNLOAD_PATH = '/deliver/export/download';

/* ---------- 产物 Content-Type / 扩展名（MockExportRenderer/ExportServiceImpl 对齐） ---------- */

export const CONTENT_TYPE_PDF = 'application/pdf';
export const CONTENT_TYPE_ZIP = 'application/zip';
export const CONTENT_TYPE_PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** 产物扩展名映射（IMAGES→zip、PPTX→pptx、其余→pdf） */
export function extensionOfFormat(exportFormat: string): string {
  if (exportFormat === 'IMAGES') {
    return 'zip';
  }
  if (exportFormat === 'PPTX') {
    return 'pptx';
  }
  return 'pdf';
}

/** 产物 Content-Type 映射（与扩展名同源） */
export function contentTypeOfFormat(exportFormat: string): string {
  if (exportFormat === 'IMAGES') {
    return CONTENT_TYPE_ZIP;
  }
  if (exportFormat === 'PPTX') {
    return CONTENT_TYPE_PPTX;
  }
  return CONTENT_TYPE_PDF;
}

/* ---------- 服务级 env（默认值对齐 v1 DeliverProperties；env 直读不引 config 包） ---------- */

/** 产物回传大小上限（MB，api-delivery v1.3：EXPORT_ARTIFACT_MAX_MB，默认 50） */
export const ENV_EXPORT_ARTIFACT_MAX_MB = 'EXPORT_ARTIFACT_MAX_MB';
export const DEFAULT_EXPORT_ARTIFACT_MAX_MB = 50;

/** 产物回传字节上限（MB→字节；multer limits 与 Service 双重校验共用） */
export function exportArtifactMaxBytes(): number {
  const raw = Number.parseInt(process.env[ENV_EXPORT_ARTIFACT_MAX_MB] ?? '', 10);
  const mb = Number.isInteger(raw) && raw > 0 && raw <= 2048 ? raw : DEFAULT_EXPORT_ARTIFACT_MAX_MB;
  return mb * 1024 * 1024;
}

/** 导出产物本地存储根目录（Mock 渲染产物落盘位置；生产替换对象存储） */
export const ENV_EXPORT_ARTIFACT_DIR = 'EXPORT_ARTIFACT_DIR';
export const DEFAULT_EXPORT_ARTIFACT_DIR = './data/exports';

/** 下载凭证 URL 公共前缀（GET /deliver/export/download 拼接基址） */
export const ENV_EXPORT_DOWNLOAD_BASE_URL = 'EXPORT_DOWNLOAD_BASE_URL';
export const DEFAULT_EXPORT_DOWNLOAD_BASE_URL = 'http://localhost:8080';

/**
 * 下载凭证 HMAC 签名密钥（生产环境必须覆盖；NR-06：仅 env，禁入库/禁进 VO/禁日志）。
 * 对应 v1 deliver.export.ticket-sign-key。
 */
export const ENV_EXPORT_SIGN_SECRET = 'EXPORT_SIGN_SECRET';
export const DEFAULT_EXPORT_SIGN_SECRET = 'deck-loop-deliver-dev-sign-key';

/** 下载凭证有效期（秒，api-delivery §4.4 D3：30min） */
export const ENV_EXPORT_TICKET_TTL_SECONDS = 'EXPORT_TICKET_TTL_SECONDS';
export const DEFAULT_EXPORT_TICKET_TTL_SECONDS = 1800;
