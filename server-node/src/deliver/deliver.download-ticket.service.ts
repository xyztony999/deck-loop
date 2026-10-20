/**
 * 导出下载限时凭证服务 —— v1 ExportDownloadTicketServiceImpl 对齐
 * （api-delivery §4.4 D3：token=HMAC(exportId,userId,exp 30min)；HMAC 模式与
 * asset 域素材文件签名 URL 同构）。
 *
 * - token 形态：{expiresEpochSeconds}:{hmacHex(exportId:userId:expires)}；
 *   GET url：{downloadBaseUrl}/deliver/export/download?exportId=...&token=...
 * - 校验：重算签名（绑定任务属主 userId）+ 过期检查 + **常量时间比较**
 *   （crypto.timingSafeEqual，v1 MessageDigest.isEqual 等价）
 * - 凭证自包含（exportId+userId+exp 摘要签名），GET 下载端点无会话依赖，
 *   凭证即属主证明（domain-manifest §0：签发时已完成 SUCCEEDED+属主校验）
 * - 密钥仅 env EXPORT_SIGN_SECRET（NR-06：禁入库/禁进 VO/禁日志）；TTL 1800s
 */
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_EXPORT_DOWNLOAD_BASE_URL,
  DEFAULT_EXPORT_SIGN_SECRET,
  DEFAULT_EXPORT_TICKET_TTL_SECONDS,
  DOWNLOAD_PATH,
  ENV_EXPORT_DOWNLOAD_BASE_URL,
  ENV_EXPORT_SIGN_SECRET,
  ENV_EXPORT_TICKET_TTL_SECONDS,
} from './deliver.constant';

const HMAC_ALGORITHM = 'sha256';

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value : fallback;
}

function readEnvInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class ExportDownloadTicketService {
  private readonly signKey: string;
  private readonly ttlSeconds: number;
  private readonly downloadBaseUrl: string;

  constructor() {
    this.signKey = readEnv(ENV_EXPORT_SIGN_SECRET, DEFAULT_EXPORT_SIGN_SECRET);
    this.ttlSeconds = readEnvInt(ENV_EXPORT_TICKET_TTL_SECONDS, DEFAULT_EXPORT_TICKET_TTL_SECONDS);
    this.downloadBaseUrl = readEnv(
      ENV_EXPORT_DOWNLOAD_BASE_URL,
      DEFAULT_EXPORT_DOWNLOAD_BASE_URL,
    ).replace(/\/+$/, '');
  }

  /** 签发下载凭证（{expiresEpochSeconds}:{hmacHex}，拼入 GET url 的 token 参数） */
  issue(exportId: string, userId: string): string {
    const expires = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    return `${expires}:${this.hmacHex(exportId, userId, expires)}`;
  }

  /** GET 下载 URL（/deliver/export/download?exportId=...&token=...） */
  buildDownloadUrl(exportId: string, token: string): string {
    return (
      this.downloadBaseUrl +
      DOWNLOAD_PATH +
      '?exportId=' +
      encodeURIComponent(exportId) +
      '&token=' +
      encodeURIComponent(token)
    );
  }

  /** 凭证有效期（秒），供 VO 回填 expiresIn */
  ttl(): number {
    return this.ttlSeconds;
  }

  /**
   * 校验下载凭证（重算签名 + 过期检查 + 常量时间比较）。
   *
   * @param exportId 导出任务 ID（须与凭证签名输入一致）
   * @param userId   任务属主（重算签名输入；非属主持有的凭证不通过）
   * @param token    凭证值
   * @return true=有效且未过期
   */
  verify(exportId: string, userId: string, token: string): boolean {
    if (exportId == null || token == null || userId == null) {
      return false;
    }
    const separator = token.indexOf(':');
    if (separator <= 0) {
      return false;
    }
    const expires = Number.parseInt(token.substring(0, separator), 10);
    if (!Number.isInteger(expires)) {
      return false;
    }
    if (Math.floor(Date.now() / 1000) >= expires) {
      return false;
    }
    const expected = Buffer.from(this.hmacHex(exportId, userId, expires), 'utf8');
    const actual = Buffer.from(token.substring(separator + 1), 'utf8');
    // 常量时间比较（长度不等先拒绝，避免 timingSafeEqual 抛错；比较次数不泄露签名信息）
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private hmacHex(exportId: string, userId: string, expires: number): string {
    const data = `${exportId}:${userId}:${expires}`;
    return createHmac(HMAC_ALGORITHM, this.signKey).update(data, 'utf8').digest('hex');
  }
}
