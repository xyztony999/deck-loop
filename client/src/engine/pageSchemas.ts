/**
 * 页面引擎 Schema 类型（DlListPage / DlCardPage / DlDetailPage 的 config 契约）。
 *
 * 参考 frontend-specs 03-code-templates 的 defineListPage/defineCardPage
 * schema 思想，deck-loop 轻量等价：config 对象驱动，F2-F4 生成页面时
 * 只写 config + 页面事件，禁止手写页面骨架。
 */
import type { ActionConfig, OperItem } from './types'

// ---------------------------------------------------------------
// DlListPage
// ---------------------------------------------------------------

export type QueryFieldType = 'input' | 'select' | 'dateRange' | 'date' | 'number'

/** 查询条件字段（规约 §5.2：3 列布局，dateRange 占 2 列） */
export interface QueryFieldConfig {
  /** 查询字段名；dateRange 类型必须以 Arr 结尾（§4.8） */
  field: string
  label: string
  type?: QueryFieldType
  /** select 的字典 key（经 useDict 拉取，禁止 options 硬编码） */
  dictKey?: string
  placeholder?: string
  /** 占列数：1（默认）| 2（dateRange 默认） */
  span?: 1 | 2
}

export type ColumnType =
  | 'seq' // 序号
  | 'text'
  | 'link' // 业务单据编码链接列（fixed left）
  | 'dict' // 字典/状态列（绑编码字段，不带 Name 后缀）
  | 'amount' // 金额（CNY 2 位，深红加粗右对齐）
  | 'unitPrice' // 单价（CNY 8 位，深橙加粗右对齐）
  | 'datetime' // 日期时间 YYYY-MM-DD HH:mm
  | 'action' // 操作列（dataIndex 固定 '__action__'）

/** 列配置（规约 §5.5 列宽/对齐/截断由 F2-F4 在 config 中按字段类型给出） */
export interface ColumnConfig {
  dataIndex: string
  title: string
  type?: ColumnType
  width?: number | string
  align?: 'left' | 'center' | 'right'
  fixed?: 'left' | 'right'
  /** true=单行截断；{ rows: 2 }=两行截断+悬浮气泡 */
  ellipsis?: boolean | { rows?: number }
  /** type=dict 必填：字典 key */
  dictKey?: string
  /** 字典列渲染彩色 Tag（§5.4） */
  colorTag?: boolean
}

export type ListViewMode = 'table' | 'card' | 'both'

/** DlListPage 配置 */
export interface DlListPageConfig {
  title?: string
  /** 列表 action key（必填，PageResult 响应） */
  listAction: string
  /** 字典接口域（deck/gen/adjust/ver/deliver/asset/channel） */
  domain: string
  queryFields?: QueryFieldConfig[]
  /** 查询区默认显示行数（默认 2，§5.2） */
  defaultRowCount?: number
  columns: ColumnConfig[]
  /** 工具栏按钮 */
  toolbar?: ActionConfig[]
  /**
   * 行操作兜底配置。后端行 operList 存在时优先 operList 驱动（规则 6，
   * 禁止前端写 visible 判断）；rowActions 仅供后端尚未返回 operList 的过渡。
   */
  rowActions?: ActionConfig[]
  rowSelection?: boolean
  /** 行 key 字段（默认 'id'） */
  rowKey?: string
  /** 表格/卡片视图；card 视图内容经 #card 插槽渲染 */
  viewMode?: ListViewMode
  defaultPageSize?: number
}

// ---------------------------------------------------------------
// DlCardPage（steps 向导容器）
// ---------------------------------------------------------------

export type FormFieldType =
  | 'input'
  | 'textarea'
  | 'number'
  | 'select'
  | 'date'
  | 'radio'
  | 'upload'
  | 'hidden'

/** 表单/详情字段配置 */
export interface DlFieldConfig {
  field: string
  label: string
  type?: FormFieldType
  required?: boolean
  /** select/radio 字典 key（禁止 options 硬编码） */
  dictKey?: string
  placeholder?: string
  /** 1=三分之一行（默认）| 2 | 3 | 'full'（textarea/upload 默认独占一行） */
  span?: 1 | 2 | 3 | 'full'
  /** 透传给底层 Antd 组件的渲染属性 */
  props?: Record<string, unknown>
}

export type DlCardType = 'form' | 'detail' | 'list' | 'alert' | 'flow'

/** 向导步骤内的卡片 */
export interface DlCardSchema {
  key: string
  title: string
  type: DlCardType
  /** form / detail 卡片字段 */
  fields?: DlFieldConfig[]
  /** list 卡片列（复用 ColumnConfig，禁用 action 列） */
  columns?: ColumnConfig[]
  /** list 卡片数据（自治数据可经 slot 覆盖） */
  items?: Record<string, unknown>[]
  /** alert 卡片 */
  alertType?: 'info' | 'warning' | 'error' | 'success'
  alertMessage?: string
}

/** 向导步骤 */
export interface DlStepSchema {
  key: string
  title: string
  description?: string
  cards: DlCardSchema[]
  /** 进入下一步前校验钩子，返回 false 阻止 */
  beforeNext?: (formData: Record<string, unknown>) => Promise<boolean> | boolean
  /** 条件跳过该步 */
  skip?: (formData: Record<string, unknown>) => boolean
}

/** DlCardPage 配置 */
export interface DlCardPageConfig {
  title: string
  steps: DlStepSchema[]
  /** 字典接口域（form select/radio 字典拉取；无字典字段可不填） */
  domain?: string
  /** 编辑态详情加载 action（配合 detailId） */
  loadAction?: string
  /** 详情接口 id 参数名（默认 'id'；非 id 时必须显式传，selfcheck F-17） */
  detailIdKey?: string
  /** 暂存 action */
  saveDraftAction?: string
  /** 提交 action */
  submitAction?: string
}

// ---------------------------------------------------------------
// DlDetailPage
// ---------------------------------------------------------------

export type DetailFieldType =
  | 'text'
  | 'dict'
  | 'datetime'
  | 'amount'
  | 'unitPrice'

export interface DlDetailField {
  field: string
  label: string
  type?: DetailFieldType
  dictKey?: string
}

export interface DlDetailBlock {
  key: string
  title: string
  fields: DlDetailField[]
}

/** DlDetailPage 配置（区块 >=3 自动启用悬浮锚点，§5.8） */
export interface DlDetailPageConfig {
  title: string
  blocks: DlDetailBlock[]
}

// ---------------------------------------------------------------
// 行数据（operList 约定）
// ---------------------------------------------------------------

/** 列表行 VO 基础形态（行操作由后端 operList 驱动，规约 §4.8） */
export interface RowWithOperList extends Record<string, unknown> {
  operList?: OperItem[]
}
