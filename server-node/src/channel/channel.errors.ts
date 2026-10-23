/**
 * channel 域错误码 —— 契约来源：api-channel.md §3.4（v1 冻结，禁增删改值）。
 * 前缀 BIZ_CHANNEL_*（对应 v1 ChannelErrorCodeConstants）。
 * 用法：throw new BizException(CHANNEL_UNAVAILABLE, CHANNEL_UNAVAILABLE_MSG)。
 */

/** BIZ_CHANNEL_UNAVAILABLE：所填渠道/模型不在网关启用清单（INV-22）或渠道下线 */
export const CHANNEL_UNAVAILABLE = 'BIZ_CHANNEL_UNAVAILABLE';
export const CHANNEL_UNAVAILABLE_MSG = '渠道或模型不可用';

/* ---------------- 渠道管理端（channel-admin-2026-10-23 §4，增量非冻结段） ---------------- */

/** BIZ_CHANNEL_CODE_EXISTS：渠道编码已存在（唯一不变量） */
export const CHANNEL_CODE_EXISTS = 'BIZ_CHANNEL_CODE_EXISTS';
export const CHANNEL_CODE_EXISTS_MSG = '渠道编码已存在';

/** BIZ_CHANNEL_NOT_FOUND：渠道不存在 */
export const CHANNEL_NOT_FOUND = 'BIZ_CHANNEL_NOT_FOUND';
export const CHANNEL_NOT_FOUND_MSG = '渠道不存在';

/** BIZ_CHANNEL_BUILTIN_READONLY：内置渠道只读（不可编辑，仅可启停） */
export const CHANNEL_BUILTIN_READONLY = 'BIZ_CHANNEL_BUILTIN_READONLY';
export const CHANNEL_BUILTIN_READONLY_MSG = '内置渠道只读';

/** BIZ_CHANNEL_NEEDS_ENABLED_MODEL：启用渠道须含至少一个启用模型 */
export const CHANNEL_NEEDS_ENABLED_MODEL = 'BIZ_CHANNEL_NEEDS_ENABLED_MODEL';
export const CHANNEL_NEEDS_ENABLED_MODEL_MSG = '启用渠道须至少保留一个启用模型';

/** BIZ_CHANNEL_KEY_MISSING：新建渠道未提供密钥（apiKey 与 apiKeyEnv 二选一） */
export const CHANNEL_KEY_MISSING = 'BIZ_CHANNEL_KEY_MISSING';
export const CHANNEL_KEY_MISSING_MSG = '请提供 API Key 或环境变量引用';
