# UI/UX 规范

## 5.1 全局框架样式

**页面背景**：主内容区 `#f4f5f7`，Card 卡片 `#fff` + `border-radius: 10px` + `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`

**Card 通用样式**：
- 标题文字前蓝色小竖条（4px x 14px, `#6b8ab5`）
- 标题底部边框 `1px solid #dce3ed`
- 标题文字 `font-size: 14px` `font-weight: 600` `color: #1f2937`
- 内边距 `padding: 16px`

## 5.2 查询区域规则

| 规则 | 值 |
|------|---|
| 默认显示行数 | 2 行（6 字段），`defaultRowCount: 2` |
| 每行字段数 | 3 列（span=8） |
| 日期范围字段 | 占 2 列（span=16） |
| 按钮位置 | 始终在第 3 列，右对齐 |
| 超出折叠 | 点击"展开"显示全部 |
| 查询条件标签右对齐 | `justify-content: flex-end` |
| 查询卡片与结果卡片间距 | 12-16px |

**查询条件排列优先级**：编码 -> 编号/名称 -> 业务分类 -> 状态 -> 机构/部门 -> 创建人 -> 创建时间

## 5.3 金额/货币显示

**基础规则**：
1. 货币类型前缀：默认 `CNY`，格式 `CNY 1,234.56`
2. 金额精度：金额保留 2 位小数，单价保留 8 位小数
3. 千位分隔符：整数部分 >=4 位时添加
4. 右对齐：金额列 `align: 'right'`
5. 金额颜色与加粗：金额/总价 -> 深红 `#cf1322`，`font-weight: 600`；单价 -> 深橙 `#d4380d`，`font-weight: 600`

**列表列 customRender**：
```typescript
// 金额列（2 位小数，深红加粗）
{
  dataIndex: 'budgetAmount', title: '预算金额合计', width: 180, align: 'right',
  customRender: ({ text }) => {
    if (text == null) return ''
    const formatted = `CNY ${Number(text).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return { children: formatted, props: { style: { color: '#cf1322', fontWeight: 600 } } }
  }
}

// 单价列（8 位小数，深橙加粗）
{
  dataIndex: 'budgetUnitPrice', title: '预算单价', width: 210, align: 'right',
  customRender: ({ text }) => {
    if (text == null) return ''
    const formatted = `CNY ${Number(text).toLocaleString('zh-CN', { minimumFractionDigits: 8, maximumFractionDigits: 8 })}`
    return { children: formatted, props: { style: { color: '#d4380d', fontWeight: 600 } } }
  }
}
```

**详情卡片**：使用 `render` 返回带颜色的 VNode
**表单字段**：`type: 'number'` + `props: { precision: 2/8, prefix: 'CNY' }`

**币种可配置**：默认 `CNY`，支持 `CURRENCY_MAP` 扩展多币种。

## 5.4 字典/状态标签渲染

**字段绑定规则（强制）**：
- `dataIndex` / `field` 绑定**编码字段**（不带 Name 后缀，如 `projectExecStatus`）
- 展示文字优先取 `${编码字段}Name`；后端未返回 Name 时回退到 dict 反查 label
- Tag 颜色 / 下拉过滤始终用编码字段

**渲染规则**：
- 列配置：`{ dataIndex: 'projectExecStatus', type: 'dict', dictType: 'projectExecStatus', colorTag: true }`
- 框架自动渲染 `<a-tag :color="item.color">`
- 字典数据须提供 `color` 字段

## 5.5 列表页列规范

**列顺序**：序号 -> 业务单据编码 -> 编号/名称 -> 业务分类 -> 机构 -> 状态 -> 创建人 -> 创建时间 -> 操作列

**列宽规范**：

| 字段类型 | 列宽 | 对齐 | 其他 |
|---------|------|------|------|
| 序号 | 60 | center | `customRender: ({ index }) => index + 1` |
| 编码/代码 | 120 | left | |
| 名称/标题 | 150-200 | left | 长标题加 `ellipsis: true` |
| 描述/备注 | 200+ | left | 必须加 `ellipsis: true` |
| 金额 | 120 | right | |
| 数量 | 100 | right | |
| 日期 | 170 | left | |
| 状态(dict/tag) | 90-100 | center | |
| 操作列 | <=3 个 160, >3 个 180 | center | `fixed: 'right'` |

**列表内外留白**：表格首列 `padding-left: 24px`，末列 `padding-right: 24px`

**单元格内容截断与气泡**：
1. 默认 2 行：`ellipsis: { rows: 2 }`
2. 截断省略：超出 2 行自动 `...`
3. 悬浮气泡：Tooltip 显示完整内容 + 复制按钮
4. 例外：编码类短字段、日期、金额、数量保持单行 `ellipsis: true`
5. 非文本列（状态标签、操作列）不适用

**列锁定与横向滚动**：
1. 业务单据编码列**必须** `fixed: 'left'`，位于其左侧的所有列（序号、复选框）必须一起 `fixed: 'left'`
2. 操作列**必须** `fixed: 'right'`
3. 中间列不设 fixed
4. 表格**必须**配置 `scroll.x`
5. `fixed: 'left'` 必须从最左侧连续设置，中间不允许断开

**列数建议**：总列数 <=8 列

## 5.6 操作列规则

| 规则 | 值 |
|------|---|
| 折叠阈值 | >3 个操作时折叠 |
| 内联显示 | 前 2 个（高频：编辑、详情） |
| 下拉菜单 | 剩余（低频） |
| 危险操作 | `danger: true`，放下拉菜单中 |

**按钮排序**：编辑 -> 查看 -> 提交 -> 变更 -> 作废(danger) -> 删除(danger)

**ScmListPage vs ScmCardPage ListCard**：
| 维度 | ScmListPage | ScmCardPage ListCard |
|------|------------|---------------------|
| 操作列方式 | `{ dataIndex: '__action__', type: 'action' }` | `hasRowAction: true` |

## 5.7 表单页规则

**标题栏**：
- 页面顶部白色 Card，左侧标题，右侧操作按钮组
- 取消按钮**必须**配置，排在最后
- 顶部冻结：`position: sticky; top: 0; z-index: 100`

**表单字段布局**：
| 规则 | 值 |
|------|---|
| 默认列数 | `itemsPerRow: 3` |
| 可选列数 | `itemsPerRow: 2`（标签较长时） |
| 分组 | 每 6-8 字段一个 FormCard |
| 标签对齐 | 右对齐 |
| 长文本/上传 | `textarea`、`upload` **必须**独占一行（span=24） |

**Card 分组硬规则**：
1. 备注（textarea）+ 附件（upload）**必须**放在"基本信息"Card 内，不得单独拆出"附件信息"Card
2. 备注在前、附件在后
3. 物料行、供应商等行项数据拆分为独立 Card（`type: 'list'`）
4. 表单的 Card 总数通常 <=4 个

## 5.8 悬浮锚点导航

适用于表单页、详情页，Card >= 3 时自动显示。

**行为规格**：
1. 显示条件：可见 Card >= 3 个
2. 默认收起：仅显示圆形按钮
3. 展开/收起：点击圆形按钮展开，点击收起按钮或再次点击圆形按钮收起
4. 展开态默认选中第一个 Card
5. 使用 `<Teleport to="body">` 防止被 sticky 标题栏遮盖

**组件规格**：
- 收起态按钮：`<a-button type="primary" shape="circle" size="large">`，图标 `<MenuOutlined />`
- 面板容器：Teleport 到 body
- 锚点组件：`<a-anchor :offset-top="80" :affix="false">`，用 `<a-anchor-link>` 子组件

**CSS 规格**：
```css
.anchor-float { position: fixed; right: 24px; z-index: 99; }
.anchor-float-panel { width: 180px; background: #fafafa; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 12px 16px; max-height: 60vh; overflow-y: auto; }
.anchor-float-header { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #e8e8e8; }
.anchor-float-toggle { box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
```

## 5.9 详情页规则

**标题栏**：左侧标题，右侧关闭按钮（`type="default"`），sticky 冻结

**字段渲染**：
| 规则 | 值 |
|------|---|
| 空值 | 统一显示 `-` |
| 金额 | 按金额规范格式化 |
| 字典 | 渲染为 Tag 或转名称 |
| 日期 | `YYYY-MM-DD HH:mm` |
| 附件 | 文件名链接 + 下载图标 |

**内嵌列表**：不分页（或小分页 <=5 条），不加操作列

## 5.10 审批页规则

**页面结构**：标题栏 + 详情 Card + 审批流程 Card + 审批历史 Card

**步骤条**：
- 节点状态：`finish` / `process` / `wait`
- 驳回/退回：被驳回节点 `status="error"`，之后节点重置为 `wait`

**审批操作区**：
- 审批意见：`<a-textarea>` 3-5 行，驳回时必填
- 按钮组：通过(`type="primary"`)、驳回(`type="danger"`)、退回(`type="default"`)，右对齐

**审批历史时间轴**：
- 动作标签：通过(绿)、驳回(红)、退回(橙)、提交(蓝)
- 排序：时间倒序

## 5.11 弹窗规则

**通用规则**：
- `maskClosable: false`
- `destroyOnClose: true`
- 弹窗内部不需要灰色背景

**数据选择器 vs 下拉选择（交互规范）**：

| 数据特征 | 控件选择 | 示例 |
|---------|---------|------|
| 数据量确定且少（<100条） | select/treeSelect 下拉 | 字典枚举、供应商等级、审批状态 |
| 数据量不可预估 | **ScmDialog 查询列表弹窗**（搜索+分页+复选） | 企业选择、用户选择、物料选择 |

- **不确定数据量时禁止用下拉选择**：外部数据源（企业、用户、物料等）数据量可能很大，select 下拉会导致加载卡顿、无法定位目标
- 查询列表弹窗模式：ScmDialog 内嵌 list card，含搜索输入框 + 分页列表 + 复选框，参考 UserSelectDialog 模板
- 确定数据量小的选择池（如本域筛选后的可选企业列表）可用 select，但需加 `showSearch: true`

**数据选择器（左右分栏）**：
- 宽度 1200px，左侧树 240px，右侧自适应
- 左右面板各自独立滚动

**数据选择器（纯列表）**：
- 宽度 1200px
- 带复选框，分页默认 10 条/页

**选择行为**：
- 复选框多选，禁止在操作列中添加"选择"按钮
- 跨页保持选中状态
- 已选统计栏：`已选 N 项: 名称1, 名称2...`（N>3 展示前 3 项 + ...）
- 底部按钮：取消(前) + 确定(后, `type="primary"`)

**简单表单**：
- 宽度 520px，字段 <=3 个，单列布局 `itemsPerRow: 1`

## 5.12 抽屉规则

- 宽度：默认 560px，内容较长时 720px
- 关闭：右上角 x 或点击遮罩
- 内部不需要灰色背景

## 5.13 附件上传

所有附件上传**必须**使用 `ScmUpload` 组件，**禁止**直接使用 `<a-upload>`。

| 规则 | 值 |
|------|---|
| 上传地址 | `/api/file/{businessType}/upload`（默认 businessType=`common`） |
| 最大文件数 | 默认 10 |
| 单文件最大 | 100MB |
| 支持格式 | word/excel/pdf/ppt/jpg/png/zip/rar |

展示模式：`upload`（表单页） / `list`（详情页、只读展示）

数据格式：`[{ path, fileName, size, fileSize, fileType, finished }]`

## 5.14 Card 排列方式

| layout | 说明 | 适用场景 |
|--------|------|----------|
| `vertical` | 纵向平铺 | 表单页、详情页 |
| `horizontal` | 左右分栏 | 左树右列表 |
| `anchor` | 带锚点侧栏 | 长表单页、多区块详情页（Card >=3） |
| `tab` | 带 Tab 页签 | 多标签列表页 |

## 5.15 Alert Card

页面级提示卡片，四种类型：

| 类型 | 背景色 | 边框/图标色 | 使用场景 |
|------|--------|-----------|---------|
| info | `#e6f7ff` | `#1890ff` | 一般提示 |
| warning | `#fffbe6` | `#faad14` | 警告提醒 |
| error | `#fff2f0` | `#ff4d4f` | 错误、阻断 |
| success | `#f6ffed` | `#52c41a` | 成功反馈 |

## 5.16 Tree Card

- 宽度 220px（固定）
- 顶部搜索框
- 节点高度 32px，缩进每级 24px
- 节点选中：背景 `#e6f7ff`，文字 `#1890ff`，`font-weight: 600`

## 5.17 FlowGuide Card

- 水平步骤条
- 状态：`finish`(对勾蓝) / `process`(实心序号蓝) / `wait`(空心序号灰) / `error`(叉号红)
- 连接线：已完成蓝色 `#1890ff`，未完成灰色 `#f0f0f0`

## 5.18 全局状态页

**加载态**：列表首次加载 `<a-spin>`，筛选/翻页表格 `loading`，详情/表单 `<a-skeleton>`

**空状态**：列表无数据 "暂无数据"，搜索无结果 "未找到匹配结果，请调整筛选条件"

**错误状态**：网络异常 `error`，权限不足 `403`，页面不存在 `404`

## 5.19 反馈组件

**Toast/Message**：`message.success()` 3秒 / `message.error()` 5秒 / `message.warning()` 3秒

**确认弹窗**：`Modal.confirm()`，危险操作图标红色，`maskClosable: false`

**下拉菜单**（操作列折叠）：触发按钮 "更多" + `DownOutlined`，菜单宽 120px，危险操作文字 `#ff4d4f`

## 5.20 导入导出

**导入弹窗**：宽度 640px，步骤：上传文件 -> 预览校验 -> 确认导入 -> 完成
- 模板下载按钮必含
- 文件格式 .xlsx/.xls，最大 10MB

**导出**：<=500 条直接下载，>500 条异步处理 Toast 提示
