import { Injectable } from '@nestjs/common';
import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { AuthTokenPayload, AuthTokenVerifier } from '../common/auth-token-verifier';

/**
 * 会话 token 服务（P-02 自管会话；v1 SessionTokenServiceImpl 平移）。
 *
 * - token 格式：`v1.<accountId>.<expireEpochMillis>.<hmacSha256>`（URL-safe Base64 段）；
 * - 密钥：env `AUTH_TOKEN_SECRET`（默认值仅供本地，生产必须覆盖——v1
 *   deck-loop.auth.token-secret 语义）；
 * - 30 天滑动：校验通过且剩余不足半程时 refreshIfNeeded 重签，
 *   profile 接口以 refreshedToken 带回（api-platform §4.4 login 规则）；
 * - 撤销表：内存 Map（logout 立即失效；重启丢失撤销表=已登出 token 在重启窗口内
 *   仍可过签名校验——v1 骨架语义，单实例假设 NR-13，生产建议接 Redis）；
 * - 口令哈希：PBKDF2-SHA256 210k 迭代/16B 盐/256bit，存储格式
 *   `pbkdf2$<iterations>$<saltB64>$<hashB64>`（与 v1 逐字段兼容），校验恒时比较。
 */
@Injectable()
export class SessionTokenService implements AuthTokenVerifier {
  private static readonly TOKEN_VERSION = 'v1';

  /** token 有效期：30 天（毫秒） */
  private static readonly TOKEN_TTL_MILLIS = 30 * 24 * 60 * 60 * 1000;

  /** 滑动续期阈值：剩余不足半程重签 */
  private static readonly REFRESH_THRESHOLD_MILLIS = SessionTokenService.TOKEN_TTL_MILLIS / 2;

  private static readonly PBKDF2_ITERATIONS = 210_000;

  private static readonly PBKDF2_SALT_BYTES = 16;

  private static readonly PBKDF2_KEY_BYTES = 32;

  private readonly tokenSecret: string;

  /** 撤销表（token → 撤销时间；prune 清扫已过期项防泄漏） */
  private readonly revokedTokens = new Map<string, number>();

  constructor() {
    const secret = process.env.AUTH_TOKEN_SECRET;
    this.tokenSecret = typeof secret === 'string' && secret.length > 0 ? secret : 'deck-loop-local-token-secret';
  }

  /* ---------------- AuthTokenVerifier（AUTH_TOKEN_VERIFIER provide，AuthGuard 消费） ---------------- */

  /** 校验 token：签名/格式/过期/撤销任一失败返回 null（common 契约） */
  verify(token: string): AuthTokenPayload | null {
    const accountId = this.verifyOrNull(token);
    return accountId === null ? null : { userId: accountId, accountId };
  }

  /* ---------------- 会话签发/校验/撤销（v1 SessionTokenService 契约） ---------------- */

  /** 为账号签发新 token（30 天） */
  issue(accountId: string): string {
    const expire = Date.now() + SessionTokenService.TOKEN_TTL_MILLIS;
    const payload = `${SessionTokenService.TOKEN_VERSION}.${accountId}.${expire}`;
    return `${payload}.${this.hmac(payload)}`;
  }

  /** 校验并返回 accountId（无效返回 null） */
  verifyOrNull(token: string): string | null {
    if (typeof token !== 'string' || token.trim().length === 0) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== SessionTokenService.TOKEN_VERSION) {
      return null;
    }
    if (this.revokedTokens.has(token)) {
      return null;
    }
    const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
    if (!this.constantTimeEquals(this.hmac(payload), parts[3])) {
      return null;
    }
    const expire = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(expire) || Date.now() >= expire) {
      return null;
    }
    return parts[1];
  }

  /** 撤销 token（logout）；token 无效时不抛异常（幂等） */
  revoke(token: string | undefined): void {
    if (typeof token === 'string' && token.trim().length > 0) {
      this.revokedTokens.set(token, Date.now());
      this.pruneRevoked(Date.now());
    }
  }

  /** 滑动续期：剩余有效期不足半程时重签（未到窗口返回 null） */
  refreshIfNeeded(token: string | undefined): string | null {
    if (typeof token !== 'string') {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== SessionTokenService.TOKEN_VERSION) {
      return null;
    }
    const expire = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(expire)) {
      return null;
    }
    if (expire - Date.now() < SessionTokenService.REFRESH_THRESHOLD_MILLIS) {
      return this.issue(parts[1]);
    }
    return null;
  }

  /* ---------------- 口令哈希（与 v1 pbkdf2$iter$saltB64$hashB64 格式兼容） ---------------- */

  /** 口令哈希（PBKDF2-SHA256，256bit） */
  hashPassword(rawPassword: string): string {
    const salt = randomBytes(SessionTokenService.PBKDF2_SALT_BYTES);
    const hash = pbkdf2Sync(
      rawPassword,
      salt,
      SessionTokenService.PBKDF2_ITERATIONS,
      SessionTokenService.PBKDF2_KEY_BYTES,
      'sha256',
    );
    return [
      'pbkdf2',
      SessionTokenService.PBKDF2_ITERATIONS.toString(),
      salt.toString('base64'),
      hash.toString('base64'),
    ].join('$');
  }

  /** 口令校验（恒时比较；格式异常按不匹配处理） */
  verifyPassword(rawPassword: string | undefined, storedHash: string | undefined): boolean {
    if (typeof rawPassword !== 'string' || typeof storedHash !== 'string') {
      return false;
    }
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      return false;
    }
    const iterations = Number.parseInt(parts[1], 10);
    if (!Number.isInteger(iterations) || iterations <= 0 || iterations > 10_000_000) {
      return false;
    }
    try {
      const salt = Buffer.from(parts[2], 'base64');
      const expected = Buffer.from(parts[3], 'base64');
      if (salt.length === 0 || expected.length === 0) {
        return false;
      }
      const actual = pbkdf2Sync(rawPassword, salt, iterations, expected.length, 'sha256');
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  /* ---------------- 内部 ---------------- */

  private hmac(payload: string): string {
    return createHmac('sha256', this.tokenSecret).update(payload, 'utf8').digest('base64url');
  }

  private constantTimeEquals(expected: string, actual: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** 清扫已过期的撤销项（token 过期后撤销记录无意义） */
  private pruneRevoked(now: number): void {
    if (this.revokedTokens.size < 1024) {
      return; // 低频清扫，避免每次 revoke 全表扫描
    }
    for (const [token, revokedAt] of this.revokedTokens) {
      if (now - revokedAt > SessionTokenService.TOKEN_TTL_MILLIS) {
        this.revokedTokens.delete(token);
      }
    }
  }
}
