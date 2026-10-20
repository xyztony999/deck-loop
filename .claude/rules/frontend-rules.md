# Vue3 引擎栈 — 前端规则（frontend-rules，3-in-1）

> **层级**：L2 技术栈 profile。激活含本栈的业务 profile 时由挂载机制生效。
> 本文件合并自：scm-frontend-coding-rules（编码强约束）+ scm-ui-ue-rules（UI/UX 关键规则）+ scm-ui-checklist.yaml（UI 检查清单）。
> **原 G2 前端条目覆盖对照**（编号不重复维护，内容以本文件+selfcheck 为准）：G2-70~74（引擎用法）↔ 第一部分 §3.1/§3.4 + selfcheck F-10~14；G2-80~89（UI/UX）↔ 第二部分 + selfcheck F-21~31；G2-95~99（文件完整性）↔ selfcheck F-50~54；G2-100~111（特殊字段）↔ 第一部分 §3.7 + selfcheck F-32~44；G2-60~65 前端侧检查方法 ↔ selfcheck F-01~07。
> 三层拆分映射总表：`engine/02-profile-spec.md` §5。📎 参考示例（scm）：文中 `ScmXxx` 组件名/`srm.` 标识/`scm-frontend` 等专名来自 scm 参考实现（组件名是框架事实保留原样），项目级标识按 manifest 槽位替换。

---

# 第一部分：前端编码强约束

---

## 1.1 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Vue | 3.4+ | 组合式 API，`<script setup>` 风格 |
| TypeScript | 5.0+ | 全量类型约束 |
| Ant Design Vue | 4.x | 统一组件库 |
| Vite | 5.x | 构建工具 |
| Pinia | 最新 | 状态管理 |
| pnpm workspace | — | Monorepo 包管理 |

## 1.2 Vue 语法

- **强制** `<script setup>` + 组合式 API
- **禁止** Options API
- **禁止**在 `<template>` 中编写复杂表达式，须抽取为 `computed` 或方法

## 1.3 TypeScript

- 所有 `.ts` / `.vue` 文件须通过 `vue-tsc` 类型检查
- 页面 Schema 配置**必须**使用 `@scm/framework` 提供的类型定义
- **禁止** `any` 类型，除非标注 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 并附理由

## 1.4 组件导入

- 框架组件统一从 `@scm/framework` 导入
- **禁止**将框架组件复制到页面目录
- **禁止**从 `ant-design-vue` 直接导入组件（图标和 `message`/`Modal.confirm` 例外）

## 1.5 组件不感知页面

- 数据通过 `props` 或 `pageContext` **传入**
- 事件通过 `emit` **上报**
- **禁止**在框架组件中引入 `useRoute` / `useRouter`

---

## 2.1 文件组织

```
src/views/{domain}/{resource}/
  index.vue                  # 页面入口
  actions.ts                 # 接口调用配置
  {Module}List.config.ts     # 列表页 Schema
  {Module}Dialog.config.ts   # 弹窗表单 Schema
  {Module}Detail.config.ts   # 抽屉详情 Schema
```

- **禁止**跨模块引用 config 文件

## 2.2 页面入口（index.vue）

`index.vue` **只能**包含：引入 Schema + actions + 传入引擎 + 处理页面级事件

**禁止**：直接调用接口、手写页面结构、写业务逻辑

## 2.3 路由组织

- **路由**：前端静态配置；**菜单**：后端动态返回
- 两者分离，**禁止**前端根据菜单动态生成路由
- 面包屑由框架根据路由 `meta.title` 自动生成，**禁止**页面自行实现

---

## 3.1 引擎强制使用

| 页面类型 | 引擎 |
|---------|------|
| 列表页 | `ScmListPage` |
| 表单页 | `ScmCardPage` |
| 详情页 | `ScmCardPage` |
| 审批页 | `ScmCardPage` |
| 分步表单 | 多路由 `ScmCardPage` |
| 实时大厅 | `ScmHallPage` |
| 弹窗 | `ScmDialog` |
| 抽屉 | `ScmDrawer` |

- **禁止**直接使用 `<a-modal>` / `<a-drawer>`
- **禁止**手写页面骨架结构

## 3.2 Config 驱动

所有配置必须使用 `@scm/framework` 的 `define` 系列辅助函数：

```typescript
import { defineListPage, defineCardPage, defineHallPage, defineDialog, defineDrawer } from '@scm/framework'
```

- **禁止**在 template 中硬编码字段列表、表格列、查询条件

## 3.3 actions.ts 规范

- 使用 `defineModule` 包装，Action name 格式：`{module}.{resource}{Action}`
- 每个动作配置必须包含 `type` 字段
- URL 不含 `/api` 前缀，所有接口统一 `POST`
- 模块通过 `registerModule` 注册，**禁止**在卡片/组件中直接调用

## 3.4 两级卡片模型

| 卡片类型 | 模式 |
|---------|------|
| Detail / Form / Stat / Alert / Anchor / FlowGuide / Timeline | 简单卡片（受控），数据从 `pageContext` 读取 |
| List / Tree / Toolbar | 组合卡片（自治），配置 `action` 自主管理数据 |

- **简单卡片禁止**自行调用接口
- 跨卡片通信必须通过 `pageContext`，**禁止**卡片间直接传 props/emit

## 3.5 字典注册规范

- 字典动作名固定为 `dict.{dictType}`
- **禁止**硬编码字典选项列表
- **禁止**将字典 actions 放入业务模块

## 3.6 请求/响应字段规范

- 分页参数固定：`pageNum` / `pageSize`
- 列表数据统一使用 `records` 字段（**禁止** `list` / `data` / `items`）
- 行操作按钮通过后端 `operList` 驱动

---

## 3.7 特殊字段组件配置

### modalSelect（弹窗列表选择）

`ModalSelectFieldConfig` 的业务属性在字段配置**顶层**，**禁止**放入 `props` 对象内。

| 属性 | 层级 | 说明 |
|------|------|------|
| `listAction` | **顶层** | 弹窗内列表的 action 名称 |
| `listQueries` | **顶层** | 弹窗内查询条件 |
| `listColumns` | **顶层** | 弹窗内表格列定义 |
| `labelField` | **顶层** | Tag 展示取值的字段名 |
| `valueField` | **顶层** | 回填值的字段名 |
| `modalTitle` | **顶层** | 弹窗标题 |
| `modalWidth` | **顶层** | 弹窗宽度 |
| `multiple` | **顶层** | 是否多选（默认 `true`，单选设 `false`） |
| `layout` | **顶层** | `'list'`（纯列表）或 `'horizontal'`（左树右表） |
| `leftTree` | **顶层** | 左侧树配置（horizontal 布局时必填） |

`FieldConfig.props` 仅用于透传给底层 Ant Design 组件的渲染属性（如 `showSearch`、`filterOption`、`rows`、`precision`），**不承载** modalSelect 的业务逻辑配置。

**正确示例**：
```typescript
{ field: 'agencyCode', label: '代理机构', type: 'modalSelect', span: 1,
  labelField: 'label',
  valueField: 'value',
  modalTitle: '选择代理机构',
  modalWidth: 900,
  multiple: false,
  listAction: 'scheme.agencyOptions',
  listQueries: [
    { field: 'keyword', label: '代理机构名称', type: 'input' },
  ],
  listColumns: [
    { dataIndex: 'value', title: '编码', width: 130 },
    { dataIndex: 'label', title: '名称', width: 220, ellipsis: true },
  ],
}
```

**常见错误**：将 `listAction`、`listColumns` 等业务属性包裹在 `props: {}` 内，导致组件读取 `field.listAction` 时拿到 `undefined`，弹窗打开后静默不调接口（console 有 `[ModalSelectField] 加载列表失败` 日志）。

**modalSelect 值格式**：单选模式 `multiple: false` 时，`v-model` 值仍为 `any[]` 数组格式（如 `[{ value: 'A001', label: 'XX代理公司' }]`）。提交时需从数组中取 `[0]` 解出 value/label。

### treeSelect（树形下拉选择）

使用 `dict` 或 `optionsAction` 加载树形数据，通过 `props.showSearch` 开启搜索。不需 `labelInValue` 或 `fieldNames`（treeSelect 组件内置支持树形结构）。

```typescript
{ field: 'purchaseOrgCode', label: '采购组织', type: 'treeSelect', span: 1,
  dict: 'scheme.orgOptions',
  props: { showSearch: true },
  placeholder: '请选择采购组织',
}
```

### 下拉级联刷新（optionsAction + optionsParams + watch）

当字段 B 的选项依赖字段 A 的值时，字段 B 用 `optionsAction` + 响应式 `optionsParams`，在 `.vue` 中用 `watch` 联动。

原理：`useOptions` composable 对 `optionsParams` 做了 `deep: true` watch，响应式对象的属性变更会自动触发选项重新加载。

**config.ts** — 字段 B 声明 `optionsAction` + 空 `optionsParams: {}`：
```typescript
{ field: 'purchaseDeptId', label: '采购部门', type: 'select', span: 1,
  optionsAction: 'scheme.deptOptions',
  optionsParams: {},  // 运行时被替换为 reactive 对象
  props: { showSearch: true, filterOption: true, labelInValue: true },
}
```

**.vue** — 创建 reactive 对象替换 config 中的 `optionsParams`，watch 字段 A 变更：
```typescript
const deptParams = reactive<Record<string, any>>({})
// patch: 将 config 中的静态 {} 替换为响应式对象
const deptField = (schema.cards
  ?.find((c: any) => c.key === 'basic') as any)
  ?.config?.fields
  ?.find((f: any) => f.field === 'purchaseDeptId')
if (deptField) (deptField as any).optionsParams = deptParams

watch(() => pageRef.value?.formData?.purchaseOrgCode, (orgCode) => {
  deptParams.companyId = orgCode || ''
  // 级联清空：上游变更时清空下游已选值
  if (pageRef.value?.formData) {
    pageRef.value.formData.purchaseDeptId = undefined
  }
})
```

- **禁止**级联场景使用 `dict`（dict 在页面初始化时缓存，不支持运行时参数变更）
- **必须**使用 `optionsAction`（支持 `optionsParams` 动态传参）
- 参数名必须与后端接口一致（如 `companyId` 而非 `orgCode`），对照服务选择池文档确认

### ScmCardPage 分步表单

- `detailIdKey` 默认值为 `'id'`，若后端详情接口参数名不是 `id`（如 `schemeId`），**必须**显式传入 `detail-id-key="schemeId"`
- **禁止**在 `onMounted` 中手动调用详情接口 — 框架的 `loadAction` 已自动根据 `detailId` 加载
- 若子页面需从详情数据初始化本地状态，用 `watch` 监听 `pageRef.value?.pageContext?.detailData`，不用 `onMounted`

---

## 4.1 Mock 数据规范

- Mock 目录：`mock-server/modules/{module}.mjs`
- 名称类字段至少 2 条记录长度 >= 30 字符
- 金额字段覆盖从 0 到 8 位数
- 状态字段覆盖所有枚举值

---

# 第二部分：UI/UX 关键规则

> 从 scm-ui-ue-rules.md 提取 CRITICAL 和 HIGH 优先级规则。

---

## G-01 页面背景

页面主内容区背景 `#f4f5f7`，Card 白色 + `border-radius: 10px` + `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`。弹窗/抽屉内部不需要此灰色背景。

## G-02 字典/状态标签

状态字典必须用彩色 Tag 渲染（`colorTag: true` + 字典含 `color` 字段）。字典列必须绑编码字段（`dataIndex` 不带 Name 后缀）。

## G-03 金额显示

- 金额（总价/预算）：`CNY` 前缀 + 千位分隔 + 2 位小数，深红 `#cf1322`，`font-weight: 600`，右对齐
- 单价：`CNY` 前缀 + 8 位小数，深橙 `#d4380d`，`font-weight: 600`，右对齐

## G-04 禁止硬编码

禁止前端硬编码任何枚举选项 / 状态映射 / 判定文案 / options 静态数组。

## G-05 操作按钮

操作按钮可见性由后端 `operList` 驱动，禁止前端写 visible 函数。

## G-06 实际验证

列表/表单/详情改动必须启动 dev server 在浏览器实际跑一次再报告完成。

---

## 列表页规则

### 查询区

- L-Q-01: 查询字段 3 列布局，超过 6 字段折叠，按钮始终右对齐第 3 列
- L-Q-02: 字段顺序：业务单号 → 名称 → 业务分类 → 状态 → 机构 → 创建人 → 创建时间
- L-Q-03: 状态/字典类下拉用 dict 或 optionsAction，禁止 options:[] 静态数组

### 列表列

- L-C-01: 列顺序：序号→业务单号→编号/名称→业务分类→机构→状态→创建人→创建时间→操作
- L-C-02: 业务单号列 `fixed:'left'`，操作列 `fixed:'right'`，表格 `scroll.x:'max-content'`
- L-C-02b: 冻结连续性：左侧 fixed 从最左列连续到业务单号，中间不允许断开
- L-C-03: 业务单号列推荐 `type:'link'`，不要在操作列再放"查看"按钮
- L-C-04: 状态/字典列加 `colorTag: true`
- L-C-05: 名称/描述等长文本列加 `ellipsis: { rows: 2 }`
- L-C-06: 首列 `padding-left: 24px`，末列 `padding-right: 24px`
- L-C-07: 列宽：编码 120 / 名称 150-200 / 金额 120 / 日期 170 / 状态 90-100 / 操作 <=3:160 >3:180
- L-C-08: 总列数 <=8（除序号、操作）

### 操作列

- L-A-01: 内联前 2 个高频，>3 个折叠到"更多"下拉
- L-A-02: 危险操作放下拉 + `danger: true` + confirm 文案

---

## 表单页规则

- F-01: sticky 标题栏，按钮顺序：暂存→上一步→下一步/提交→取消
- F-02: 字段 3 列布局（`itemsPerRow:3`），textarea/upload 自动占满行
- F-03: 备注 + 附件必须在"基本信息"Card 末尾，不得单独拆"附件信息"Card
- F-04: Card 数 >= 3 自动开启悬浮锚点导航（Teleport 到 body）
- F-05: 长表单页使用 `ScmCardPage layout:'anchor'`

---

## 详情页规则

- D-01: sticky 标题栏 + 关闭按钮（`type:default`，最右侧）
- D-02: 字段空值统一显示 "-"，日期 YYYY-MM-DD HH:mm，字典走 colorTag
- D-03: 内嵌列表不分页或小分页 <=5 条，不加操作列

---

## 弹窗/抽屉规则

- M-01: Modal `maskClosable: false`，`destroyOnClose: true`
- M-02: 选择器底部：取消（默认）+ 确定（primary，未选时 disabled）
- M-03: 选择器禁止在操作列加"选择"按钮，只用首列复选框
- M-04: ScmDrawer/ScmDialog 拥有独立 pageContext，与父页面完全隔离

---

## Mock 数据约束

- MK-01: 列表 mock 至少 1 行长文本字段（>=30 字）触发 ellipsis 2 行截断
- MK-02: 状态字典 mock 含 color 字段，覆盖至少 3 种 color
- MK-03: operList 不返回与业务单号链接重复的"查看"按钮
- MK-04: 列表每行 mock 必须含 operList
- MK-05: 改完 mock-server 后必须重启 mock-server（Node ESM 缓存）
- MK-06: 字典列 mock 必须同时返回编码字段和 Name 字段

---

# 第三部分：UI 检查清单

> 从 scm-ui-checklist.yaml 转换为 Markdown checklist。每次前端 UI 改动后逐条核对。

---

## 全局

- [ ] G-01 页面主背景 #f4f5f7，Card 白色 + border-radius:10px + box-shadow
- [ ] G-02 状态字典用彩色 Tag 渲染（colorTag:true + 字典含 color 字段）
- [ ] G-02b 字典列绑编码字段（dataIndex 不带 Name 后缀）
- [ ] G-03 金额格式化：CNY 前缀 + 千位分隔 + 精度 + 颜色加粗
- [ ] G-04 禁止前端硬编码枚举选项/状态映射/判定文案
- [ ] G-05 操作按钮可见性由后端 operList 驱动
- [ ] G-06 改动必须启动 dev server 在浏览器实际跑一次

## 列表页

### 布局
- [ ] L-01 查询区/工具栏+列表 至少 2 张独立白卡片，卡片间 gap 12-16px
- [ ] L-02 状态页签在最顶上独立一张卡片

### 查询
- [ ] L-Q-01 查询字段 3 列布局，超过 6 字段折叠，按钮右对齐
- [ ] L-Q-02 查询字段顺序：业务单号→名称→业务分类→状态→机构→创建人→创建时间
- [ ] L-Q-03 状态/字典类下拉用 dict 或 optionsAction
- [ ] L-Q-04 字典 key 在 mock 数据中真实存在

### 列
- [ ] L-C-01 列顺序正确
- [ ] L-C-02 业务单号 fixed:'left'，操作列 fixed:'right'，表格 scroll.x:'max-content'
- [ ] L-C-02b 冻结连续性：左侧 fixed 从最左列连续
- [ ] L-C-03 业务单号列 type:'link'，不在操作列重复"查看"
- [ ] L-C-04 状态/字典列 colorTag:true
- [ ] L-C-05 长文本列 ellipsis:{rows:2}
- [ ] L-C-06 首列 padding-left:24px，末列 padding-right:24px
- [ ] L-C-07 列宽符合规范
- [ ] L-C-08 总列数 <=8

### 工具栏
- [ ] L-T-01 高度 40px，左侧主操作/右侧辅助
- [ ] L-T-02 批量删除等危险操作 danger:true

### 行操作
- [ ] L-A-01 内联前 2 个高频，>3 个折叠到"更多"
- [ ] L-A-02 危险操作放下拉 + danger:true + confirm 文案

## 表单页
- [ ] F-01 sticky 标题栏，按钮顺序正确
- [ ] F-02 字段 3 列布局，textarea/upload 自动占满行
- [ ] F-03 备注+附件在"基本信息"Card 末尾
- [ ] F-04 Card>=3 自动开启悬浮锚点导航（Teleport 到 body）
- [ ] F-05 长表单页使用 ScmCardPage layout:'anchor'

## 详情页
- [ ] D-01 sticky 标题栏 + 关闭按钮
- [ ] D-02 字段空值显示 "-"，日期格式，字典走 colorTag
- [ ] D-03 内嵌列表不分页或小分页 <=5 条

## 弹窗/抽屉
- [ ] M-01 Modal maskClosable:false，destroyOnClose:true
- [ ] M-02 选择器底部按钮正确
- [ ] M-03 选择器禁止操作列"选择"按钮
- [ ] M-04 ScmDialog/ScmDrawer 拥有独立 pageContext

## Mock 数据
- [ ] MK-01 列表 mock 至少 1 行长文本 >=30 字
- [ ] MK-02 状态字典 mock 含 color 字段
- [ ] MK-03 operList 不重复"查看"按钮
- [ ] MK-04 列表每行 mock 含 operList
- [ ] MK-05 改完 mock-server 必须重启
- [ ] MK-06 字典列 mock 同时返回编码字段和 Name 字段

## 完成前自检
- [ ] DOD-01 本次改动触及的章节，逐条对照 checklist
- [ ] DOD-02 启动 dev server 实际跑过 golden path + 至少 1 个边界场景
- [ ] DOD-03 列表页：fixed 列、ellipsis 截断、Tooltip、状态 Tag 颜色、操作列留白
- [ ] DOD-04 表单/详情/审批页：sticky 标题栏、锚点导航、空值显示、金额格式
- [ ] DOD-05 需求措辞与规范有冲突时主动反问
