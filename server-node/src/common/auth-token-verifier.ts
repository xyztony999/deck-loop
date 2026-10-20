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
}

/** verifier 接口：token 无效/过期/撤销时返回 null */
export interface AuthTokenVerifier {
  verify(token: string): AuthTokenPayload | null;
}

/** DI token（字符串 token，跨模块 provide/useClass 直接引用） */
export const AUTH_TOKEN_VERIFIER = 'AUTH_TOKEN_VERIFIER';
