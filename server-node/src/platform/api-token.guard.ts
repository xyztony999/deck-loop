import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BizException } from '../common/exceptions';
import type { AuthPrincipal } from '../common/auth-token-verifier';
import { ApiTokenService } from './api-token.service';
import { AUTH_TOKEN_INVALID, AUTH_TOKEN_INVALID_MSG } from './platform.errors';

/** 请求最小结构类型（不依赖 express 类型） */
interface TokenRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthPrincipal;
}

/**
 * 个人 API token 独立守卫（api-web-agent §3.1/§4.1.4，ADR-018）：
 * agent 直写端点（/ver/version/agent-create）标 @Public() 旁路全局会话守卫后
 * 以 @UseGuards(ApiTokenGuard) 独立校验——**仅认 X-Api-Token**，网站会话不可调用。
 * 缺头/格式错/哈希不匹配/过期/吊销统一 BIZ_AUTH_TOKEN_INVALID（防枚举）。
 * 通过挂 request.user={userId, accountId, via:'api-token'}（属主隔离口径不变）。
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TokenRequest>();
    const token = request.headers?.['x-api-token'];
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new BizException(AUTH_TOKEN_INVALID, AUTH_TOKEN_INVALID_MSG);
    }
    const payload = await this.apiTokenService.verify(token);
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
}