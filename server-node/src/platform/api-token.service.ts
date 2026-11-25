import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiTokenVerifier, AuthTokenPayload } from '../common/auth-token-verifier';
import { BizException } from '../common/exceptions';
import { isDuplicateKeyError } from '../common/persistence';
import { PageResult } from '../common/result';
import { nextId } from '../common/utils/snowflake';
import { ApiTokenRepository } from './api-token.repository';
import {
  ApiTokenIssueAO,
  ApiTokenIssueVO,
  ApiTokenListAO,
  ApiTokenListVO,
  ApiTokenRevokeAO,
  deriveTokenStatus,
} from './platform.dto';
import { AUTH_TOKEN_INVALID, AUTH_TOKEN_INVALID_MSG } from './platform.errors';
import { ApiToken } from './schemas/api-token.schema';

/** token 明文前缀（api-web-agent §4.1：dlpat_ + 32B 随机 base64url） */
export const API_TOKEN_PREFIX = 'dlpat_';

/** 随机段字节数（32B → base64url 43 字符） */
const TOKEN_RANDOM_BYTES = 32;

/** 明文前 12 字符回显（dlpat_+6，token_prefix 列） */
const TOKEN_PREFIX_LENGTH = 12;

/** 缺省有效期（天）；permanent=true 时忽略 */
const DEFAULT_EXPIRES_DAYS = 90;

/** last_used_at 节流窗口（≤1 次/分钟/token） */
const LAST_USED_THROTTLE_MILLIS = 60_000;

/** 签发撞 uk 重试上限（INV-27 兜底；32B 随机碰撞概率天文数字级，防御性重试） */
const ISSUE_RETRY_LIMIT = 3;

/**
 * 个人 API token 领域服务（P-02 增量，api-web-agent §4.1；ADR-018）。
 *
 * **独立于 SessionTokenService**（独立表/哈希/过期/吊销逻辑）：
 * - issue：会话属主 → dlpat_+32B 随机 base64url → SHA-256 落库（INV-27 uk 兜底）
 *   → 回执明文**仅此一次**（INV-28：不落库、不进日志、不回显）；
 * - revoke：属主校验 → 条件更新 revoked_at（已吊销幂等成功）；不物理删除；
 * - listPage：强制 user_id，created_time DESC；**永不回显 token/token_hash**；
 * - verify（ApiTokenVerifier provide）：格式预检 → SHA-256 → uk 查库 → 恒时比较
 *   → expires_at/revoked_at 判定 → last_used_at 节流更新。**每次查库**——
 *   吊销即时生效，重启不丢失（区别于会话内存撤销表）。
 *
 * 失败统一返回 null / BIZ_AUTH_TOKEN_INVALID（防枚举：缺头/格式错/哈希不匹配/
 * 过期/吊销不区分提示）。
 */
@Injectable()
export class ApiTokenService implements ApiTokenVerifier {
  constructor(private readonly tokenRepository: ApiTokenRepository) {}

  /* ---------------- ApiTokenVerifier（API_TOKEN_VERIFIER provide，AuthGuard 回落/ApiTokenGuard 消费） ---------------- */

  /** 校验个人 token：格式/哈希/过期/吊销任一失败返回 null（异步查库） */
  async verify(token: string): Promise<AuthTokenPayload | null> {
    if (typeof token !== 'string' || !token.startsWith(API_TOKEN_PREFIX)) {
      return null;
    }
    const expectedLength = API_TOKEN_PREFIX.length + 43;
    if (token.length !== expectedLength) {
      return null;
    }
    const hash = sha256Hex(token);
    const row = await this.tokenRepository.findByHash(hash);
    if (row === null) {
      return null;
    }
    // 恒时比较（哈希查找已命中，再比一次防时序侧信道；INV-26 精神延续）
    if (!constantTimeEquals(row.token_hash, hash)) {
      return null;
    }
    const now = Date.now();
    if (row.revoked_at != null) {
      return null;
    }
    if (row.expires_at != null && row.expires_at.getTime() <= now) {
      return null;
    }
    // 节流回写最近使用（≤1 次/分钟/token；失败不影响校验结果）
    await this.tokenRepository
      .touchLastUsed(row.token_id, new Date(now), new Date(now - LAST_USED_THROTTLE_MILLIS))
      .catch(() => undefined);
    // 单用户产品：token 等价账号全量属主权限（ADR-005，无 RBAC/scope）
    return { userId: row.user_id, accountId: row.user_id };
  }

  /* ---------------- 签发/吊销/列表（会话守卫，网站设置页消费） ---------------- */

  /** 签发 token（明文仅此次回执；INV-28） */
  async issue(ao: ApiTokenIssueAO, userId: string): Promise<ApiTokenIssueVO> {
    const permanent = ao.permanent === true;
    const expiresDays = ao.expiresDays ?? DEFAULT_EXPIRES_DAYS;
    const now = new Date();
    const expiresAt = permanent ? null : new Date(now.getTime() + expiresDays * 24 * 60 * 60 * 1000);

    for (let attempt = 0; attempt < ISSUE_RETRY_LIMIT; attempt += 1) {
      const plain = API_TOKEN_PREFIX + randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
      const row = new ApiToken();
      row.token_id = nextId();
      row.user_id = userId;
      row.token_name = ao.tokenName;
      row.token_prefix = plain.slice(0, TOKEN_PREFIX_LENGTH);
      row.token_hash = sha256Hex(plain);
      row.expires_at = expiresAt;
      row.last_used_at = null;
      row.revoked_at = null;
      row.data_version = 0;
      row.delete_sign = 0;
      row.created_by = userId;
      row.created_name = userId;
      row.created_time = now;
      row.updated_by = userId;
      row.updated_name = userId;
      row.updated_time = now;
      try {
        await this.tokenRepository.insert(row);
        // 明文仅此一次进 VO（INV-28：不落库不进日志不回显——列表/详情永不含）
        return ApiTokenIssueVO.of(row, plain);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          continue; // uk_api_token_hash 兜底 INV-27：重新生成
        }
        throw error;
      }
    }
    throw new BizException(AUTH_TOKEN_INVALID, 'token 签发失败，请重试');
  }

  /** 吊销 token（属主校验；已吊销幂等成功；即时生效——verify 每次查库） */
  async revoke(ao: ApiTokenRevokeAO, userId: string): Promise<void> {
    const row = await this.tokenRepository.findByIdOwned(ao.tokenId, userId);
    if (row === null) {
      throw new BizException(AUTH_TOKEN_INVALID, AUTH_TOKEN_INVALID_MSG);
    }
    if (row.revoked_at != null) {
      return; // 幂等：已吊销
    }
    await this.tokenRepository.conditionalRevoke(ao.tokenId, userId, new Date());
  }

  /** token 分页列表（强制属主；status 派生；永不回显 token/token_hash） */
  async listPage(ao: ApiTokenListAO, userId: string): Promise<PageResult<ApiTokenListVO>> {
    const pageNum = ao.pageNum ?? 1;
    const pageSize = ao.pageSize ?? 20;
    const { records, total } = await this.tokenRepository.pageByUser(userId, pageNum, pageSize);
    const now = Date.now();
    const vos = records.map((row) => ApiTokenListVO.of(row, deriveTokenStatus(row, now)));
    return PageResult.of(vos, total, pageNum, pageSize);
  }
}

/** SHA-256 hex（全 token；与仓储 uk_api_token_hash 同口径） */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 恒时比较（等长前提；长度不等直接 false） */
function constantTimeEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}