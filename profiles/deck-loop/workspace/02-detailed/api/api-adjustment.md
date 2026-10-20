# API 设计 — 语言调整（C-03）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-03 语言调整（产品核心） |
| 接口域 | adjust |
| 功能类型 | 业务流程类（异步任务子流程驱动） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.1 |
| 日期 | 2026-10-08 |
| 输入 | prd-adjustment.md v1.1 / domain-model.md v1.1 |

## 1. 模块设计概述

### 1.1 业务背景及目标

「说一句话改一版」的产品化：整稿级与定向局部级自然语言调整指令，每次调整自动留档新版本。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 整稿/定向调整指令提交、目标作用域校验、指令与话术联动入参 | 任务执行/列表/取消/重试（复用 /gen/task/*，taskType=FULL_ADJUST/TARGETED_ADJUST）、版本留档（api-version 编排）、手动内容编辑（定位约束） |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 本模块无独立聚合根；操作经 GenerationTask 子流程写入 Deck/DeckVersion | 指令是任务的输入值对象，非独立实体 |
| D2 | 定向调整产出一致性校验（未涉及页面逐字节一致）失败→任务 FAILED | 防止「局部指令全稿重写」破坏信任（prd-adjustment 规则 2） |
| D3 | 基线≠当前版本时提交语义=「从基线分叉调整」，提示命名分支 | 与版本管理分叉语义统一 |
| D4 | scope 提交前独立校验接口 | 版本切换后页/块 ID 失效的提前拦截 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 调整指令 AdjustmentInstruction | 值对象（instruction_snapshot 内） | 随任务/版本快照留存 |
| GenerationTask | 子流程（api-generation 建模） | taskType=FULL_ADJUST/TARGETED_ADJUST |
| DeckVersion | 产出聚合根（api-version 建模） | parent=baseVersionId |

### 1.5 上下文映射

同 api-generation §1.5（网关遵奉者/素材 ACL/偏好遵奉者）；另增话术域：OHS 消费话术正文（前端输入时取用，服务端仅记录 usedTemplateIds）。

## 2. 跨聚合根设计

不适用（无本模块聚合根）；任务成功编排见 api-deck §2.3。

## 3. 应用/基础设施层设计

### 3.1 接口规范

同栈规约；POST 业务接口；Result\<T\>；无独立列表（任务列表走 /gen/task/list）。

### 3.2 依赖与约束

- 前置：DeckDomainService#assertCanCreateTask（INV-3）；INV-8 互斥。
- 提交即锁定基线：baseVersionId 快照进 instruction_snapshot。

### 3.3 权限模型

会话+属主；提交接口校验 deck/version 归属。

### 3.4 公共规范

错误码：BIZ_ADJUST_{ERROR}（BIZ_ADJUST_SCOPE_INVALID / BIZ_ADJUST_BASE_VERSION_INVALID / BIZ_ADJUST_PLACEHOLDER_UNRESOLVED）；枚举 TargetKind（枚举池）。

## 4. 聚合根详细设计

### 4.1 领域模型（值对象 + 任务入参契约）

**调整指令值对象（instruction_snapshot 内 adjust 节）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instructionText | VARCHAR(2000) | ✅ | 指令文本 |
| baseVersionId | VARCHAR(32) | ✅ | 基线版本 |
| targetKind | VARCHAR(32) | TARGETED 必填 | TargetKind |
| targetPath | JSON | TARGETED 必填 | {pageId} 或 {pageId, blockId} |
| applyBrandKit | INT(1) | ✅ | 品牌约束开关 |
| brandKitId | VARCHAR(32) | apply 时必填 | 默认取 Deck 默认规范 |
| usedTemplateIds | JSON | — | 话术来源记录 |
| baseBranchName | VARCHAR(50) | ✅ | 发起时活动分支快照 |

不变量：INV-9 scope 引用的 pageId/blockId 必须存在于 baseVersionId 内容快照；INV-10 占位符全部替换（BIZ_ADJUST_PLACEHOLDER_UNRESOLVED）。

### 4.2 状态模型

复用任务状态机（api-generation §4.2）；无独立状态对象。

### 4.3 子流程设计

| 子流程 | 触发 | 输入 | 输出 | 输出写入 |
|--------|------|------|------|---------|
| FULL_ADJUST | POST /adjust/whole/submit | §4.1 指令（无 target） | 新版本完整快照 | DeckVersion(source=FULL_ADJUST,parent=base) |
| TARGETED_ADJUST | POST /adjust/targeted/submit | §4.1 指令（含 target） | 仅目标作用域变更的完整快照（一致性校验后） | 同上（source=TARGETED_ADJUST，scope 随档） |

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 整稿调整提交 | POST /adjust/whole/submit | →taskId |
| 定向调整提交 | POST /adjust/targeted/submit | →taskId |
| 目标作用域校验 | POST /adjust/scope/validate | 提交前拦截 |
| 枚举字典 | POST /adjust/dict/batch | TargetKind |

#### 接口详情

**POST /adjust/whole/submit** — AO：deckId✅、baseVersionId✅、instructionText✅(≤2000)、applyBrandKit(bool)、brandKitId、usedTemplateIds[]。
校验：INV-3/INV-8/INV-10；baseVersionId 属于该 deck 且非空内容；基线≠currentVersionId 时返回 needForkBranch=true 提示（confirm=false 拒绝、true 接受并要求 branchName）。
VO：taskId、taskCode、taskStatus、forked(bool)。

**POST /adjust/targeted/submit** — 增 AO：targetKind✅、targetPath✅。
校验：INV-9（等价 /adjust/scope/validate 内联执行）。

**POST /adjust/scope/validate** — AO：deckId、versionId、targetKind、targetPath。VO：valid(bool)、targetSummary（页码+块摘要，供 UI 回显）。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，进程内 EventEmitter 发布订阅；事件名=businessType、载荷与触发时机不变，事务提交后发布。

事件复用 gen_task_created / gen_task_finished（taskType 携带调整类型）；无独立事件。
关联域调用：素材域（品牌规范注入）、话术域（模板存在性校验，轻量）——均进程内直调。

## 5. 模块清单汇总

### 5.1 对外服务清单

无（管理接口 + 值对象契约）。

### 5.2 数据访问清单（MongoDB）

无独立 collection（调整指令值对象随 instruction_snapshot 整体嵌入 dl_generation_task / dl_deck_version 文档）。

### 5.3 MongoDB collection 设计

无独立 collection（见 api-generation §5.3 / api-version §5.3；指令快照以 object 嵌入两处文档）。

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成；任务/版本表复用 |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.2/§5.3 改无独立 collection（指令值对象随快照嵌入）；§4.5 事件机制改进程内。指令值对象契约与接口契约冻结不变 |
