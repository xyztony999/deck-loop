/**
 * deliver 域错误码 —— 契约来源：api-delivery.md §3.4（v1 冻结，禁增删改值）。
 * 前缀 BIZ_EXPORT_*（对应 v1 DeliveryErrorCodeConstants）。
 * 「仅 FINALIZED 可导出/演示」守卫错误码复用 deck 域 DECK_STATUS_FORBIDDEN
 * （api-delivery §3.2 明示 BIZ_DECK_STATUS_FORBIDDEN）——import '../deck/deck.errors'，勿重复定义。
 * 用法：throw new BizException(EXPORT_NOT_FINALIZED, EXPORT_NOT_FINALIZED_MSG)。
 */

/** BIZ_EXPORT_NOT_FINALIZED：创作物未定稿，不可发起导出 */
export const EXPORT_NOT_FINALIZED = 'BIZ_EXPORT_NOT_FINALIZED';
export const EXPORT_NOT_FINALIZED_MSG = '仅定稿版本可导出';

/** BIZ_EXPORT_NOT_DOWNLOADABLE：导出任务非 SUCCEEDED 或凭证/属主校验失败，不可下载 */
export const EXPORT_NOT_DOWNLOADABLE = 'BIZ_EXPORT_NOT_DOWNLOADABLE';
export const EXPORT_NOT_DOWNLOADABLE_MSG = '导出产物不可下载';

/** BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP：PPTX 导出为 beta 能力（needConfirm 提示） */
export const EXPORT_PPTX_UNSUPPORTED_TEMP = 'BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP';
export const EXPORT_PPTX_UNSUPPORTED_TEMP_MSG = 'PPTX 导出暂为 beta 功能，请确认后重试';

/**
 * BIZ_EXPORT_UPLOAD_INVALID：产物回传不合法（api-delivery v1.3 增量，ADR-015 客户端渲染）。
 * 命中：任务非 QUEUED 前置 / 格式魔数不符 / 大小超限。
 */
export const EXPORT_UPLOAD_INVALID = 'BIZ_EXPORT_UPLOAD_INVALID';
export const EXPORT_UPLOAD_INVALID_MSG = '导出产物回传不合法';
