# 编码约束

## 4.1 引擎强制使用

| 页面类型 | 引擎 | 说明 |
|---------|------|------|
| 列表页 | `ScmListPage` | 数据查询、批量管理 |
| 表单页 | `ScmCardPage` | 新增、编辑 |
| 详情页 | `ScmCardPage` | 只读查看 |
| 审批页 | `ScmCardPage` | 审批查看 + 操作 |
| 分步表单向导 | 多路由 `ScmCardPage`（无独立引擎） | 每步独立路由 + FlowGuideCard + schema.actions 控制跳转 |
| 实时大厅 | `ScmHallPage` | 全屏 + 推送/定时器 + 角色视图分发 |
| 弹窗 | `ScmDialog` | 数据选择、简单表单 |
| 抽屉 | `ScmDrawer` | 信息展示 / 审批操作 |

- **禁止**直接使用 `<a-modal>` / `<a-drawer>`，必须通过 `ScmDialog` / `ScmDrawer` 引擎
- **禁止**手写页面骨架结构
- **弹窗/抽屉**拥有独立 `pageContext`，与父页面完全隔离；通过 `params` prop 传入数据，通过 `success` 事件回传结果

## 4.2 Config 驱动

页面通过 Schema 配置渲染，引擎根据配置自动生成页面结构。

- 列表页：`columns: []` 定义表格列，`queries: []` 定义查询条件
- 表单/详情页：`cards: [{ type: 'form'/'detail'/'list'/..., fields: [...] }]` 定义卡片和字段
- **禁止**在 template 中硬编码字段列表、表格列、查询条件

## 4.3 actions.ts 规范

```typescript
import { defineModule } from '@scm/framework'

export const orderModule = defineModule({
  name: 'order',
  actions: {
    'order.list':   { type: 'list',   url: '/purchase/order/list',   method: 'POST' },
    'order.detail': { type: 'detail', url: '/purchase/order/detail', method: 'POST' },
    'order.save':   { type: 'save',   url: '/purchase/order/save',   method: 'POST' },
    'order.delete': { type: 'delete', url: '/purchase/order/delete', method: 'POST' },
  }
})
```

- Action name 格式：`{module}.{resource}{Action}` 驼峰式
- 每个动作配置必须包含 `type` 字段（`list` / `detail` / `save` / `delete` / `dict` / `export`）
- 路径格式：`/{domain}/{resource}/{action}`，不含 `/api` 前缀
- URL 支持 `{变量名}` 占位符，请求时自动替换
- 所有接口统一 `POST`（文件下载除外）
- 同一模块 actions 放在同一个 `defineModule` 中
- 模块在 `index.vue` 挂载时通过 `registerModule(module.name, module.actions)` 注册
- Actions 在 index.vue 中通过引擎事件统一处理，**禁止**在卡片/组件中直接调用

## 4.4 引擎事件处理

不同引擎监听不同事件，**禁止**混用：

| 引擎 | 事件 | 用途 |
|------|------|------|
| `ScmListPage` | `@toolbar-click` | 工具栏按钮（新增/导出等） |
| `ScmListPage` | `@row-click` | 行操作按钮（编辑/删除等） |
| `ScmCardPage` | `@action` | 页面级操作按钮 |
| `ScmCardPage` | `@card-event` | 卡片内部事件（如 list card 的行点击） |
| `ScmHallPage` | `@stage-change` / `@action` / `@hall-ready` / `@hall-close` | 阶段变更/用户操作/初始化完成/大厅关闭 |
| `ScmDialog` | `@success` | 提交成功回调 |
| `ScmDrawer` | `@success` | 提交成功回调 |

## 4.5 两级卡片模型

| 卡片类型 | 模式 | 数据管理 |
|---------|------|---------|
| Detail / Form / Stat / Alert / Anchor / FlowGuide / Timeline | **简单卡片**（受控） | 数据从 `pageContext` 读取，事件 emit 上报 |
| List / Tree / Toolbar | **组合卡片**（自治） | 配置 `action` 自主管理数据循环，关键结果写入 `pageContext` |

- **简单卡片禁止**自行调用接口获取数据
- **组合卡片**通过 pageContext 暴露内部关键状态（如 `selectedTreeNode`、`selectedListRows`）

## 4.6 PageContext

页面通过 PageContext 实现跨卡片数据共享。

```typescript
// index.vue — 创建并注入
const ctx = createPageContext({
  loadAction: 'order.detail',
  submitAction: 'order.save',
})
providePageContext(ctx)

// 卡片内 — 消费
const ctx = usePageContext()
```

**PageContext 接口**：
```typescript
interface PageContext {
  detailData: Record<string, any>
  selectedTreeNode?: string
  selectedListRows?: any[]
  activeTabKey?: string
  formData?: Record<string, any>
  [key: string]: any
  getData(key: string): any
  setData(key: string, value: any): void
  onDataLoaded(callback: (data: any) => void): void
}
```

**跨卡片联动**：卡片 A 写入 -> 卡片 B watch 自动响应。
- 跨卡片通信必须通过 `pageContext`，**禁止**卡片间直接传 props/emit

**HallPageContext**（大厅专用）：
```typescript
interface HallPageContext extends PageContext {
  currentStage: string
  stageList: StageConfig[]
  pushData: Record<string, any>
  connectStatus: 'connected' | 'disconnected' | 'reconnecting'
  role: 'host' | 'supplier' | 'expert'
  globalTimer: number
  sendAction(action: string, payload: any): Promise<void>
  subscribe(key: string, callback: (data: any) => void): void
}
```

## 4.7 字典注册规范

字典动作名固定为 `dict.{dictType}`，按页面注册，不放入全局。

```typescript
// actions.ts 中声明
export const dictActions = {
  'dict.orderStatus': { type: 'dict', url: '/purchase/dict/batch', method: 'POST', defaultParams: { keys: ['orderStatus'] } },
  'dict.orderType':   { type: 'dict', url: '/purchase/dict/batch', method: 'POST', defaultParams: { keys: ['orderType'] } },
}

// 页面中注册并使用
getActionExecutor().registerModule('dict', dictActions)
const dict = useDict(['orderStatus', 'orderType'])
```

- **禁止**硬编码字典选项列表
- **禁止**将字典 actions 放入业务模块（必须放入 `dict` 模块下）
- 同 URL 的多个 key 由 `useDict` 内部自动合并为一次 `POST` 请求

## 4.7b 外部数据源选择池

前端 select/treeSelect 需要获取外部域数据时，按以下优先级选择数据源：

| 优先级 | 方式 | Action 命名 | 说明 |
|--------|------|------------|------|
| **1（首选）** | 服务选择池 | `srm.{resource}.xxxOptions` | 本域 Controller 直接提供 `List<SelectOption>`，后端自行调用关联域接口聚合数据 |
| **2（兜底）** | Proxy 代理 | `srm.proxy.xxx` | 通过 ProxyController 转发到外部域。**为保留能力，不建议常规使用** |

**选择池接口规范**：
- URL 格式：`/{domain}/{resource}/{action}-options` 或 `/{domain}/{resource}/available-{action}`
- 响应格式：`Result<List<SelectOption>>`
- 前端用 `dict: 'srm.{resource}.xxxOptions'` 引用

**Proxy 使用约束**：
- Proxy 仅在选择池无法覆盖时使用（如数据必须从外部域实时获取、本域无对应服务）
- 新增 Proxy action 需在代码评审中说明为何选择池不可替代
- 已有的 Proxy action 在对应选择池接口上线后应逐步迁移

```typescript
// ✅ 首选：服务选择池
{ field: 'companyId', type: 'select', dict: 'srm.serviceRel.availableCompanyOptions' }

// ⚠️ 兜底：Proxy 代理（需说明理由）
{ field: 'recommendCompanyId', type: 'select', dict: 'srm.proxy.companyOptions' }
```

## 4.8 请求/响应字段规范

**查询请求**：
```json
{
  "pageNum": 1, "pageSize": 20,
  "memberName": "", "status": "",
  "createTimeArr": ["2026-04-01", "2026-04-30"],
  "tabKey": "pending"
}
```

- 分页参数固定：`pageNum` / `pageSize`
- 日期范围字段：`{fieldName}Arr` 数组格式，框架自动拆分为 `{fieldName}Start` + `{fieldName}End` 发送给后端（见下方 dateRange 转换规则）
- Tab 筛选：`tabKey`

**dateRange 自动转换规则**：

前端 query schema 中 `type: 'dateRange'` 的字段，框架在发送请求前自动拆分并补全时间，页面开发者无需手动处理：

| 前端 schema 字段 | 用户选择的值 | 框架转换后发送给后端 |
|---|---|---|
| `{ field: 'createTimeArr', type: 'dateRange' }` | `["2026-04-01", "2026-04-30"]` | `createTimeStart: "2026-04-01 00:00:00"` + `createTimeEnd: "2026-04-30 23:59:59"` |

规则：
- 前端字段命名**必须**以 `Arr` 结尾（如 `createTimeArr`、`deliveryDateArr`），去掉 `Arr` 后拼接 `Start`/`End` 即为后端字段名
- Start 自动补全 `00:00:00`，End 自动补全 `23:59:59`
- 清空日期范围后不发送 Start/End 字段
- 该转换在列表查询（useScmList）和表单提交（useScmForm / ScmFormPage）中均自动生效

**标准列表响应**：
```json
{
  "code": "SUCCESS",
  "data": {
    "records": [], "total": 100,
    "pageNum": 1, "pageSize": 20, "pages": 5
  }
}
```

- 列表数据统一使用 `records` 字段（**禁止**使用 `list` / `data` / `items`）
- 多 Tab 列表额外返回 `tabs: [{ key, label, count? }]`

**行操作按钮（operList）**：后端在每行数据中返回 `operList`，框架自动渲染到操作列。

## 4.9 生成时禁止规则

| # | 禁止 | 正确做法 |
|---|------|----------|
| 1 | 编造 PageSpec 中未出现的 action name、URL、字段 | 只从 PageSpec 提取，不确定写 `// TODO: 请确认` |
| 2 | 在 ScmListPage 中用 `hasRowAction: true` | 用 `{ dataIndex: '__action__', type: 'action' }` + `rowActions` |
| 3 | 在 ScmCardPage ListCard 中用 `__action__` 列 | 用 `hasRowAction: true` |
| 4 | 给 ScmCardPage 传 `:show-actions` prop | 此 prop 不存在，标题和按钮由 schema 控制 |
| 5 | ScmListPage 事件用 `@row-action` | 事件名是 `@row-click` |
| 6 | 硬编码字典 options | 用 `dict: '{dictType}'` |
| 7 | 在 actions.ts 的 URL 中加 `/api` 前缀 | 全局 baseURL 自动补，但 upload 的 `props.action` 需写 `/api/upload` |
| 8 | 审批页用两个按钮（通过/驳回） | 用 `radio` + `dict` + 单提交按钮 |
| 9 | 审批结果写死 `options` | 必须用 `dict: 'approval_result'` |
| 10 | 使用已废弃的引擎/组件 | ScmDetailPage -> ScmCardPage, ScmFormPage -> ScmCardPage, ScmFormDialog -> ScmDialog 等 |

## 4.10 Mock 数据规范

- Mock 数据目录：`mock-server/modules/{module}.mjs`
- 名称类字段至少 2 条记录长度 >= 30 字符
- 金额字段使用数字类型，值覆盖从 0 到 8 位数
- 状态字段覆盖所有枚举值
