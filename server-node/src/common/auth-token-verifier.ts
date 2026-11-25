/**
 * 认证 token 校验契约（依赖倒置）：
 * - common 的 AuthGuard 依赖本接口，不依赖 platform 实现
 * - platform 域实现并 `provide: AUTH_TOKEN_VERIFIER, useClass: <impl>`
 *   （如 SessionTokenService：HMAC 自包含 token + 撤销表）
 */

/** token 载荷：userId 必有；accountId 可选（platform 实现可扩展透出，无则为 null） */
export interface AuthTokenPayload {
  userId: string;
  accountId?: string;
}

/** 认证主体：AuthGuard 校验通过后挂到 request.user，@CurrentUser() 取用 */
export interface AuthPrincipal {
  userId: string;
  accountId: string | null;
  /** 凭证通道（ADR-018 双凭证）：个人 token 路径挂 'api-token'；会话路径缺省（现状不变） */
  via?: 'api-token';
}

/** verifier 接口：token 无效/过期/撤销时返回 null */
export interface AuthTokenVerifier {
  verify(token: string): AuthTokenPayload | null;
}

/** DI token（字符串 token，跨模块 provide/useClass 直接引用） */
export const AUTH_TOKEN_VERIFIER = 'AUTH_TOKEN_VERIFIER';

/**
 * 个人 API token 校验契约（ADR-018，06 §8.1 双凭证回落）：
 * 独立于会话 AuthTokenVerifier——查库校验（SHA-256 哈希查找+恒时比较+
 * expires_at/revoked_at 判定+last_used_at 节流），故为异步接口。
 * platform 域 ApiTokenService 实现并 provide API_TOKEN_VERIFIER。
 */
export interface ApiTokenVerifier {
  verify(token: string): Promise<AuthTokenPayload | null>;
}

/** DI token（个人 API token 校验器；AuthGuard 回落 + ApiTokenGuard 消费） */
export const API_TOKEN_VERIFIER = 'API_TOKEN_VERIFIER';
