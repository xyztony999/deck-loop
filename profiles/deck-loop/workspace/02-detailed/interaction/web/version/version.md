# PageSpec — 版本树操作（树面板/对比/回退/分叉）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-04（ver） |
| 用户类型 | creator |
| 业务类型 | business_doc（不可变版本聚合的指针操作） |
| 页面类型 | hybrid（工作台内嵌树面板）+ code（对比页） |
| 路由 | /deck/:deckId（树面板）· /deck/:deckId/compare |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-version.md v1.2（6 端点冻结）/ api-web-agent.md v1.0 |

## 1. 模块元信息

- 组件恢复：client/src/views/adjust/components/VersionTreePanel.vue、VersionCompareDrawer.vue（迁至 web/src/views/deck/components/ 与 compare 页）。
- **网站无版本内容写入口**：仅指针类操作（回退/分叉）；内容产出在 agent 侧（agent-create，MCP）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| version_tree | POST | /ver/version/tree | branchScope=ALL/ACTIVE |
| version_detail | POST | /ver/version/detail | 预览画布数据源 |
| version_compare | POST | /ver/version/compare | 双版本差异 |
| version_rollback | POST | /ver/version/rollback | confirm=true |
| version_fork | POST | /ver/version/fork | branchName≤50 |
| dict_batch | POST | /ver/dict/batch | VersionSourceType |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| ver.VersionSourceType | VersionSourceType | tag（FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST） |

## 4. 版本树面板（详情工作台左侧）

- 数据：version_tree（默认 ACTIVE；页头切换「全部分支」=ALL）+ branches[] 分支选择器。
- 节点渲染：v{versionSeq} · sourceType tag · instructionBrief（ellipsis，hover 全文）· createdTime · isCurrent（主色描边）/isFinal（green 徽标）；taskStatusOfSource=null（agent 版本）不显示任务态。
- 节点操作（operList 驱动）：set-current（回退）/ fork-from（分叉）/ export-from（FINALIZED 限制，→/deliver?deckId=）。
- 节点点击 → 右预览画布加载 version_detail（web/preview/preview.md §4）。
- 面板头：「对比」按钮（进入选择态：勾选两节点 → /compare?left=&right=）+ 刷新 + 分支筛选。
- 轻轮询 10s（页面隐藏暂停）；agent 新版本到达后树自动更新（无 SSE）。

### 4.1 回退（set-current）

二次确认：「将 v{seq} 设为当前版本？历史版本不会改动。」守卫：Deck 须 ITERATING（FINALIZED 提示先解锁，BIZ_DECK_STATUS_FORBIDDEN 透传）；成功 → 树 isCurrent 移动 + 预览刷新。

### 4.2 分叉（fork-from）

弹层（浮层）：branchName✅≤50（同 deck 唯一，BIZ_VERSION_BRANCH_EXISTS 定位字段错误）；说明「从 v{seq} 另起分支，快照复制为新分支首版」；成功 → 活动分支切换 + 树刷新。

## 5. 版本对比页（/deck/:deckId/compare，code）

- 入参：?left=&right=（versionId）；页头双版本选择器（modalSelect 树节点）可换版。
- 数据：version_compare → sameHash / pages[{pageId, leftIndex, rightIndex, changeKind, diffBlocks}]。
- 布局：左右双画布（文档表面白纸）逐页对齐；差异页高亮（changeKind 色标：NONE 无/STRUCTURE blue/TEXT blue/IMAGE blue/NEW green/REMOVED red，chrome accent 边框）；页列表侧栏（差异计数徽标）。
- 同版本比较拒绝（BIZ_VERSION_SAME_COMPARE 文案）；差异块点击定位对应块描边。
- 只读页：无任何编辑/指令入口。

## 6. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /deck/:deckId | 树面板（内嵌） | 详情工作台 |
| /deck/:deckId/compare | 对比页 | 树面板「对比」 |

## 7. 全局一致性

- 回退/分叉为指针操作，确认文案明示「历史不可变」（ADR-009）。
- 对比差异为过程数据（P7），不持久化。

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（恢复 adjust 工作台树/对比组件改纯 Web；去指令面板/目标选取编辑交互——agent 侧定位；+轻轮询刷新） |