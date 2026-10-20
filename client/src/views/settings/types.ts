/**
 * settings 模块（设置中心）共享类型与契约常量。
 *
 * 字段契约来源：
 * - api-channel.md §4.4（preference/detail、preference/save、
 *   select/model-options、usage/summary）
 * - api-platform.md §4.4（account/profile 读/改昵称、sync/pull）
 * - 01-solution/common-spec/05-select-service-pool.md（channel.select.modelOptions）
 * - PageSpec settings.md §2-§6
 *
 * 档位展示文案一律走 gen 域字典 task.TaskType（settings.md §3，
 * gen.dictBatch 已注册）；此处仅保留契约枚举值（同 gen TaskType 枚举）。
 */
import type { SelectOption } from '@/engine'

// ---------------------------------------------------------------
// 偏好档位（preferenceMap 键 = TaskType，api-channel.md §4.1）
// ---------------------------------------------------------------

/** preferenceMap 键枚举（与 gen 域 TaskType 同枚举池，契约常量非展示文案） */
export const PREFERENCE_TASK_TYPES = [
  'OUTLINE',
  'FULL_GENERATE',
  'FULL_ADJUST',
  'TARGETED_ADJUST',
] as const

export type PreferenceTaskType = (typeof PREFERENCE_TASK_TYPES)[number]

/** 档位分组（settings.md §3 渲染「OUTLINE/整稿/调整」三组分组标签） */
export interface PreferenceTierGroup {
  key: string
  /** 分组标题（PageSpec §3 渲染列给定，页面文案非字典） */
  title: string
  types: PreferenceTaskType[]
}

export const PREFERENCE_TIER_GROUPS: PreferenceTierGroup[] = [
  { key: 'outline', title: '大纲', types: ['OUTLINE'] },
  { key: 'full', title: '整稿', types: ['FULL_GENERATE'] },
  { key: 'adjust', title: '调整', types: ['FULL_ADJUST', 'TARGETED_ADJUST'] },
]

/** 档位附加建议标注（PageSpec settings.md §4 表格「质量档/快速档建议」） */
export const PREFERENCE_TIER_HINTS: Partial<Record<PreferenceTaskType, string>> = {
  FULL_GENERATE: '质量档建议',
  TARGETED_ADJUST: '快速档建议',
}

// ---------------------------------------------------------------
// 渠道/模型选择池（channel.select.modelOptions）
// ---------------------------------------------------------------

/** 选择池 value 组合分隔符：channelCode::modelCode（05-select-service-pool.md） */
export const MODEL_VALUE_SEPARATOR = '::'

/** 选择池选项（SelectOption + 扩展 capabilityTags） */
export interface ModelOptionVO extends SelectOption {
  /** value = `${channelCode}::${modelCode}` */
  value: string
  /** 能力标签（扩展字段；settings.md §3 渲染为 tag） */
  capabilityTags?: string[]
}

/** 拆分选择池组合值为 { channelCode, modelCode } */
export function splitModelValue(
  value: string,
): { channelCode: string; modelCode: string } | null {
  const idx = value.indexOf(MODEL_VALUE_SEPARATOR)
  if (idx <= 0 || idx + MODEL_VALUE_SEPARATOR.length >= value.length) return null
  return {
    channelCode: value.slice(0, idx),
    modelCode: value.slice(idx + MODEL_VALUE_SEPARATOR.length),
  }
}

// ---------------------------------------------------------------
// 偏好（channel.preference/detail / save）
// ---------------------------------------------------------------

/** 渠道/模型引用（detail VO 内嵌形态；available 为可用性标注） */
export interface ChannelRefVO {
  code: string
  name: string
  /** 渠道可用性标注（api-channel.md §4.4 detail「含渠道可用性标注」） */
  available?: boolean
}

/** 分任务档位（api-channel.md §4.1 preferenceMap 值形态 + available 标注） */
export interface TierPreferenceVO {
  channelCode?: string
  channelName?: string
  modelCode?: string
  modelName?: string
  /** 档位可用性标注（PageSpec settings.md §4） */
  available?: boolean
}

/** channel.preference/detail VO（api-channel.md §4.4） */
export interface PreferenceDetailVO {
  preferenceId?: string
  defaultChannel?: ChannelRefVO
  defaultModel?: ChannelRefVO
  preferenceMap?: Partial<Record<PreferenceTaskType, TierPreferenceVO>>
  /** 平台兜底渠道（只读展示） */
  fallbackChannel?: ChannelRefVO
}

/** channel.preference/save AO（api-channel.md §4.4；空值=清除档位回落默认） */
export interface PreferenceSaveAO {
  defaultChannelCode: string
  defaultModelCode: string
  preferenceMap: Record<PreferenceTaskType, { channelCode: string; modelCode: string } | null>
}

// ---------------------------------------------------------------
// 用量统计（channel.usage/summary）
// ---------------------------------------------------------------

/** 统计维度枚举值（api-channel.md §4.4 AO dimension 契约常量；channel 域无字典端点） */
export const USAGE_DIMENSION = {
  CHANNEL: 'CHANNEL',
  DECK: 'DECK',
  TASK_TYPE: 'TASK_TYPE',
} as const

export type UsageDimension = (typeof USAGE_DIMENSION)[keyof typeof USAGE_DIMENSION]

/** 维度单选选项（契约枚举值 + 查询区文案；非字典，同 gen LENGTH_OPTIONS 先例） */
export const USAGE_DIMENSION_OPTIONS: { value: UsageDimension; label: string }[] = [
  { value: USAGE_DIMENSION.CHANNEL, label: '按渠道' },
  { value: USAGE_DIMENSION.DECK, label: '按创作物' },
  { value: USAGE_DIMENSION.TASK_TYPE, label: '按任务类型' },
]

/** timeRange 跨度上限（api-channel.md §4.4「≤12 个月」INV 口径） */
export const USAGE_RANGE_MAX_MONTHS = 12

/** 默认查询区间：近 6 个月（页面初始值，在上限内自选） */
export const USAGE_RANGE_DEFAULT_MONTHS = 6

/** usage/summary 行 VO（api-channel.md §4.4） */
export interface UsageSummaryRow {
  dimKey: string
  dimName: string
  taskCount: number
  promptTokens: number
  completionTokens: number
  lastUsedAt?: string
}

/**
 * usage/summary VO：rows + total。
 * 注意：该端点为 rows 而非引擎标准 records（API 设计文档原文），故用量
 * Tab 不经 useListPage（其固定读 PageResult.records），在组件内做适配。
 */
export interface UsageSummaryVO {
  rows: UsageSummaryRow[]
  total: number
}

// ---------------------------------------------------------------
// 账户与同步（auth.account/profile、auth.sync/pull）
// ---------------------------------------------------------------

/**
 * auth.account/profile VO。email/nickname 来源 PageSpec settings.md §6
 * 「账户信息：email/昵称」；syncCursor 为登录 VO 同名字段（api-platform.md
 * §4.4）在资料端的合理回显——后端契约未明示，TODO 请确认：若资料端不
 * 返回，多端同步区以本地跟踪游标展示。
 */
export interface AccountProfileVO {
  accountId?: string
  email?: string
  nickname?: string
  // TODO 请确认：profile VO 是否携带 syncCursor（多端同步区「当前游标」展示）
  syncCursor?: number
}

/** auth.sync/pull 变更条目（api-platform.md §4.4） */
export interface SyncChangeVO {
  aggregate: string
  op: string
  id: string
  cursor: number
  payload?: string
}

/** auth.sync/pull VO（api-platform.md §4.4） */
export interface SyncPullVO {
  changes: SyncChangeVO[]
  newCursor: number
  newPosition?: string
  hasMore: boolean
}
