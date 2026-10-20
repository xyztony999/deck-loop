/**
 * gen 模块（生成向导）共享类型与契约常量。
 *
 * 字段契约来源：api-generation.md §4.1/§4.3/§4.4、PageSpec generation.md §4。
 * TaskType/TaskStatus 的展示文案与颜色一律走字典（gen.dictBatch），
 * 此处仅保留驱动前端状态机的枚举值（契约常量，非展示文案）。
 */
import type { OperItem } from '@/engine'

// ---------------------------------------------------------------
// 大纲（Outline 值对象：写入 Deck.draftOutline 的节点树）
// ---------------------------------------------------------------

/** 大纲节点（api-generation.md §4.3 outline/save AO） */
export interface OutlineNode {
  nodeId: string
  /** ≤50 字（INV 校验：节点 1~50、title ≤50） */
  title: string
  /** 要点列表（编辑态按行拆分，保存前过滤空行） */
  points: string[]
  note?: string
  pageHint?: string
}

// ---------------------------------------------------------------
// 任务（GenerationTask）
// ---------------------------------------------------------------

/** TaskStatus 枚举值（api-generation.md §4.2 状态模型） */
export const TASK_STATUS = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

/** 本向导关心的 TaskType 枚举值（调整类任务属 adjust 模块） */
export const TASK_TYPE = {
  OUTLINE: 'OUTLINE',
  FULL_GENERATE: 'FULL_GENERATE',
} as const

/** 终态集合（QUEUED/RUNNING→CANCELLED，终态留存） */
const TERMINAL_STATUSES: readonly string[] = [
  TASK_STATUS.SUCCEEDED,
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELLED,
]

export function isTerminalTaskStatus(status: string | undefined | null): boolean {
  return !!status && TERMINAL_STATUSES.includes(status)
}

/** 任务创建 VO（outline/generate、full/generate、retry 共用形态） */
export interface GenTaskCreateVO {
  taskId: string
  taskCode?: string
  taskStatus?: string
}

/** 任务进度条目（gen.taskProgress VO：progressPercent 为派生展示数据） */
export interface TaskProgressItem {
  taskId: string
  taskStatus?: string
  progressPercent?: number
  stageText?: string
}

/** gen.task/list 行 VO（api-generation.md §4.4：含 operList） */
export interface GenTaskRow extends Record<string, unknown> {
  taskId: string
  taskCode?: string
  taskType?: string
  taskStatus?: string
  deckId?: string
  deckName?: string
  instructionBrief?: string
  channelCode?: string
  modelCode?: string
  resultVersionSeq?: number | null
  createdTime?: string
  operList?: OperItem[]
}

/** gen.task/detail VO（失败摘要 errorMsg 来源） */
export interface GenTaskDetailVO extends GenTaskRow {
  errorMsg?: string
  instructionSnapshot?: Record<string, unknown>
}

// ---------------------------------------------------------------
// 业务约束常量（PageSpec generation.md §4）
// ---------------------------------------------------------------

/** 步骤①：补充要求 ≤500 字 */
export const EXTRA_REQUIREMENT_MAX = 500
/** 步骤①：素材引用 ≤10（启用态） */
export const ASSET_IDS_MAX = 10
/** 步骤②：大纲节点 1~50；节点标题 ≤50 字 */
export const OUTLINE_NODE_MAX = 50
export const OUTLINE_TITLE_MAX = 50
/** 步骤②：大纲自动保存 debounce 2s（PageSpec generation.md §4） */
export const OUTLINE_AUTOSAVE_DELAY_MS = 2000

/**
 * 步骤③ 篇幅选项（SHORT 简练 / MEDIUM 标准 / LONG 详尽，默认 MEDIUM）。
 * LengthOption 未列入 PageSpec §3 字典 Key 清单（那里仅 task.TaskStatus），
 * 且 api-generation §4.4 将其定义为固定入参枚举，故按契约枚举内联于
 * config 层（非字典，不受「禁止硬编码字典 options」约束）。
 */
export const LENGTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'SHORT', label: '简练' },
  { value: 'MEDIUM', label: '标准' },
  { value: 'LONG', label: '详尽' },
]

export const LENGTH_OPTION_DEFAULT = 'MEDIUM'
