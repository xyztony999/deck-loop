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
  BizException,
} from '../exceptions';
import {
  AUTH_TOKEN_VERIFIER,
  AuthPrincipal,
  AuthTokenVerifier,
} from '../auth-token-verifier';

/** @Public() 元数据键 */
export const IS_PUBLIC_KEY = 'deckLoop:isPublic';

/**
 * 公开端点装饰器（方法或 Controller 类级）：登录/注册/SSE/下载票据等端点跳过认证。
 * 用法：`@Public()` + `@Post('login')`。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 请求最小结构类型（不依赖 express 类型） */
interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthPrincipal;
}

/**
 * 全局认证守卫（APP_GUARD 注册）：
 * - 读 `X-Auth-Token` 请求头，经 AuthTokenVerifier（platform 域 provide）校验
 * - 未实现 verifier / 缺头 / 校验失败 → BizException(BIZ_AUTH_SESSION_EXPIRED)
 * - 通过后挂 request.user = {userId, accountId}（@CurrentUser() 取用）
 * - @Public() 装饰的 handler/class 跳过
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(AUTH_TOKEN_VERIFIER)
    private readonly tokenVerifier: AuthTokenVerifier | null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers?.['x-auth-token'];

    if (typeof token !== 'string' || token.trim().length === 0 || this.tokenVerifier === null) {
      throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
    }

    const payload = this.tokenVerifier.verify(token);
    if (payload === null) {
      throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
    }

    request.user = { userId: payload.userId, accountId: payload.accountId ?? null };
    return true;
  }
}
