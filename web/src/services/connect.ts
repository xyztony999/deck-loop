/**
 * MCP 插件连接授权（ADR-019 浏览器授权流）——纯函数（无 Vue/路由依赖，node --test 直测）。
 *
 * 回环约束：callback 仅允许 http://127.0.0.1 / localhost / [::1]（任意端口）——
 * 个人 token 只回本机监听口，杜绝外泄到非本机目标（SSRF 思路反用）。
 */

export interface ConnectTarget {
  /** 回跳地址（追加 token 参数前） */
  url: string
  /** 连接方名称（签发 tokenName） */
  name: string
}

export type ConnectTargetResult =
  | { ok: true; target: ConnectTarget }
  | { ok: false; reason: string }

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 连接方名称上限（tokenName ≤50 同口径） */
const CONNECT_NAME_MAX = 50

/**
 * 解析 /connect 页 query：callback + name。
 * 非法（缺失/非 http/非回环 host）一律拒绝并给出中文原因。
 */
export function resolveConnectTarget(
  rawCallback: unknown,
  rawName: unknown,
): ConnectTargetResult {
  const name =
    typeof rawName === 'string' && rawName.trim().length > 0
      ? rawName.trim().slice(0, CONNECT_NAME_MAX)
      : 'deck-loop-plugin'
  if (typeof rawCallback !== 'string' || rawCallback.trim().length === 0) {
    return { ok: false, reason: '缺少 callback 参数（请从插件侧重新发起连接）' }
  }
  let url: URL
  try {
    url = new URL(rawCallback)
  } catch {
    return { ok: false, reason: 'callback 地址无法解析' }
  }
  if (url.protocol !== 'http:') {
    return { ok: false, reason: `callback 仅允许 http 回环地址（当前 ${url.protocol}）` }
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: `callback 仅允许本机回环地址（当前 ${url.hostname}）` }
  }
  return { ok: true, target: { url: rawCallback, name } }
}

/** 向 callback 追加 token 参数（本机回环 302；token 不落网站服务器日志） */
export function appendTokenParams(
  callbackUrl: string,
  token: string,
  expiresAt: number | null | undefined,
): string {
  const url = new URL(callbackUrl)
  url.searchParams.set('token', token)
  if (expiresAt != null) {
    url.searchParams.set('expiresAt', String(expiresAt))
  }
  return url.toString()
}