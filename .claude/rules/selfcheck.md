# Vue3 引擎栈 — 前端代码生成自检清单（selfcheck）

> **层级**：L2 技术栈 profile，随栈规则挂载生效。
> 前端代码写完后、提交前**必须逐条核对**。每条对应一个具体 grep/肉眼检查动作。与 frontend-rules.md 配套（本文=逐条检查动作，彼文=规则正文）。
> 📎 参考示例（scm）：字段/接口示例来自 scm 参考实现。

---

## 一、前后端对齐（最高频出错）

| # | 检查项 | 检查方法 | 常见错误 |
|---|--------|----------|----------|
| F-01 | Action URL 与后端 @PostMapping 路径一致 | 打开 Controller.java，逐个比对 actions.ts 中的 URL | URL 拼错、缺 - 连字符 |
| F-02 | dict 列绑 code 字段，不绑 name 字段 | grep `dataIndex.*Name` config 文件，所有 `type:'dict'` 的列 dataIndex 不能带 Name 后缀 | `supplierLevelName` → 应为 `supplierLevel` |
| F-03 | 列表列 dataIndex 在 ListVO 中存在 | 打开 ListVO.java，逐个比对 columns 的 dataIndex | 臆造后端不存在的字段 |
| F-04 | 表单 field 在 SaveAO/UpdateAO 中存在 | 打开 AO.java，逐个比对 form fields | 臆造后端不存在的字段 |
| F-05 | 详情 field 在 DetailVO 中存在 | 打开 DetailVO.java，逐个比对 detail fields | 臆造后端不存在的字段 |
| F-06 | 子列表 parentParam 与后端 AO 字段名一致 | 打开子资源 ListAO.java，确认 supplierId 字段名，前端 parentParam 必须完全匹配 | 想当然写 `'id'`，后端实际是 `'supplierId'` |
| F-07 | dictType 与后端 @DictKey 一致 | 打开枚举类看 @DictKey 注解值，与前端 dictType 比对 | isPrimary 用了 blacklisted 的 dictType |

## 二、引擎用法（框架规则违反）

| # | 检查项 | 检查方法 | 常见错误 |
|---|--------|----------|----------|
| F-10 | ScmListPage 操作列用 `__action__` + `rowActions`，不用 `hasRowAction` | grep `hasRowAction` 在 ListPage config 中应为空 | 列表页混用 CardPage 的 hasRowAction |
| F-11 | ScmCardPage ListCard 操作列用 `hasRowAction: true`，不用 `__action__` 列 | 检查 CardPage 中的 ListCard tableColumns 无 `__action__` | CardPage 内列表加了 __action__ 列 |
| F-12 | ScmListPage 事件是 `@row-click`，不是 `@row-action` | grep `@row-action` 应为空 | 事件名写错 |
| F-13 | ScmCardPage 事件是 `@card-event`，ListCard 行操作走 card-event | 检查 vue 文件事件绑定 | 混用两种引擎的事件 |
| F-14 | ScmDialog 用 `:visible` + `@update:visible`，ScmDrawer 用 `v-model:open` | grep 检查 | prop 名写错导致弹窗不关 |
| F-15 | modalSelect 的 `listAction`/`listColumns`/`labelField`/`valueField`/`modalTitle`/`modalWidth`/`multiple` 在字段**顶层**，**禁止**放在 `props` 内 | 检查 modalSelect 字段的 `props` 内是否包含这些属性，必须全部移到顶层 | 包裹在 `props:{}` 内 → `field.listAction` 为 `undefined` → 弹窗不调接口 |
| F-16 | 级联下拉（选项依赖另一字段值）必须用 `optionsAction`，**禁止**用 `dict` | 检查依赖外部参数的 select 字段是否用了 `dict` | `dict` 初始化时缓存不含参数，后续参数变更不触发重新加载 |
| F-17 | ScmCardPage 的 `detail-id-key` 必须匹配后端详情接口参数名（非 `id` 时必须显式传入） | 检查后端 Controller detail 方法的 AO 参数名，与前端 `detail-id-key` 比对 | 默认 `'id'` → 后端收到 null → 校验报错"ID不能为空" |
| F-18 | ScmCardPage 页面**禁止**在 `onMounted` 中手动调用详情接口（`executor.execute('xxx.detail')`） | grep vue 文件中的 `onMounted` + `detail` 调用 | 重复调用详情：框架 `loadAction` 已自动加载，手动再调浪费且可能覆盖 |
| F-19 | modalSelect 单选（`multiple: false`）值仍为 `any[]` 数组，提交时必须 `Array.isArray` + `[0]` 解出 value/label | 检查 modalSelect 字段的 persist 提交代码 | 直接当对象取 `.value` → `undefined`，code/name 字段入库为空 |
| F-20 | 级联下拉中上游字段变更时，`watch` 内**必须**同步清空下游字段的已选值 | 检查级联 watch 代码是否缺少清空逻辑 | 上游切了 org，下游 dept 还保留旧值 → 提交了错误关联数据 |

## 三、UI/UX 合规

| # | 检查项 | 检查方法 | 常见错误 |
|---|--------|----------|----------|
| F-21 | 序号列 width:60, align:center, fixed:left | 检查 index 列 | 缺 fixed:left 导致冻结不连续 |
| F-22 | 编码/单号列 type:'link', fixed:'left' | 检查编码列 | 只有 text 没有 link，点击无法跳转 |
| F-23 | 操作列 type:'action', fixed:'right' | 检查操作列 | 缺 fixed:right |
| F-24 | dict 列有 colorTag:true | 检查所有 type:'dict' 的列 | 缺 colorTag 导致无颜色标签 |
| F-25 | 金额列 align:'right' | 检查金额字段 | 缺右对齐 |
| F-26 | 长文本列有 ellipsis:{ rows:2 } | 检查名称/描述列 | 缺截断 |
| F-27 | 日期列 width:170 | 检查日期时间列 | 写成 160 或 180 |
| F-28 | textarea/upload 独占一行(span=full 或 span=1) | 检查表单 textarea/upload 字段 | 挤在3列布局里 |
| F-29 | Card>=3 时 layout:'anchor' | 检查 CardPage 的 layout 值 | 3个Card还用 vertical |
| F-30 | 查询条件 dict 字段用 `dict:'dict.xxx'`，禁止 `options:[]` | grep `options:\[` | 硬编码下拉选项 |
| F-31 | 表单 dict 字段用 `dict:'dict.xxx'`，禁止 `options:[]` | grep `options:\[` | 硬编码下拉选项 |

## 四、特殊字段检查（上传/时间/外部数据源）

| # | 检查项 | 检查方法 | 常见错误 |
|---|--------|----------|----------|
| F-32 | upload 字段 `props.action` 必须为 `/api/file/{businessType}/upload`，默认 `common` | grep `action.*upload` config 文件，比对路径格式 | 写成 `/api/upload` 缺 businessType，或写成 `/upload` 缺 `/api` 前缀 |
| F-33 | upload 字段 `props.action` 中 `{businessType}` 无额外指定时默认为 `common` | 打开 Controller 确认上传接口的 businessType 参数值，比对前端 action URL | businessType 写错或未替换 |
| F-34 | upload 字段入参必须包含 `multiple`/`maxCount`/`accept` 等约束 | 检查 upload 字段 props 配置 | 缺 `multiple: true` 导致无法多选，缺 `accept` 导致可上传任意文件 |
| F-35 | upload 字段 `span: 1` 独占一行 | 检查 upload 字段是否有 span:1 或 span:24 | 上传组件挤在3列布局里 |
| F-36 | 日期字段 `props.valueFormat` 必须与后端类型匹配：LocalDate→`YYYY-MM-DD`，LocalDateTime→`YYYY-MM-DD HH:mm:ss` | 打开 AO.java 确认字段类型，比对前端 valueFormat | 后端是 LocalDate 前端用 `YYYY-MM-DD HH:mm:ss` |
| F-37 | 日期范围查询字段命名必须以 `Arr` 结尾（如 `createTimeArr`），type 为 `dateRange` | 检查 queries 中日期范围字段 | 字段名不以 Arr 结尾，或 type 写成 `daterange`（小写） |
| F-38 | 日期范围查询字段后端自动拆分为 `Start`/`End`，前端无需手动拆分 | 检查是否有手动拼 Start/End 的代码 | 前端手动拼接了 createTimeStart/createTimeEnd |
| F-39 | 外部数据源 select/treeSelect **优先使用服务选择池接口**（`dict: 'srm.{resource}.xxxOptions'`），仅在选择池无覆盖时才用 `dict: 'srm.proxy.xxx'`（Proxy 为保留能力，不建议常规使用） | grep `srm.proxy` 检查是否有可替代的选择池接口 | 使用 Proxy 转发而本域选择池已有同等接口 |
| F-39b | **不确定数据量的外部数据源禁止用下拉选择**，必须用 ScmDialog 查询列表弹窗（含搜索+分页+复选） | 检查 select/treeSelect 的数据源，数据量不可预估时（企业/用户/物料等）必须改为 Dialog+ListCard | 企业选择用 select 下拉，数据量大时卡死或无法定位 |
| F-40 | 外部数据源 select 必须 `props: { showSearch: true, filterOption: true }` | 检查外部数据源 select 的 props | 缺搜索过滤导致数据多时无法选择 |
| F-41 | 外部数据源 treeSelect 必须 `props.fieldNames` 与后端返回结构一致 | 比对 treeSelect 的 fieldNames 与后端 DTO 字段名 | fieldNames 中 value/label/children 映射错误 |
| F-42 | 外部数据源 select 带 `labelInValue: true` 时，必须有对应 hidden 字段存储 name | 检查 labelInValue 字段是否有配套 hidden 字段 | 选了值但提交时只有 code 没有 name |
| F-43 | 代理 Action URL 必须与 Proxy Controller @PostMapping 路径一致 | 打开 ProxyController.java，逐个比对 proxy action URL | proxy action URL 拼错 |
| F-44 | **upload 组件返回的 `fileSize` 为格式化字符串（如 `"577.5 KB"`），但后端 AO 字段为 `Long fileSize` 时必须转成原始数字提交** | 检查提交代码中 `fileSize` 的来源：必须从 `resp.size` 或 `f.size` 取原始字节数，禁止直接提交 `resp.fileSize` 格式化字符串 | 后端反序列化失败：`Cannot deserialize value of type java.lang.Long from String "577.5 KB"` |

## 五、文件完整性

| # | 检查项 | 检查方法 |
|---|--------|----------|
| F-50 | 每个路由都有对应的 .vue 文件 | 比对 router/modules/*.ts 与 views/ 目录 |
| F-51 | 每个 .vue 引用的 config 文件都存在 | 检查 import 路径 |
| F-52 | actions.ts 中每个 action 在 config 中被引用 | 逐个比对 action name |
| F-53 | srmDictKeys 覆盖了页面中所有 dictType | 比对 dictType 出现的值与 srmDictKeys |
| F-54 | 无已废弃引擎：ScmDetailPage → ScmCardPage, ScmFormPage → ScmCardPage | grep 检查 |

---

## 执行要求

1. **前端代码写完后、提交前必须逐条检查本清单**
2. **F-01 至 F-07（前后端对齐）为 CRITICAL，任何一条不通过禁止提交**
3. **检查结果必须记录：哪条通过/哪条修复了什么**，不可跳过记录
4. 发现新高频错误时补充到本清单
