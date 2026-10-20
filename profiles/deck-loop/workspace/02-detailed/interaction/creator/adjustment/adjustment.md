# PageSpec — 迭代工作台（语言调整 · 产品核心页）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-03（adjust）+ C-04 面板（ver） |
| 用户类型 | creator |
| 业务类型 | business_doc |
| 页面类型 | **hybrid**（左：内容预览画布[code] / 右：指令与版本面板[config]） |
| 路由 | /deck/:deckId/iterate |
| 版本 | v1.0（2026-10-07） |
| 输入 | api-adjustment.md / api-version.md / api-generation.md v1.0 |

## 1. 模块元信息

- App：deck-loop 客户端主窗口；创作物详情的「进入迭代」落地页。
- 组件基座：右侧面板 = ScmCardPage 组合（指令卡/任务卡/版本树卡）；左侧预览画布 = 自定义 code 组件（DeckPreviewCanvas）。
- 状态机联动：DeckStatus=FINALIZED/ARCHIVED 时全页只读（提示解锁/恢复）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| version_detail | POST | /ver/version/detail | 当前版本内容快照 |
| whole_submit | POST | /adjust/whole/submit | 整稿调整 |
| targeted_submit | POST | /adjust/targeted/submit | 定向调整 |
| scope_validate | POST | /adjust/scope/validate | 目标校验（选中即调） |
| version_tree | POST | /ver/version/tree | 版本树 |
| version_compare | POST | /ver/version/compare | 对比 |
| version_rollback | POST | /ver/version/rollback | 回退 |
| version_fork | POST | /ver/version/fork | 分叉 |
| task_progress | POST | /gen/task/progress | 轮询（2s） |
| task_list | POST | /gen/task/list | Tab3 任务记录（deckId 过滤） |
| task_cancel | POST | /gen/task/cancel | 取消 |
| task_retry | POST | /gen/task/retry | 失败重试 |
| task_stream | GET | /gw/task/stream | SSE 进度增强通道（连接成功停轮询） |
| prompt_select | POST | /asset/select/prompt-list | 话术选用 |
| prompt_touch | POST | /asset/prompt/touch | 使用计数 |
| brandkit_select | POST | /asset/select/brandkit-list | 品牌约束选择 |
| dict_batch | POST | /adjust/dict/batch · /ver/dict/batch | TargetKind/VersionSourceType |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| adjust.TargetKind | TargetKind | 选中态标签 |
| task.TaskStatus | TaskStatus | colorTag（QUEUED gray/RUNNING blue/SUCCEEDED green/FAILED red/CANCELLED gray） |
| ver.VersionSourceType | VersionSourceType | 版本节点 tag |

## 4. 页面结构（三区）

```
┌────────────────────────────────────────────────────────┐
│ 顶栏：deckName · 状态tag · 当前版本v{seq}·分支 · [定稿][导出] │
├──────────────────────────┬─────────────────────────────┤
│ 左：内容预览画布（60%）      │ 右：指令与版本面板（40%）        │
│  · 页面缩略滚动列表          │  Tab1 调整指令                 │
│  · 点击页→块级选中           │   · 指令输入 textarea(≤2000)   │
│  · 选中高亮=定向目标         │   · 话术模板选择(prompt_select) │
│  · 任务进行中:骨架屏+进度     │   · 品牌约束 switch+选择器      │
│  · FAILED: 错误条+重试       │   · [发起调整] whole/targeted  │
│                          │  Tab2 版本树                    │
│                          │   · 树节点（来源tag/时间/当前标记）│
│                          │   · 节点操作: 设为当前/分叉/对比   │
│                          │  Tab3 任务记录                   │
│                          │   · 任务列表+状态+取消/重试       │
└──────────────────────────┴─────────────────────────────┘
```

### 4.1 定向目标选取（code 交互）

| 交互 | 行为 | 接口 |
|------|------|------|
| 单击页面缩略 | 选中页（targetKind=PAGE），页边框高亮 | scope_validate 实时校验 |
| 单击文本块/图片 | 选中块（targetKind=TEXT_BLOCK/IMAGE_BLOCK），块高亮 | scope_validate |
| 清除选择 | 回整稿模式 | — |
| 版本切换（树节点预览） | 画布加载该版本 detail；提示「非当前版本，调整将产生分叉」 | version_detail |

### 4.2 指令提交（config）

| 字段 | 组件 | 校验 |
|------|------|------|
| instructionText | textarea | 必填 ≤2000；话术模板插入后占位符全部替换（未替换禁提交，BIZ_ADJUST_PLACEHOLDER_UNRESOLVED 提示定位） |
| targetKind/targetPath | 画布选中态回显（只读 tag） | 无选中→整稿模式按钮；有选中→定向模式按钮 |
| applyBrandKit | switch + modalSelect（asset.select.brandkitList） | 开启必须选规范（默认 deck 默认规范） |
| 基线版本 | 只读展示 v{seq} | 基线≠当前版本时提交返回 needForkBranch → 弹窗填 branchName 确认 |

按钮：发起整稿调整（whole_submit）/ 发起定向调整（targeted_submit，仅目标态可用）。提交成功→右面板任务卡激活，画布骨架屏。

### 4.3 任务卡（轮询 task_progress；SSE 增强通道连接时停轮询）

进行中：进度条+阶段文案+取消；失败：错误摘要+重试；成功：自动 version_detail 刷新画布 + 成功 toast（「已生成 v{newSeq}」）。

### 4.4 版本树面板

- 树渲染 version_tree（branchScope=ACTIVE 默认，ALL 切换）；当前版本★、定稿版本🏁标记。
- 节点操作（confirm 类均二次确认）：设为当前（rollback）/ 从此分叉（fork，弹窗 branchName ≤50 唯一校验）/ 与当前对比（→对比视图）。
- 对比视图（抽屉全屏）：左右双栏页面流，diff 着色（STRUCTURE 紫/TEXT 橙/IMAGE 蓝/NEW 绿/REMOVED 灰，数据源 version_compare）。

## 5. 表单页映射

无独立表单页（指令卡即轻表单，校验内联）。

## 6. 路由定义

| 路由 | 页面 | 入口 |
|------|------|------|
| /deck/:deckId/iterate | 迭代工作台 | 详情「进入迭代」/列表直达 |
| /deck/:deckId/compare?left=&right= | 对比抽屉 | 版本树节点 |

## 7. 全局一致性

- 按钮可见性双保险：前端状态驱动 + 后端 operList/守卫错误码兜底。
- 弱网：任务轮询降级提示；离线只读。

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 初始生成（产品核心页） |
