/**
 * platform 域错误码 —— 契约来源：api-platform.md §3.4 + api-web-agent.md §3.4
 * （ADR-018 增量：BIZ_GW_* 族随 AI 网关退役；新增 BIZ_AUTH_TOKEN_INVALID）。
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

/** BIZ_AUTH_TOKEN_INVALID：个人 API token 缺头/格式错/哈希不匹配/过期/吊销统一码（防枚举，api-web-agent §3.4；唯一真源 common/exceptions.ts，此处契约 re-export） */
export { AUTH_TOKEN_INVALID, AUTH_TOKEN_INVALID_MSG } from '../common/exceptions';
