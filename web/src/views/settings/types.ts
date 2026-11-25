/**
 * settings 模块（设置中心）共享类型与契约常量。
 *
 * 字段契约来源：api-platform.md §4.4（account/profile）、api-web-agent.md §4.1
 * （个人 API token issue/revoke/list）、PageSpec settings.md §2-§5。
 *
 * ADR-018：生成偏好/用量统计/模型渠道三 Tab 随网关退役；新增 API token Tab。
 * token status 为派生展示值（ACTIVE/EXPIRED/REVOKED，不入枚举池，过程数据 P2）。
 */
import type { RowWithOperList } from '@/engine'

// ---------------------------------------------------------------
// 账户（auth.account/profile）
// ---------------------------------------------------------------

/** auth.account/profile VO（email 只读 / nickname 编辑） */
export interface AccountProfileVO {
  accountId?: string
  email?: string
  nickname?: string
}

// ---------------------------------------------------------------
// 个人 API token（api-web-agent.md §4.1）
// ---------------------------------------------------------------

/** token 派生状态（展示值，非字典；REVOKED/EXPIRED 灰、ACTIVE green） */
export const TOKEN_STATUS = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const

export type TokenStatus = (typeof TOKEN_STATUS)[keyof typeof TOKEN_STATUS]

/** token/list 行 VO（永不回显 token/token_hash，仅 prefix） */
export interface TokenListRow extends RowWithOperList {
  tokenId: string
  tokenName: string
  tokenPrefix: string
  createdTime: string
  expiresAt: string | null
  lastUsedAt: string | null
  status: TokenStatus
}

/** token/issue VO（token 明文仅此一次，INV-28） */
export interface TokenIssueVO {
  tokenId: string
  tokenName: string
  /** 明文全文（仅签发回执一次） */
  token: string
  tokenPrefix: string
  expiresAt: string | null
  createdTime: string
}

/** tokenName 上限（api-web-agent §4.1 AO ≤50） */
export const TOKEN_NAME_MAX = 50
/** 有效期天数范围（1~365，缺省 90） */
export const TOKEN_EXPIRES_DAYS_DEFAULT = 90
export const TOKEN_EXPIRES_DAYS_MIN = 1
export const TOKEN_EXPIRES_DAYS_MAX = 365