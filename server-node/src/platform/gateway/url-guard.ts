/**
 * 服务端出站 URL 安全校验（SSRF 防线）：
 * 仅允许 http/https；拒绝 localhost、环回、私有、保留地址。
 * 消费点：AI 网关适配器发起 provider 调用前。
 */
import { BizException } from '../../common/exceptions';
import { GW_PROVIDER_TIMEOUT } from '../platform.errors';

const PRIVATE_V4_PATTERNS: readonly RegExp[] = [
  /^127\./, // 环回
  /^10\./, // 私有 A
  /^192\.168\./, // 私有 C
  /^172\.(1[6-9]|2\d|3[01])\./, // 私有 B
  /^169\.254\./, // 链路本地
  /^0\./, // 保留
];

export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BizException(GW_PROVIDER_TIMEOUT, '渠道 baseUrl 非法：无法解析为 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BizException(GW_PROVIDER_TIMEOUT, `渠道 baseUrl 仅允许 http/https（当前 ${parsed.protocol}）`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === '' ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host.startsWith('fc') || // IPv6 ULA fc00::/7
    host.startsWith('fd') ||
    host.startsWith('fe80') || // IPv6 链路本地
    PRIVATE_V4_PATTERNS.some((p) => p.test(host))
  ) {
    throw new BizException(GW_PROVIDER_TIMEOUT, `渠道 baseUrl 指向内网/保留地址（${host}），已拒绝`);
  }
  return parsed;
}
