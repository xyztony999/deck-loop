/**
 * deck 模块共享契约：字典 key、状态常量、呈现层颜色映射、行/详情 VO 类型、
 * 详情页操作按钮派生（deck.md §6「状态驱动，同 operList 语义」）。
 *
 * 字段来源：api-deck.md §4.4（list 行 VO / DetailVO / operList 计算表）、
 * 枚举池 04-business-enum（DeckType/DeckStatus）。
 */
import { registerDictColorMap } from '@/engine'
import type { RowWithOperList } from '@/engine'

/** 字典 key（deck.md §3；16-enum-dict 契约 = 字段驼峰名，POST /deck/dict/batch 原样上送） */
export const DECK_DICT_TYPE = 'deckType'
export const DECK_DICT_STATUS = 'deckStatus'

/** 最近任务状态字典 key（deck.md §6；taskStatus 归 gen 域字典） */
export const TASK_DICT_STATUS = 'taskStatus'

/** 首期仅支持 DECK（deck.md §5：DOC/POSTER 置灰「即将支持」；api-deck SaveAO deckType 仅 DECK） */
export const DECK_TYPE_DECK = 'DECK'

/** DeckStatus 枚举值（枚举池 04-business-enum；仅用于状态机派生，字典选项仍全部来自后端） */
export const DECK_STATUS = {
  DRAFT: 'DRAFT',
  ITERATING: 'ITERATING',
  FINALIZED: 'FINALIZED',
  ARCHIVED: 'ARCHIVED',
} as const

/**
 * deck.DeckStatus 呈现层 Tag 颜色（deck.md §3：
 * DRAFT gray / ITERATING blue / FINALIZED green / ARCHIVED gray）。
 * registerDictColorMap 幂等合并，重复调用安全。
 */
export function registerDeckDictColors(): void {
  registerDictColorMap('deck', {
    [DECK_DICT_STATUS]: {
      DRAFT: 'default',
      ITERATING: 'blue',
      FINALIZED: 'green',
      ARCHIVED: 'default',
    },
  })
}

/**
 * task.TaskStatus 呈现层 Tag 颜色（adjustment.md §3：
 * QUEUED gray / RUNNING blue / SUCCEEDED green / FAILED red / CANCELLED gray）。
 * 归 gen 域（generation.md §2/§3）；registerDictColorMap 幂等合并，
 * 与 gen/adjust 批次对同域颜色的注册不冲突。
 */
export function registerTaskStatusColors(): void {
  registerDictColorMap('gen', {
    [TASK_DICT_STATUS]: {
      QUEUED: 'default',
      RUNNING: 'blue',
      SUCCEEDED: 'green',
      FAILED: 'red',
      CANCELLED: 'default',
    },
  })
}

/** 列表行 VO（api-deck.md §4.4 deck/list 行 VO） */
export interface DeckListRow extends RowWithOperList {
  deckId: string
  deckName: string
  deckType: string
  topic: string
  deckStatus: string
  currentVersionSeq: number | null
  versionCount: number
  adjustCount: number
  activeBranch: string
  defaultBrandKitName: string | null
  createdTime: string
  updatedTime: string
  /** 呈现层派生列（列表页载入后填充）：当前版本 v{seq} */
  currentVersionText?: string
  /** 呈现层派生列（列表页载入后填充）：版本数 / 调整次数 */
  versionAdjustText?: string
}

/** 最近任务（api-deck.md §4.4 DetailVO.latestTask，withLatestTask 开关） */
export interface DeckLatestTaskVO {
  taskId: string
  taskType: string
  taskStatus: string
}

/** 详情 VO（api-deck.md §4.4 DetailVO：主表全字段 + brandKitName + stats? + latestTask?） */
export interface DeckDetailVO extends RowWithOperList {
  deckId: string
  deckName: string
  deckType: string
  topic: string
  requirement: string | null
  deckStatus: string
  defaultBrandKitId: string | null
  brandKitName: string | null
  currentVersionId: string | null
  activeBranch: string
  finalVersionId: string | null
  archivedFromStatus: string | null
  createdTime: string
  updatedTime: string
  stats?: { versionCount: number; adjustCount: number; exportCount: number }
  latestTask?: DeckLatestTaskVO
}

/** 详情页操作按钮（deck.md §6：状态驱动，同 operList 语义） */
export interface DeckDetailAction {
  key:
    | 'generate'
    | 'iterate'
    | 'edit'
    | 'finalize'
    | 'unfinalize'
    | 'archive'
    | 'restore'
    | 'delete'
    | 'export'
    | 'present'
  label: string
  primary?: boolean
  danger?: boolean
}

/**
 * 按 DeckStatus 派生详情页操作按钮。
 *
 * 条件表 = api-deck.md §4.4 operList 计算（edit: DRAFT/ITERATING；
 * finalize: ITERATING；unfinalize: FINALIZED；archive: 非 ARCHIVED；
 * restore/delete: ARCHIVED）。其中「无进行中任务」守卫由后端动作接口执行
 * （BIZ_DECK_TASK_RUNNING），前端不重复判断。导出仅 FINALIZED（deck.md §6）。
 * DRAFT 的「开始生成」来自 generation.md §1（DRAFT 态详情入口）。
 */
export function deckDetailActions(
  deckStatus: string | null | undefined,
): DeckDetailAction[] {
  const s = deckStatus ?? ''
  const actions: DeckDetailAction[] = []
  if (s === DECK_STATUS.DRAFT) {
    actions.push({ key: 'generate', label: '开始生成', primary: true })
    actions.push({ key: 'edit', label: '编辑' })
  } else if (s === DECK_STATUS.ITERATING) {
    actions.push({ key: 'iterate', label: '进入迭代工作台', primary: true })
    actions.push({ key: 'edit', label: '编辑' })
    actions.push({ key: 'finalize', label: '定稿' })
  } else if (s === DECK_STATUS.FINALIZED) {
    actions.push({ key: 'iterate', label: '进入迭代工作台', primary: true })
    actions.push({ key: 'unfinalize', label: '解锁' })
    actions.push({ key: 'export', label: '导出' })
    // 演示入口（delivery.md §1/§6：详情 [演示] → /deck/:deckId/present，仅 FINALIZED）
    actions.push({ key: 'present', label: '演示' })
  }
  if (
    s === DECK_STATUS.DRAFT ||
    s === DECK_STATUS.ITERATING ||
    s === DECK_STATUS.FINALIZED
  ) {
    actions.push({ key: 'archive', label: '归档' })
  }
  if (s === DECK_STATUS.ARCHIVED) {
    actions.push({ key: 'restore', label: '恢复', primary: true })
    actions.push({ key: 'delete', label: '删除', danger: true })
  }
  return actions
}
