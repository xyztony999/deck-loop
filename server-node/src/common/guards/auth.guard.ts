import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTH_SESSION_EXPIRED,
  AUTH_SESSION_EXPIRED_MSG,
  AUTH_TOKEN_INVALID,
  AUTH_TOKEN_INVALID_MSG,
  BizException,
} from '../exceptions';
import {
  API_TOKEN_VERIFIER,
  AUTH_TOKEN_VERIFIER,
  ApiTokenVerifier,
  AuthPrincipal,
  AuthTokenVerifier,
} from '../auth-token-verifier';

/** @Public() 元数据键 */
export const IS_PUBLIC_KEY = 'deckLoop:isPublic';

/**
 * 公开端点装饰器（方法或 Controller 类级）：登录/注册/下载等端点跳过认证。
 * 用法：`@Public()` + `@Post('login')`。
 * agent-create 亦标 @Public() 旁路会话守卫，另挂 ApiTokenGuard（仅认个人 token）。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 请求最小结构类型（不依赖 express 类型） */
interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthPrincipal;
}

/**
 * 全局认证守卫（APP_GUARD 注册；06 §8.1 双凭证鉴权，ADR-018）：
 * - 有 `X-Auth-Token` → 会话校验（SessionTokenService，现状不变）；
 * - 无会话头且有 `X-Api-Token` → 委托 ApiTokenVerifier（独立 ApiTokenService，
 *   查库+哈希恒时比较+过期/吊销判定+last_used_at 节流）；
 * - 两者皆无 → BizException(BIZ_AUTH_SESSION_EXPIRED)；
 * - 个人 token 校验失败 → BizException(BIZ_AUTH_TOKEN_INVALID)（防枚举统一码）；
 * - 通过后挂 request.user = {userId, accountId[, via:'api-token']}（@CurrentUser() 取用）；
 *   属主隔离（ADR-005）口径不变——userId 注入后所有查询/写入强制携带。
 * - @Public() 装饰的 handler/class 跳过。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(AUTH_TOKEN_VERIFIER)
    private readonly tokenVerifier: AuthTokenVerifier | null,
    @Optional()
    @Inject(API_TOKEN_VERIFIER)
    private readonly apiTokenVerifier: ApiTokenVerifier | null = null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionToken = request.headers?.['x-auth-token'];

    // 会话优先（网站消费，现状不变）
    if (typeof sessionToken === 'string' && sessionToken.trim().length > 0) {
      if (this.tokenVerifier === null) {
        throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
      }
      const payload = this.tokenVerifier.verify(sessionToken);
      if (payload === null) {
        throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
      }
      request.user = { userId: payload.userId, accountId: payload.accountId ?? null };
      return true;
    }

    // 无会话头 → 个人 API token 回落（MCP 远程消费）
    const apiToken = request.headers?.['x-api-token'];
    if (
      typeof apiToken === 'string' &&
      apiToken.trim().length > 0 &&
      this.apiTokenVerifier !== null
    ) {
      const payload = await this.apiTokenVerifier.verify(apiToken);
      if (payload === null) {
        throw new BizException(AUTH_TOKEN_INVALID, AUTH_TOKEN_INVALID_MSG);
      }
      request.user = {
        userId: payload.userId,
        accountId: payload.accountId ?? null,
        via: 'api-token',
      };
      return true;
    }

    throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
  }
}