# 代码生成模板

## 3.1 引擎组件速查

| 页面类型 | 引擎 | 说明 |
|---------|------|------|
| 列表页 | `ScmListPage` | 数据查询、批量管理 |
| 表单页 | `ScmCardPage` | 新增、编辑 |
| 详情页 | `ScmCardPage` | 只读查看 |
| 审批页 | `ScmCardPage` | 审批查看 + 操作 |
| 分步表单向导 | `ScmStepFormPage` | 步骤编排 + per-step 校验 + 条件跳过 |
| 实时大厅 | `ScmHallPage` | 全屏 + 推送/定时器 + 角色视图分发 |
| 弹窗 | `ScmDialog` | 数据选择、简单表单 |
| 抽屉 | `ScmDrawer` | 信息展示 / 审批操作 |

Config 驱动使用 `define` 系列辅助函数：

| 引擎 | 辅助函数 | 返回类型 |
|------|---------|---------|
| `ScmListPage` | `defineListPage(schema)` | `ListPageSchema` |
| `ScmCardPage` | `defineCardPage(schema)` | `CardPageSchema` |
| `ScmHallPage` | `defineHallPage(schema)` | `HallPageSchema` |
| `ScmDialog` | `defineDialog(schema)` | `DialogSchema` |
| `ScmDrawer` | `defineDrawer(schema)` | `DrawerSchema` |
| `ScmStepFormPage` | `defineStepFormPage(schema)` | `StepFormPageSchema` |

## 3.2 ScmListPage

**ListPageSchema 结构**:
```typescript
{
  title: string
  queries?: QueryFieldConfig[]     // 查询条件
  columns: ColumnConfig[]          // 列定义，操作列用 { dataIndex: '__action__', type: 'action' }
  toolbar?: ToolbarConfig[]        // 工具栏按钮
  rowActions?: ActionConfig[]      // 行操作按钮（与 __action__ 列配合）
  actions: {                       // 嵌套结构，不是平级 action
    list: string                   // 列表接口 action name（必填）
    save?: string
    delete?: string
    export?: string
  }
  tabs?: TabConfig
  rowSelection?: boolean | { type: 'checkbox'|'radio'; onChange?: (...) => void }
}
```

**事件**:
| 事件名 | 参数 | 说明 |
|--------|------|------|
| `toolbar-click` | `(btn: ToolbarConfig)` | 工具栏按钮点击 |
| `row-click` | `(btn: ActionConfig, row: any)` | 行操作按钮点击 |
| `selection-change` | `(keys: string[], rows: any[])` | 选择变更 |

**Expose**: `refresh()`, `handleSearch()`, `handleReset()`

## 3.3 ScmCardPage

**CardPageSchema 结构**:
```typescript
{
  title: string
  layout: 'vertical' | 'horizontal' | 'anchor' | 'tab'
  loadAction?: string
  submitAction?: string
  cards?: CardSchema[]
  leftCard?: CardSchema                   // horizontal 布局左侧
  rightCards?: CardSchema[]               // horizontal 布局右侧
  anchorCard?: CardSchema & { config?: AnchorCardConfig }
  tabs?: { key: string; label: string }[]
  actions?: ActionConfig[]                // 页面顶部操作按钮
}
```

**事件**:
| 事件名 | 参数 | 说明 |
|--------|------|------|
| `action` | `(action: ActionConfig, data: any)` | 页面级操作按钮 |
| `card-event` | `(cardKey, event, payload)` | 卡片内部事件 |
| `success` | `(data: any)` | 提交成功 |
| `cancel` | `()` | 取消 |

**Expose**: `reload()`, `pageContext`, `formData`, `handleSubmit()`

## 3.4 ScmStepFormPage

**StepFormPageSchema 结构**:
```typescript
{
  title: string
  steps: {
    key: string
    title: string
    description?: string
    cards: CardSchema[]
    skipCondition?: (ctx: PageContext) => boolean
    beforeNext?: (ctx: PageContext) => Promise<boolean>
  }[]
  loadAction?: string
  saveDraftAction?: string
  submitAction?: string
  initialStepStatus?: number
}
```

**按钮逻辑**:
| 按钮 | 可见条件 | 行为 |
|------|---------|------|
| 暂存 | 始终可见 | 不校验必填，保存草稿停留当前步 |
| 上一步 | currentStep > 0 | 回退上一步 |
| 下一步 | currentStep < lastStep | 校验当前步 -> 前进 |
| 提交 | currentStep = lastStep 且全部步骤完成 | 全量校验 -> 提交 |

**Expose**: `goToStep(n)`, `getStepStatus()`, `getCurrentStep()`

## 3.5 ScmHallPage

**HallPageSchema 结构**:
```typescript
{
  title: string
  hallType: 'opening' | 'evaluation'
  role: 'host' | 'supplier' | 'expert'
  pushChannel: { type: 'websocket' | 'sse'; url: string }
  timers?: { key: string; action: string; interval: number }[]
  stages: {
    key: string
    title: string
    views: Record<string, CardSchema[]>
  }[]
  actions?: Record<string, ActionConfig>
}
```

使用独立 `HallPageContext`，通过 `useHallContext()` 消费。

## 3.6 ScmDialog

**DialogSchema 结构**:
```typescript
{
  title: string
  cards: CardSchema[]
  loadAction?: string
  createAction?: string
  submitAction?: string
  width?: number | string
}
```

Props: `schema`, `visible`(v-model), `params`, `editId`, `width`
Events: `update:visible`, `success`

## 3.7 ScmDrawer

**DrawerSchema 结构**:
```typescript
{
  title: string
  cards: CardSchema[]
  loadAction?: string
  submitAction?: string
  width?: number | string
}
```

Props: `schema`, `open`(v-model), `params`, `detailId`, `width`
Events: `update:open`, `success`
Expose: `reload()`, `pageContext`, `formData`

## 3.8 场景模板 — 列表页（ScmListPage）

**适用**：master_data 的标准列表+新建+编辑+删除。

**文件结构**：
```
views/{domain}/{resource}/
  index.vue
  {Module}List.config.ts
  {Module}Dialog.config.ts    （如需新建/编辑弹窗）
  {Module}Detail.config.ts    （如需详情抽屉）
  actions.ts
```

### {Module}List.config.ts

```typescript
import { defineListPage } from '@scm/framework'

export default defineListPage({
  title: '{模块名称}',
  defaultRowCount: 2,
  queries: [
    { field: '{field}', label: '{label}', type: 'input', placeholder: '请输入{label}' },
    { field: '{field}', label: '{label}', type: 'select', dict: 'dict.{dictType}' },
    { field: '{field}Arr', label: '{时间范围}', type: 'dateRange' },
  ],
  columns: [
    { dataIndex: 'index', title: '序号', width: 60, align: 'center', fixed: 'left',
      customRender: ({ index }: any) => index + 1 },
    { dataIndex: '{code}', title: '{编码}', width: 120, fixed: 'left', ellipsis: true,
      type: 'link', link: { mode: 'self', path: '/{domain}/{resource}/detail/{{id}}' } },
    { dataIndex: '{name}', title: '{名称}', width: 180, ellipsis: { rows: 2 } },
    { dataIndex: '{status}', title: '{状态}', width: 100, type: 'dict', dictType: '{dictType}', align: 'center' },
    { dataIndex: '{date}', title: '{日期}', width: 170, ellipsis: true },
    { dataIndex: '{amount}', title: '{金额}', width: 120, align: 'right' },
    // ScmListPage 操作列必须用 __action__
    { dataIndex: '__action__', title: '操作', type: 'action', width: 160, fixed: 'right' },
  ],
  toolbar: [
    { code: 'add', name: '新建', type: 'primary' },
  ],
  rowActions: [],
  actions: {
    list: '{module}.{resource}List',
    delete: '{module}.{resource}Delete',
  }
})
```

**关键规则**：
- 操作列用 `{ dataIndex: '__action__', type: 'action' }` + `rowActions`，**不是** `hasRowAction: true`
- `actions` 是嵌套对象 `{ list, save?, delete?, export? }`，**不是**顶级数组

### {Module}Dialog.config.ts

```typescript
import { defineDialog } from '@scm/framework'

export default defineDialog({
  title: '{模块名称}',
  width: 640,
  loadAction: '{module}.{resource}Detail',
  createAction: '{module}.{resource}Create',
  submitAction: '{module}.{resource}Update',
  cards: [
    {
      key: 'form',
      title: '基本信息',
      type: 'form',
      span: 24,
      config: {
        itemsPerRow: 2,
        fields: [
          { field: '{field}', label: '{label}', type: 'input',
            rules: [{ required: true, message: '请输入{label}' }] },
          { field: '{field}', label: '{label}', type: 'select', dict: '{dictType}' },
          { field: '{field}', label: '{label}', type: 'textarea', span: 1 },
        ]
      }
    }
  ]
})
```

### {Module}Detail.config.ts

```typescript
import { defineDrawer } from '@scm/framework'

export default defineDrawer({
  title: '{模块名称}详情',
  width: 800,
  loadAction: '{module}.{resource}Detail',
  cards: [
    {
      key: 'basic',
      title: '基本信息',
      type: 'detail',
      span: 24,
      config: {
        itemsPerRow: 2,
        fields: [
          { field: '{field}', label: '{label}' },
          { field: '{field}', label: '{label}', type: 'dict', dictType: '{dictType}' },
        ]
      }
    }
  ]
})
```

### index.vue（列表 + Dialog + Drawer 完整组合）

```vue
<template>
  <div class="{module}-page">
    <ScmListPage
      ref="listRef"
      :schema="listConfig"
      @toolbar-click="handleToolbarClick"
      @row-click="handleRowClick"
    />

    <ScmDialog
      :schema="dialogConfig"
      :visible="dialogVisible"
      :edit-id="editId"
      @update:visible="dialogVisible = $event"
      @success="listRef?.refresh()"
    />

    <ScmDrawer
      v-model:open="detailOpen"
      :schema="detailConfig"
      :detail-id="detailId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { ScmListPage, ScmDialog, ScmDrawer, getActionExecutor } from '@scm/framework'
import listConfig from './{Module}List.config'
import dialogConfig from './{Module}Dialog.config'
import detailConfig from './{Module}Detail.config'
import type { ToolbarConfig, ActionConfig } from '@scm/framework'

const listRef = ref()
const dialogVisible = ref(false)
const editId = ref<string | undefined>()
const detailOpen = ref(false)
const detailId = ref<string | undefined>()

function handleToolbarClick(btn: ToolbarConfig) {
  if (btn.code === 'add') {
    editId.value = undefined
    dialogVisible.value = true
  }
}

async function handleRowClick(btn: ActionConfig, row: any) {
  const executor = getActionExecutor()

  if (btn.code === 'edit') {
    editId.value = row.id
    dialogVisible.value = true
  } else if (btn.code === 'detail') {
    detailId.value = row.id
    detailOpen.value = true
  } else if (btn.code === 'delete') {
    Modal.confirm({
      title: '确认删除？',
      async onOk() {
        await executor.execute('{module}.{resource}Delete', { id: row.id })
        message.success('删除成功')
        listRef.value?.refresh()
      }
    })
  }
}
</script>
```

**关键规则**：
- ScmListPage 事件是 `@toolbar-click` 和 `@row-click`（不是 `@row-action`）
- ScmDialog 用 `:visible` + `@update:visible`
- ScmDrawer 用 `v-model:open` + `:detail-id`
- Dialog 成功后调用 `listRef?.refresh()` 刷新列表

## 3.9 场景模板 — 多标签统计列表页（ScmCardPage tab）

**适用**：business_doc 的订单列表、询价列表等"顶部统计 + Tab 状态切换 + 列表"页面。

```typescript
import { defineCardPage } from '@scm/framework'

export default defineCardPage({
  title: '{模块名称}',
  layout: 'tab',
  loadAction: '{module}.{resource}Stats',
  tabs: [
    { key: '',          label: '全部'   },
    { key: 'pending',   label: '待审批' },
    { key: 'approving', label: '审批中' },
    { key: 'approved',  label: '已通过' },
  ],
  actions: [
    { code: 'add', name: '新建', type: 'primary' },
  ],
  cards: [
    {
      key: 'stats', title: '执行概况', type: 'stat', span: 24,
      config: {
        items: [
          { label: '待审批', field: 'pendingCount',   color: '#fa8c16', icon: 'ClockCircleOutlined' },
          { label: '审批中', field: 'approvingCount', color: '#1890ff', icon: 'FileTextOutlined' },
          { label: '已通过', field: 'approvedCount',  color: '#52c41a', icon: 'CheckCircleOutlined' },
        ]
      }
    },
    {
      key: 'list', title: '列表', type: 'list', span: 24,
      config: {
        listAction: '{module}.{resource}List',
        hasPagination: true,
        hasTabFilter: true,
        hasToolbar: true,
        hasRowAction: true,          // ScmCardPage ListCard 用这个
        toolbar: [{ code: 'add', name: '新建', type: 'primary' }],
        tableColumns: [
          { dataIndex: '{field}', title: '{label}', width: 160 },
          // 不要加 __action__ 列！hasRowAction: true 已自动生成
        ],
      }
    },
  ]
})
```

**常见错误**：
| 错误 | 正确做法 |
|------|----------|
| `tableColumns` 中加 `__action__` 列 | 只设 `hasRowAction: true`，框架自动生成操作列 |
| ScmCardPage 中用 `@row-action` | 事件名是 `@action` |

## 3.10 场景模板 — 表单页（ScmCardPage anchor/vertical）

**适用**：供应商录入、合同编辑等多分组表单。

```typescript
import { defineCardPage } from '@scm/framework'

export default defineCardPage({
  title: '{模块名称}',
  layout: 'anchor',
  loadAction: '{module}.{resource}Detail',
  submitAction: '{module}.{resource}Save',
  actions: [
    { code: 'save', name: '保存', type: 'default' },
    { code: 'submit', name: '提交', type: 'primary' },
  ],
  anchorCard: {
    key: 'anchor', title: '导航', type: 'anchor', span: 24,
    config: { displayMode: 'fixed', collapsible: false }
  },
  cards: [
    {
      key: 'basic', title: '基本信息', type: 'form', span: 24,
      config: {
        itemsPerRow: 2,
        fields: [
          { field: '{field}', label: '{label}', type: 'input',
            rules: [{ required: true, message: '请输入{label}' }] },
          { field: '{field}', label: '{label}', type: 'select', dict: '{dictType}' },
        ]
      }
    },
    {
      key: 'attachment', title: '附件上传', type: 'form', span: 24,
      config: {
        itemsPerRow: 1,
        fields: [
          { field: 'attachments', label: '相关附件', type: 'upload', span: 1,
            props: { multiple: true, action: '/api/upload' } },
        ]
      }
    },
  ]
})
```

## 3.11 场景模板 — 审批页（ScmCardPage vertical）

**适用**：审批详情、合同审批等"提示 + 详情 + 审批意见"页面。

```typescript
import { defineCardPage } from '@scm/framework'

export default defineCardPage({
  title: '审批详情',
  layout: 'vertical',
  loadAction: '{module}.{resource}Detail',
  submitAction: '{module}.{resource}Approve',
  actions: [
    { code: 'submit', name: '提交审批', type: 'primary' },
  ],
  cards: [
    // Alert Card — 页面横幅
    {
      key: 'alertInfo', type: 'alert', span: 24,
      config: { alertType: 'warning', displayMode: 'alert', message: '当前申请正在等待您的审批。', closable: true }
    },
    // Detail Card — 申请详情
    {
      key: 'detail', title: '申请详情', type: 'detail', span: 24,
      config: { itemsPerRow: 3, fields: [
        { field: 'applyNo', label: '申请单号' },
        { field: 'title', label: '申请标题', span: 2 },
        { field: 'amount', label: '申请金额' },
      ]}
    },
    // Form Card — 审批意见
    {
      key: 'approval', title: '审批意见', type: 'form', span: 24,
      config: { itemsPerRow: 1, fields: [
        { field: 'approvalResult', label: '审批结果', type: 'radio', dict: 'approval_result',
          rules: [{ required: true, message: '请选择审批结果' }] },
        { field: 'approvalRemark', label: '审批意见', type: 'textarea', placeholder: '请输入审批意见',
          rules: [{ required: true, message: '请输入审批意见' }] },
        { field: 'attachments', label: '相关附件', type: 'upload',
          props: { multiple: true, action: '/api/upload' } },
      ]}
    },
  ]
})
```

**关键规则**：审批结果用 `radio` + `dict`，禁止硬编码 options，禁止用两个按钮。

## 3.12 场景模板 — 详情页（ScmCardPage vertical）

**适用**：合同详情、订单详情等多区域只读展示。

```typescript
import { defineCardPage } from '@scm/framework'

export default defineCardPage({
  title: '{模块名称}详情',
  layout: 'vertical',
  loadAction: '{module}.{resource}Detail',
  actions: [{ code: 'edit', name: '编辑', type: 'primary' }],
  cards: [
    { key: 'basic', title: '基本信息', type: 'detail', span: 24,
      config: { itemsPerRow: 3, fields: [
        { field: '{field}', label: '{label}' },
        { field: '{field}', label: '{label}', type: 'dict', dictType: '{dictType}' },
      ]}
    },
    { key: 'items', title: '明细', type: 'list', span: 24,
      config: {
        hasPagination: false, hasToolbar: true, hasRowAction: true,
        tableColumns: [/* ... */],
        listAction: '{module}.{resource}ItemList'
      }
    },
  ]
})
```

## 3.13 场景模板 — 左树右列表（ScmCardPage horizontal）

```typescript
import { defineCardPage } from '@scm/framework'

export default defineCardPage({
  title: '{模块名称}',
  layout: 'horizontal',
  leftCard: {
    key: 'tree', title: '分类', type: 'tree',
    config: {
      searchable: true,
      treeAction: '{module}.{resource}Tree',
      fieldNames: { key: 'id', title: 'name', children: 'children' }
    }
  },
  rightCards: [
    { key: 'list', title: '列表', type: 'list', span: 24,
      config: {
        listAction: '{module}.{resource}List',
        hasPagination: true, hasToolbar: true, hasRowAction: true,
        tableColumns: [/* ... */],
      }
    }
  ]
})
```

## 3.14 场景模板 — 分步表单向导（ScmStepFormPage）

**适用**：采购方案编制、投标编制等多步骤向导。

```typescript
import { defineStepFormPage } from '@scm/framework'

export default defineStepFormPage({
  title: '{模块名称}',
  loadAction: '{module}.{resource}Detail',
  saveDraftAction: '{module}.{resource}Save',
  submitAction: '{module}.{resource}Submit',
  steps: [
    {
      key: 'step1', title: '步骤一', description: '步骤说明',
      cards: [
        { key: 'step1Form', title: '步骤一信息', type: 'form',
          config: { itemsPerRow: 2, fields: [
            { field: 'name', label: '名称', type: 'input', rules: [{ required: true }] },
          ]}
        }
      ]
    },
    { key: 'step2', title: '步骤二', cards: [ /* 步骤二的卡片 */ ] },
    { key: 'confirm', title: '确认提交', description: '预览确认信息',
      cards: [
        { key: 'preview', title: '信息预览', type: 'detail',
          config: { itemsPerRow: 2, fields: [ /* 预览字段 */ ] }
        }
      ]
    }
  ]
})
```

**关键规则**：
- 步骤间数据通过 `pageContext` 共享（引擎内部管理）
- `skipCondition` 可实现条件跳过步骤
- 按钮逻辑由引擎根据 `step_complete_status` 位标记自动控制，**禁止**手动实现
- 暂存不校验必填，提交时全量校验

## 3.15 场景模板 — 实时大厅（ScmHallPage）

**适用**：开标大厅、评标大厅等全屏实时场景。

```typescript
import { defineHallPage } from '@scm/framework'

export default defineHallPage({
  title: '{大厅标题}',
  hallType: 'opening',
  role: 'host',
  pushChannel: { type: 'websocket', url: '/ws/{path}/{hallId}' },
  timers: [{ key: 'onlineCount', action: '{module}.onlineCount', interval: 30 }],
  stages: [
    {
      key: 'waiting', title: '等待阶段',
      views: {
        host: [ /* host 视图卡片 */ ],
        supplier: [ /* 供应商视图卡片 */ ],
        expert: [ /* 专家视图卡片 */ ]
      }
    },
  ],
  actions: {
    'startStage': { code: 'startStage', name: '开始', type: 'primary' },
    'endHall': { code: 'endHall', name: '结束', danger: true }
  }
})
```

**关键规则**：
- 使用独立 `HallPageContext`，通过 `useHallContext()` 消费
- 路由需配置 `layout: 'hall'` 使用全屏沉浸布局

## 3.16 actions.ts 生成模板

```typescript
import { defineModule } from '@scm/framework'

export const {module}Module = defineModule({
  name: '{module}',
  actions: {
    '{module}.{resource}List':    { type: 'list',   url: '/{domain}/{resource}/list',    method: 'POST' },
    '{module}.{resource}Detail':  { type: 'detail', url: '/{domain}/{resource}/detail',  method: 'POST' },
    '{module}.{resource}Create':  { type: 'save',   url: '/{domain}/{resource}/create',  method: 'POST' },
    '{module}.{resource}Update':  { type: 'save',   url: '/{domain}/{resource}/update',  method: 'POST' },
    '{module}.{resource}Delete':  { type: 'delete', url: '/{domain}/{resource}/delete',  method: 'POST' },
    '{module}.{resource}Submit':  { type: 'save',   url: '/{domain}/{resource}/submit',  method: 'POST' },
    '{module}.{resource}Stats':   { type: 'detail', url: '/{domain}/{resource}/stats',   method: 'POST' },
  }
})

export const {module}DictKeys = [
  '{dictType1}',
  '{dictType2}',
]
```

## 3.17 路由定义模板

```typescript
// src/router/modules/{domain}.ts
import type { RouteRecordRaw } from 'vue-router'

export default [
  {
    path: '/{domain}/{resource}',
    name: '{Module}List',
    component: () => import('@/views/{domain}/{resource}/index.vue'),
    meta: { title: '{模块名}', icon: '{IconName}' },
  },
] as RouteRecordRaw[]
```

## 3.18 Mock 模块模板

```javascript
// mock-server/modules/{module}.mjs
const pageResult = (list, pageNum = 1, pageSize = 20) => {
  const start = (pageNum - 1) * pageSize
  return {
    records: list.slice(start, start + pageSize),
    total: list.length,
    pageNum, pageSize,
    pages: Math.ceil(list.length / pageSize)
  }
}

function resp(data, code = 200, msg = '成功') {
  return { code, data, msg, success: true }
}

function computeOperList(row) {
  const ops = []
  if (['10', '40'].includes(row.bizStatus)) {
    ops.push({ code: 'edit', name: '编辑', type: 'link' })
  }
  ops.push({ code: 'detail', name: '查看', type: 'link' })
  if (row.bizStatus === '10') {
    ops.push({ code: 'submit', name: '提交审批', type: 'link', confirm: '确定提交审批？' })
  }
  if (['10', '40'].includes(row.bizStatus)) {
    ops.push({ code: 'delete', name: '删除', type: 'link', danger: true, confirm: '确定删除？' })
  }
  return ops
}

const handlers = {
  async '/api/{module}/{resource}/list'(req, res, body) {
    const { pageNum, pageSize } = body
    const list = items.map(s => ({ ...s, operList: computeOperList(s) }))
    return resp(pageResult(list, pageNum, pageSize))
  },
  async '/api/{module}/{resource}/detail'(req, res, body) {
    return resp(detailData)
  },
  async '/api/{module}/{resource}/create'(req, res, body) {
    return resp({ success: true })
  },
  async '/api/{module}/{resource}/update'(req, res, body) {
    return resp({ success: true })
  },
  async '/api/{module}/{resource}/delete'(req, res, body) {
    return resp({ success: true })
  },
}

export default handlers
```

## 3.19 业务类型适配

| 维度 | master_data | business_doc | application_doc |
|------|------------|-------------|----------------|
| 列表引擎 | ScmListPage | ScmCardPage layout:'tab' | ScmCardPage layout:'vertical' |
| 统计卡片 | 无 | Stat Card + loadAction | 无 |
| 新建/编辑 | ScmDialog 弹窗 | ScmCardPage 独立页 | ScmCardPage 独立页 |
| 详情 | ScmDrawer 抽屉 | ScmCardPage (含审批 Form Card) | ScmCardPage (含审批历史) |
| 审批结果 | — | radio + dict + 单提交 | radio + dict + 单提交 |
| operList | edit / delete | edit / submit / cancel (按状态) | edit / submit / withdraw (按状态) |

## 3.20 文件输出路径

| App | 路径 |
|-----|------|
| admin | `apps/admin/src/` |
| enterprise | `apps/enterprise/src/` |
| supplier | `apps/supplier/src/` |
| agency | `apps/agency/src/` |
| recycler | `apps/recycler/src/` |
| expert | `apps/expert/src/` |
| mall | `apps/mall/src/` |
| portal | `apps/portal/src/` |
