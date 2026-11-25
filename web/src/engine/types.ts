/**
 * deck-loop 引擎层共享类型。
 *
 * 形态与后端 deck-loop-share-common 契约逐字段对齐：
 * - Result<T>          share/common/model/Result.java
 * - PageResult<T>      share/common/model/PageResult.java（records/total/pageNum/pageSize）
 * - SelectOption       share/common/model/SelectOption.java（value/label）
 * - OperItem           core/vo/{domain}/OperItem.java（code/label/style）
 */

// ---------------------------------------------------------------
// 后端统一信封
// ---------------------------------------------------------------

/** 统一返回格式（status=true 时 code 固定 "0"） */
export interface Result<T = unknown> {
  status: boolean
  /** "0" = 成功；失败为错误码（如 BIZ_AUTH_CREDENTIALS / "500"） */
  code: string
  msg: string
  data: T
  timestamp: number
}

// 分页返回 PageResult<T> 定义在 ./pagination.ts（useListPage 配套）

/** 下拉选项（选择池 / 字典项基础形态） */
export interface SelectOption {
  value: string
  label: string
}

/** 行操作按钮（后端每行 operList 返回，规约 §4.8；style="danger" 为危险操作） */
export interface OperItem {
  code: string
  label: string
  style?: string
}

// ---------------------------------------------------------------
// Action 注册表（actions.ts 契约，规约 §4.3）
// ---------------------------------------------------------------

/** 动作类型（每个动作配置必须包含 type 字段，规约 §4.3） */
export type ActionType =
  | 'list'
  | 'detail'
  | 'save'
  | 'delete'
  | 'dict'
  | 'export'
  | 'upload'
  | 'other'

/**
 * 动作定义。URL 不含 /api 前缀（规则 8），支持 `{变量名}` 占位符
 * （executeAction 的 pathParams 自动替换）。
 */
export interface ActionDef {
  /** action key，格式 `{module}.{resource}{Action}` 驼峰式，如 deck.deckList */
  key: string
  method: 'POST' | 'GET'
  /** 路径格式 /{domain}/{resource}/{action}，不含 /api 前缀 */
  path: string
  type: ActionType
}

/** 按钮型动作配置（工具栏 / rowActions / 页面操作按钮共用） */
export interface ActionConfig {
  /** 操作码（与后端 operList[].code 对齐，如 edit/delete/finalize） */
  key: string
  /** 显示名 */
  label: string
  /** 危险操作（红色，下拉折叠，规约 §5.6） */
  danger?: boolean
  /** 二次确认文案；danger 操作必须提供 */
  confirm?: string
}

// ---------------------------------------------------------------
// 字典
// ---------------------------------------------------------------

/** 字典项：SelectOption + 可选 color（colorTag 渲染用，规约 §5.4） */
export interface DictItem extends SelectOption {
  color?: string
}

/** dict/batch 响应：{ [dictKey]: DictItem[] } */
export type DictMap = Record<string, DictItem[]>
