/**
 * adjust 模块（迭代工作台）共享类型与契约常量。
 *
 * 字段契约来源：api-adjustment.md §4.1/§4.3/§4.4、api-version.md §4.1/§4.4、
 * PageSpec adjustment.md §3/§4。
 *
 * TargetKind/VersionSourceType 的展示文案与颜色一律走字典
 * （adjust.dictBatch / ver.dictBatch），此处仅保留驱动前端交互的
 * 枚举值与呈现层配色（契约常量，非展示文案）。
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
// TargetKind（api-adjustment.md §3.4 枚举；prd-adjustment scope.targetKind）
// ---------------------------------------------------------------

export const TARGET_KIND = {
  PAGE: 'PAGE',
  TEXT_BLOCK: 'TEXT_BLOCK',
  IMAGE_BLOCK: 'IMAGE_BLOCK',
} as const

export type TargetKind = (typeof TARGET_KIND)[keyof typeof TARGET_KIND]

/** 字典 key（PageSpec adjustment.md §3：选中态标签；16-enum-dict 契约 = 驼峰字段名） */
export const ADJUST_DICT_TARGET_KIND = 'targetKind'

/** 块类型 → 可选中的 TargetKind（PLACEHOLDER 不可选中定位） */
export const BLOCK_TARGET_KIND: Record<VersionBlockType, TargetKind | null> = {
  TEXT: TARGET_KIND.TEXT_BLOCK,
  IMAGE: TARGET_KIND.IMAGE_BLOCK,
  PLACEHOLDER: null,
}

/** 定向目标（targetPath = {pageId} 或 {pageId, blockId}，api-adjustment §4.1） */
export interface AdjustTarget {
  kind: TargetKind
  pageId: string
  blockId?: string
  /** 块级目标回显：块内容类型 */
  blockType?: 'TEXT' | 'IMAGE'
}

/** targetPath 组装（TARGETED 必填 AO） */
export function buildTargetPath(t: AdjustTarget): Record<string, string> {
  return t.blockId ? { pageId: t.pageId, blockId: t.blockId } : { pageId: t.pageId }
}

// ---------------------------------------------------------------
// 调整任务（复用 gen 任务跟踪；api-adjustment.md §4.3 taskType）
// ---------------------------------------------------------------

export const ADJUST_TASK_TYPES = ['FULL_ADJUST', 'TARGETED_ADJUST'] as const

// ---------------------------------------------------------------
// 业务约束常量（api-adjustment.md §4.1 / api-version.md §4.4 fork）
// ---------------------------------------------------------------

/** 指令文本 ≤2000（INV-10 占位符全部替换） */
export const INSTRUCTION_TEXT_MAX = 2000
/** 分叉分支名 ≤50、同 deck 唯一（BIZ_VERSION_BRANCH_EXISTS 由后端守卫） */
export const BRANCH_NAME_MAX = 50

/**
 * 话术占位符语法 `{名称}`（api-assets.md INV-21，≤10 处）。
 * 未全部替换禁止提交（BIZ_ADJUST_PLACEHOLDER_UNRESOLVED，前端前置拦截）。
 */
const PLACEHOLDER_PATTERN = /\{[^{}\n]{1,50}\}/g

export function findUnresolvedPlaceholders(text: string): string[] {
  const hits = text.match(PLACEHOLDER_PATTERN)
  return hits ? [...new Set(hits)] : []
}

// ---------------------------------------------------------------
// 版本树 branchScope（api-version.md §4.4 tree AO：ALL/ACTIVE 默认 ACTIVE）
// 未列入 PageSpec §3 字典 Key 清单，为固定入参契约枚举（同 LENGTH_OPTIONS
// 先例：内联于 config 层，非字典，不受「禁止硬编码字典 options」约束）
// ---------------------------------------------------------------

export const BRANCH_SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: '活动分支' },
  { value: 'ALL', label: '全部分支' },
]

export const BRANCH_SCOPE_DEFAULT = 'ACTIVE'

// ---------------------------------------------------------------
// VO 契约
// ---------------------------------------------------------------

/** whole/targeted submit VO（api-adjustment.md §4.4：taskId/taskCode/taskStatus/forked；
 * needForkBranch=true 提示态：confirm=false 拒绝、true 接受并要求 branchName） */
export interface AdjustSubmitVO {
  taskId?: string
  taskCode?: string
  taskStatus?: string
  forked?: boolean
  /** 基线≠当前版本时首次提交（confirm=false）返回 true，前端弹分叉确认 */
  needForkBranch?: boolean
}

/** scope/validate VO（api-adjustment.md §4.4：valid + targetSummary 供回显） */
export interface ScopeValidateVO {
  valid: boolean
  targetSummary?: string
}

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
  taskStatusOfSource?: string
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

/** ver/version/compare（api-version.md §4.4：按页返回差异，过程数据） */
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
// diff 呈现（PageSpec adjustment.md §4.4：STRUCTURE 紫 / TEXT 橙 /
// IMAGE 蓝 / NEW 绿 / REMOVED 灰；changeKind 为契约枚举非字典，
// 展示文案为呈现层内联映射）
// ---------------------------------------------------------------

export const CHANGE_KIND_COLORS: Record<PageChangeKind, string> = {
  NONE: '#d1d5db',
  STRUCTURE: '#722ed1',
  TEXT: '#fa8c16',
  IMAGE: '#1890ff',
  NEW: '#52c41a',
  REMOVED: '#6b7280',
}

export const CHANGE_KIND_LABELS: Record<PageChangeKind, string> = {
  NONE: '无变化',
  STRUCTURE: '结构变更',
  TEXT: '文本变更',
  IMAGE: '图片变更',
  NEW: '新增',
  REMOVED: '移除',
}

// ---------------------------------------------------------------
// 指令卡提交载荷（InstructionPanel → 页面的已校验表单值）
// ---------------------------------------------------------------

export interface InstructionSubmitPayload {
  mode: 'whole' | 'targeted'
  instructionText: string
  usedTemplateIds: string[]
  applyBrandKit: boolean
  brandKitId?: string
  /** needForkBranch 确认分叉（基线≠当前版本时 true） */
  confirm: boolean
  branchName?: string
}

/** 版本对比抽屉入参 */
export interface VersionCompareTarget {
  leftVersionId: string
  rightVersionId: string
}
