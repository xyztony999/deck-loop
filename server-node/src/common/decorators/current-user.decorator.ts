import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG, BizException } from '../exceptions';
import type { AuthPrincipal } from '../auth-token-verifier';

/**
 * 当前登录用户参数装饰器（从 request.user 取，由 AuthGuard 写入）：
 * - `@CurrentUser() user: AuthPrincipal` → 整体主体
 * - `@CurrentUser('userId') userId: string` → 单属性
 *
 * 隔离字段（userId）以本装饰器服务端注入为准，永不取信客户端入参（NR-05）。
 */
export const CurrentUser = createParamDecorator(
  (
    property: keyof AuthPrincipal | undefined,
    ctx: ExecutionContext,
  ): AuthPrincipal | AuthPrincipal[keyof AuthPrincipal] => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;
    if (user === undefined) {
      // 正常流程 AuthGuard 先行写入；兜底防御
      throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
    }
    return property === undefined ? user : user[property];
  },
);
