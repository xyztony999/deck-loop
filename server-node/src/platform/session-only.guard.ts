import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AUTH_SESSION_EXPIRED, BizException } from '../common/exceptions';
import type { AuthPrincipal } from '../common/auth-token-verifier';

/**
 * 仅会话守卫（06 §8.1：token 管理端点 /auth/token/* 仅会话）：
 * 全局 AuthGuard 双凭证回落后运行——个人 token 等价账号全量属主权限，
 * 但**不可自管理 token**（防泄露 token 自我续命/吊销他人凭证），
 * via='api-token' 主体一律拒绝（BIZ_AUTH_SESSION_EXPIRED，提示重新登录）。
 */
@Injectable()
export class SessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    if (request.user?.via === 'api-token') {
      throw new BizException(AUTH_SESSION_EXPIRED, '该操作仅支持会话登录，请在网站登录后管理 token');
    }
    return true;
  }
}