/**
 * platform 域错误码 —— 契约来源：api-platform.md §3.4（v1 冻结，禁增删改值）。
 * 两前缀（对应 v1 PlatformErrorCodeConstants）：BIZ_AUTH_*（账号）/ BIZ_GW_*（网关）。
 *
 * 唯一 re-export：AUTH_SESSION_EXPIRED 常量落 common/exceptions.ts（认证基础设施，
 * guard/filter/decorator 三处引用，依赖倒置避免 common→platform 反向依赖）——
 * 本文件按 api-platform §3.4 契约 re-export，其他域/本域均从此处或 common 消费，禁重复定义。
 */

/* ---------- BIZ_AUTH_*（账号，P-02） ---------- */

/** BIZ_AUTH_CREDENTIALS：邮箱或密码错误（失败 5 次锁 10 分钟） */
export const AUTH_CREDENTIALS = 'BIZ_AUTH_CREDENTIALS';
export const AUTH_CREDENTIALS_MSG = '邮箱或密码错误';

/** BIZ_AUTH_EMAIL_EXISTS：注册邮箱已存在（INV-24） */
export const AUTH_EMAIL_EXISTS = 'BIZ_AUTH_EMAIL_EXISTS';
export const AUTH_EMAIL_EXISTS_MSG = '邮箱已注册';

/** BIZ_AUTH_SESSION_EXPIRED：会话缺失/过期（唯一真源 common/exceptions.ts，此处契约 re-export） */
export { AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG } from '../common/exceptions';

/* ---------- BIZ_GW_*（AI 网关，P-01） ---------- */

/** BIZ_GW_PROVIDER_TIMEOUT：渠道调用超时 */
export const GW_PROVIDER_TIMEOUT = 'BIZ_GW_PROVIDER_TIMEOUT';
export const GW_PROVIDER_TIMEOUT_MSG = '渠道调用超时，请稍后重试';

/** BIZ_GW_PROVIDER_FAILED：渠道调用失败（适配器错误） */
export const GW_PROVIDER_FAILED = 'BIZ_GW_PROVIDER_FAILED';
export const GW_PROVIDER_FAILED_MSG = '渠道调用失败';

/** BIZ_GW_QUOTA_EXCEEDED：超出用量配额（INV-25 并发/配额约束） */
export const GW_QUOTA_EXCEEDED = 'BIZ_GW_QUOTA_EXCEEDED';
export const GW_QUOTA_EXCEEDED_MSG = '超出用量配额';
