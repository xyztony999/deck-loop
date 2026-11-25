/**
 * 版本域共享类型与契约常量（自 adjust/types.ts 迁移，ADR-018 剥调整指令面）。
 *
 * 字段契约来源：api-version.md §4.1/§4.4、PageSpec version.md §3/§4/§5。
 * VersionSourceType 的展示文案与颜色一律走字典（ver.dictBatch），此处仅保留
 * 驱动前端交互的枚举值与呈现层配色（契约常量，非展示文案）。
 */
import type { OperItem } from '@/engine'

// ---------------------------------------------------------------
// 版本内容快照（api-version.md §4.1 content JSON 契约）
// ---------------------------------------------------------------

export type VersionBlockType = 'TEXT' | 'IMAGE' | 'PLACEHOLDER'

export interface VersionBlock {
  blockId: string
  blockType: VersionBlockType
  text?: string
  assetId?: string
  style?: Record<string, unknown>
}

export interface VersionPage {
  pageId: string
  layout?: string
  title?: string
  note?: string
  blocks: VersionBlock[]
}

export interface VersionContent {
  pages: VersionPage[]
}

// ---------------------------------------------------------------
// 业务约束常量（api-version.md §4.4 fork）
// ---------------------------------------------------------------

/** 分叉分支名 ≤50、同 deck 唯一（BIZ_VERSION_BRANCH_EXISTS 由后端守卫） */
export const BRANCH_NAME_MAX = 50

// ---------------------------------------------------------------
// 版本树 branchScope（api-version.md §4.4 tree AO：ALL/ACTIVE 默认 ACTIVE）
// 固定入参契约枚举（非字典，内联于 config 层，不受「禁止硬编码字典 options」约束）
// ---------------------------------------------------------------

export const BRANCH_SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: '活动分支' },
  { value: 'ALL', label: '全部分支' },
]

export const BRANCH_SCOPE_DEFAULT = 'ACTIVE'

// ---------------------------------------------------------------
// VO 契约
// ---------------------------------------------------------------

/** ver/version/detail VO（api-version.md §4.4：全字段 + content 完整 JSON） */
export interface VersionDetailVO extends Record<string, unknown> {
  versionId: string
  deckId: string
  versionSeq: number
  branchName: string
  parentVersionId?: string | null
  sourceType: string
  taskId: string
  content?: VersionContent | Record<string, unknown> | null
  contentHash?: string
  pageCount?: number
  createdTime?: string
}

/** ver/version/tree 节点（api-version.md §4.4 tree VO） */
export interface VersionTreeNode extends Record<string, unknown> {
  versionId: string
  versionSeq: number
  branchName: string
  sourceType: string
  instructionBrief?: string
  taskStatusOfSource?: string | null
  createdTime?: string
  isCurrent?: boolean
  isFinal?: boolean
  children?: VersionTreeNode[]
  /** 后端 Deck 状态驱动的节点操作（set-current/fork-from/export-from） */
  operList?: OperItem[]
}

/** ver/version/tree VO（tree + branches） */
export interface VersionTreeVO {
  tree?: VersionTreeNode[]
  branches?: VersionBranchInfo[]
}

export interface VersionBranchInfo {
  branchName: string
  headVersionId: string
  versionCount: number
  isActive: boolean
}

/** ver/version/compare（api-version.md §4.4：按页返回差异，过程数据 P7） */
export type PageChangeKind = 'NONE' | 'STRUCTURE' | 'TEXT' | 'IMAGE' | 'NEW' | 'REMOVED'

export interface CompareDiffBlock {
  blockId: string
  changeKind: PageChangeKind
}

export interface ComparePageDiff {
  pageId: string
  leftIndex?: number | null
  rightIndex?: number | null
  changeKind: PageChangeKind
  diffBlocks?: CompareDiffBlock[]
}

export interface VersionCompareVO {
  sameHash?: boolean
  pages?: ComparePageDiff[]
}

// ---------------------------------------------------------------
// diff 呈现（PageSpec version.md §5：NONE 无 / STRUCTURE blue / TEXT blue /
// IMAGE blue / NEW green / REMOVED red；changeKind 为契约枚举非字典，
// 展示文案为呈现层内联映射。色值取 Antd 语义色 token 同值，chrome accent 边框）
// ---------------------------------------------------------------

export const CHANGE_KIND_COLORS: Record<PageChangeKind, string> = {
  NONE: 'var(--dl-border-light)',
  STRUCTURE: 'var(--dl-primary)',
  TEXT: 'var(--dl-primary)',
  IMAGE: 'var(--dl-primary)',
  NEW: 'var(--dl-success-color)',
  REMOVED: 'var(--dl-danger-color)',
}

export const CHANGE_KIND_LABELS: Record<PageChangeKind, string> = {
  NONE: '无变化',
  STRUCTURE: '结构变更',
  TEXT: '文本变更',
  IMAGE: '图片变更',
  NEW: '新增',
  REMOVED: '移除',
}

/** 版本对比入参（?left=&right=） */
export interface VersionCompareTarget {
  leftVersionId: string
  rightVersionId: string
}