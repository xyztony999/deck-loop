# PageSpec — 生成向导（大纲→整稿）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-02（gen） |
| 用户类型 | creator |
| 业务类型 | business_doc |
| 页面类型 | **hybrid**（引导式三步 + 画布预览[code]） |
| 路由 | /deck/:deckId/generate |
| 版本 | v1.0（2026-10-07） |
| 输入 | api-generation.md v1.0 |

## 1. 模块元信息

- App：新建创作物后自动进入；或 DRAFT 态创作物详情的「开始生成」。
- 组件基座：ScmCardPage（FlowGuideCard 步骤导航）+ 自定义大纲编辑树（code）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| outline_generate | POST | /gen/outline/generate | 步骤①发起 |
| outline_save | POST | /gen/outline/save | 大纲编辑保存 |
| full_generate | POST | /gen/full/generate | 步骤③整稿 |
| deck_detail | POST | /deck/deck/detail | 取 draftOutline/状态 |
| task_progress | POST | /gen/task/progress | 轮询 |
| task_cancel | POST | /gen/task/cancel | 取消 |
| task_retry | POST | /gen/task/retry | 重试 |
| asset_select | POST | /asset/select/asset-list | 素材引用 |
| brandkit_select | POST | /asset/select/brandkit-list | 规范引用 |
| dict_batch | POST | /gen/dict/batch | TaskType/TaskStatus |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| task.TaskStatus | TaskStatus | colorTag（同 adjustment 页） |

## 4. 页面结构（FlowGuide 三步）

### 步骤① 需求补充与引用（config）

| 字段 | 组件 | 校验/说明 |
|------|------|----------|
| topic/requirement | 只读回显 + 补充输入 extraRequirement（textarea ≤500） | 来自 deck |
| assetIds | 多选 modalSelect（asset.select.assetList，启用态） | ≤10 |
| brandKitId | modalSelect（asset.select.brandkitList） | 可空 |

按钮：[生成大纲]（outline_generate）→ 任务进度条（阶段文案）→ 成功进入步骤②。

### 步骤② 大纲确认与编辑（code 树编辑）

- 大纲树渲染 draftOutline：节点卡片（title✅≤50 / points[] / note / pageHint），增删改/拖拽排序；节点数 1~50。
- 自动保存草稿（debounce 2s → outline_save）；显式[保存大纲]按钮。
- 按钮：[重新生成大纲]（confirm 覆盖提示）/ [下一步]。
- 步骤流转规则：无 draftOutline 禁止下一步。

### 步骤③ 整稿生成（config）

| 字段 | 组件 | 说明 |
|------|------|------|
| lengthOption | radio（SHORT 简练/MEDIUM 标准/LONG 详尽） | 默认 MEDIUM |
| 汇总预览 | 只读：大纲节点数/引用素材数/品牌规范名 | |

按钮：[发起整稿生成]（full_generate，useDraft=true）→ 任务卡（进度/取消/失败重试）→ 成功：toast「初稿 v1 已生成」+ 跳转迭代工作台（/iterate）。

### 步骤按钮区规则

按钮区统一位于表单页顶部右侧：上一步（dirty 检测，不调后端）/ 下一步 / 取消（router.back）。

## 5. 表单页映射

向导页整体为分步表单；字段分组=步骤（3 步，符合 3-5 步规范）。

## 6. 路由定义

| 路由 | 页面 | 入口 |
|------|------|------|
| /deck/:deckId/generate | 生成向导 | 新建创作物第③步 / 详情「开始生成」（DRAFT） |

## 7. 全局一致性

- ITERATING 及之后状态进入本页 → 只读模式 + 引导「前往迭代工作台」。
- 任务失败错误码透传展示（含网关 BIZ_GW_* 摘要）。

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 初始生成 |
