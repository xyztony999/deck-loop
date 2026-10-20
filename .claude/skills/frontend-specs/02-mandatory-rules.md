# 11条强制规则

1. **所有请求必须与设计文档严格一致** — action name、URL、method、请求参数、响应字段必须与后端设计文档完全对应，禁止自行推断或调整接口定义
2. **所有字段、action name、URL 必须来自 PageSpec，禁止编造** — 不确定时输出 `// TODO: 请确认` 而非猜测
3. **每生成一个文件，回溯检查每个字段是否在 PageSpec 中有来源**
4. **两种引擎的规则不可混用** — ScmListPage 用 `__action__` + `rowActions`；ScmCardPage ListCard 用 `hasRowAction: true`
5. **必须遵循 UI 布局强约束** — 列宽按字段类型匹配、操作列按频率排序、查询区域 defaultRowCount=2、表单 itemsPerRow=2、金额/单价格式化（CNY前缀+精度+颜色+加粗）、单元格截断气泡、列锁定滚动、字典标签渲染、页面标题栏 sticky 冻结+取消按钮、textarea/upload 单行、悬浮锚点（>=3 Card）等全部规则
6. **禁止在前端 `rowActions` 中写 `visible` 函数判断按钮可见性** — 操作按钮的可见性由后端每个 row 的 `operList` 字段决定，前端只负责渲染。`rowActions` 仅用于后端尚未返回 `operList` 的临时过渡场景
7. **禁止硬编码字典 options** — 必须用 `dict: '{dictType}'`
8. **禁止在 actions.ts 的 URL 中加 `/api` 前缀** — 全局 baseURL 自动补，但 upload 的 `props.action` 需写 `/api/upload`
9. **审批结果必须用 `radio` + `dict` + 单提交按钮** — 禁止用两个按钮（通过/驳回），禁止写死 options
10. **禁止使用已废弃的引擎/组件** — ScmDetailPage -> ScmCardPage, ScmFormPage -> ScmCardPage, ScmFormDialog -> ScmDialog 等
11. **不确定数据量的外部数据源禁止用下拉选择，必须用查询列表弹窗** — 当数据量不可预估时（如企业、用户、物料等），select/treeSelect 下拉无法承载，必须使用 ScmDialog 内嵌 list card（含搜索+分页+复选），参考 UserSelectDialog 模式
