/**
 * 业务异常：code = BIZ_* 业务码（NR-09），由全局 BizExceptionFilter 转
 * Result{status:false, code:业务码, msg}（HTTP 200，v1 Advice 对齐）。
 *
 * 错误码常量集中于各域 {domain}.errors.ts（格式 {BIZ}_{OBJECT}_{ERROR}）。
 * 唯一例外：AUTH_SESSION_EXPIRED 属 common 认证基础设施（guard/filter/decorator
 * 三处引用），常量落此由 platform 域 platform.errors.ts re-export，
 * 避免 common → platform 反向依赖（依赖倒置）；其他域不得重复定义。
 */
export class BizException extends Error {
  readonly code: string;
  readonly msg: string;

  constructor(code: string, msg: string) {
    super(msg);
    this.name = 'BizException';
    this.code = code;
    this.msg = msg;
  }
}

/** v1 PlatformErrorCodeConstants.AUTH_SESSION_EXPIRED 对齐（未登录/会话过期/无 verifier 实现） */
export const AUTH_SESSION_EXPIRED = 'BIZ_AUTH_SESSION_EXPIRED';

/** v1 SessionTokenServiceImpl 会话过期提示语对齐 */
export const AUTH_SESSION_EXPIRED_MSG = '会话已过期，请重新登录';

/**
 * BIZ_AUTH_TOKEN_INVALID（api-web-agent §3.4，ADR-018）：个人 API token
 * 缺头/格式错/哈希不匹配/过期/吊销统一码（防枚举）。常量落 common 认证基础设施
 * （AuthGuard 双凭证回落 + ApiTokenGuard 两处引用），platform.errors.ts re-export。
 */
export const AUTH_TOKEN_INVALID = 'BIZ_AUTH_TOKEN_INVALID';

/** token 无效提示语（直白说清原因与出路，NR-14） */
export const AUTH_TOKEN_INVALID_MSG = 'API token 无效或已过期，请在网站设置页重新签发';
