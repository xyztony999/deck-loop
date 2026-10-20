/**
 * channel 域错误码 —— 契约来源：api-channel.md §3.4（v1 冻结，禁增删改值）。
 * 前缀 BIZ_CHANNEL_*（对应 v1 ChannelErrorCodeConstants）。
 * 用法：throw new BizException(CHANNEL_UNAVAILABLE, CHANNEL_UNAVAILABLE_MSG)。
 */

/** BIZ_CHANNEL_UNAVAILABLE：所填渠道/模型不在网关启用清单（INV-22）或渠道下线 */
export const CHANNEL_UNAVAILABLE = 'BIZ_CHANNEL_UNAVAILABLE';
export const CHANNEL_UNAVAILABLE_MSG = '渠道或模型不可用';
