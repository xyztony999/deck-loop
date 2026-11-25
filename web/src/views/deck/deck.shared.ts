/**
 * deck 模块共享契约：字典 key、状态常量、呈现层颜色映射、行/详情 VO 类型、
 * 详情工作台操作按钮派生（deck.md §6「状态驱动，同 operList 语义」）。
 *
 * 字段来源：api-deck.md §4.4（list 行 VO / DetailVO / operList 计算表）、
 * 枚举池 04-business-enum（DeckType/DeckStatus）。
 *
 * ADR-018：generation/adjustment 退役——详情不展示任务面板（withLatestTask=false），
 * 操作按钮去 generate/iterate，增 compare/present/导出记录入口。
 */
import { registerDictColorMap } from '@/engine'
import type { RowWithOperList } from '@/engine'

/** 字典 key（deck.md §3；POST /deck/dict/batch 原样上送） */
export const DECK_DICT_TYPE = 'deckType'
export const DECK_DICT_STATUS = 'deckStatus'

/** 首期仅支持 DECK（deck.md §5：DOC/POSTER 置灰「即将支持」） */
export const DECK_TYPE_DECK = 'DECK'

/** DeckStatus 枚举值（枚举池 04-business-enum；仅用于状态机派生） */
export const DECK_STATUS = {
  DRAFT: 'DRAFT',
  ITERATING: 'ITERATING',
  FINALIZED: 'FINALIZED',
  ARCHIVED: 'ARCHIVED',
} as const

/**
 * deck.DeckStatus 呈现层 Tag 颜色（deck.md §3：
 * DRAFT gray / ITERATING blue / FINALIZED green / ARCHIVED gray）。
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
  /** 呈现层派生列：当前版本 v{seq} */
  currentVersionText?: string
  /** 呈现层派生列：版本数 / 调整次数 */
  versionAdjustText?: string
}

/** 详情 VO（api-deck.md §4.4 DetailVO：主表全字段 + brandKitName + stats?） */
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
  /** DRAFT 态大纲（draft_outline 值对象；首版后只读） */
  draftOutline?: unknown
  createdTime: string
  updatedTime: string
  stats?: { versionCount: number; adjustCount: number; exportCount: number }
}

/** 详情工作台操作按钮（deck.md §6：状态驱动，同 operList 语义） */
export interface DeckDetailAction {
  key:
    | 'edit'
    | 'finalize'
    | 'unfinalize'
    | 'archive'
    | 'restore'
    | 'delete'
    | 'compare'
    | 'present'
    | 'export'
  label: string
  primary?: boolean
  danger?: boolean
}

/**
 * 按 DeckStatus 派生详情工作台操作按钮（deck.md §6）。
 * 条件表 = api-deck.md §4.4 operList 计算（edit: DRAFT/ITERATING；finalize:
 * ITERATING；unfinalize: FINALIZED；archive: 非 ARCHIVED；restore/delete: ARCHIVED）。
 * compare/present/导出记录：有版本后可用（ITERATING/FINALIZED）。
 */
export function deckDetailActions(
  deckStatus: string | null | undefined,
): DeckDetailAction[] {
  const s = deckStatus ?? ''
  const actions: DeckDetailAction[] = []
  if (s === DECK_STATUS.DRAFT) {
    actions.push({ key: 'edit', label: '编辑', primary: true })
  } else if (s === DECK_STATUS.ITERATING) {
    actions.push({ key: 'edit', label: '编辑' })
    actions.push({ key: 'finalize', label: '定稿' })
  } else if (s === DECK_STATUS.FINALIZED) {
    actions.push({ key: 'unfinalize', label: '解锁' })
  }
  if (s === DECK_STATUS.ITERATING || s === DECK_STATUS.FINALIZED) {
    actions.push({ key: 'compare', label: '对比' })
    actions.push({ key: 'present', label: '放映' })
    actions.push({ key: 'export', label: '导出记录' })
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