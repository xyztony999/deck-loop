# API 设计 — 初稿生成（C-02）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-02 初稿生成 |
| 接口域 | gen |
| 功能类型 | 业务流程类（异步任务子流程驱动） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | prd-generation.md v1.1 / domain-model.md v1.2 |

## 1. 模块设计概述

### 1.1 业务背景及目标

需求→大纲（可编辑确认）→整稿生成→首个内容版本；生成过程异步可跟踪。大纲环节给用户结构控制权。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 大纲生成/保存、整稿生成发起、生成任务列表/详情/取消/重试、进度查询 | 调整任务（api-adjustment，同一子流程的另两类 taskType）、版本留档写入（api-version 编排）、provider 调用细节（P-01） |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 大纲/整稿共用 GenerationTask 子流程，taskType 区分 | 同一调度/回调/幂等框架 |
| D2 | 任务表冗余 channel_code/model_code 快照 | 路由可追溯，偏好变更不影响在途任务审计 |
| D3 | 首个版本成功回调内完成 Deck DRAFT→ITERATING 编排 | 跨聚合编排集中在任务成功回调（api-deck §2.3） |
| D4 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| GenerationTask | 子流程（同域独立聚合，本模块核心建模） | dl_generation_task |
| Outline | 值对象（写入 Deck.draftOutline） | 跨模块写 |
| DeckVersion | 产出（api-version 建模） | 成功回调写入 |

### 1.5 上下文映射

| 对方 | 关系 | 模式 |
|------|------|------|
| AI 网关域（P-01） | 任务执行委托 | 遵奉者（网关标准任务协议/回调） |
| 素材品牌域 | 素材/规范注入 | ACL+OHS |
| 渠道偏好域 | 模型路由输入 | 遵奉者 |
| 创作物/版本模块（本域） | 编排 | 域内直调 |

## 2. 跨聚合根设计

任务成功回调为跨聚合编排点（写 DeckVersion→移 Deck 指针→首版状态流转），不变量与编排定义见 api-deck §2；本模块不重复建模。

## 3. 应用/基础设施层设计

### 3.1 接口规范

同栈规约：POST 业务接口；Result\<T\>/PageResult\<T\>；任务列表返回 operList。进度查询提供批量轮询端点（客户端 2s 间隔），SSE 为增强通道（P-01 提供）。

### 3.2 依赖与约束

- 依赖：/deck/dict（前端）、素材 Select、渠道 Select。
- 约束：任务创建前置调用 DeckDomainService#assertCanCreateTask（INV-3）。

### 3.3 权限模型

会话+属主（同 api-deck §3.3）；任务全部接口强制 userId 归属校验。

### 3.4 公共规范

错误码：`BIZ_TASK_{ERROR}`（BIZ_TASK_DUPLICATE_RUNNING / BIZ_TASK_NOT_CANCELLABLE / BIZ_TASK_SCOPE_INVALID）；枚举 TaskType/TaskStatus（枚举池）。

## 4. 聚合根详细设计 — 生成任务 GenerationTask（子流程）

### 4.1 领域模型

| 表 | 类型 | 说明 |
|----|------|------|
| dl_generation_task | 主表（子流程独立聚合） | 任务 |

**主表字段（dl_generation_task）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | VARCHAR(32) | PK | 雪花 |
| task_code | VARCHAR(64) | ✅ | GT+yyMMdd+4 位 |
| deck_id | VARCHAR(32) | ✅ | 归属 |
| task_type | VARCHAR(32) | ✅ | TaskType |
| base_version_id | VARCHAR(32) | — | 基线版本（OUTLINE 空） |
| instruction_snapshot | JSON | ✅ | 入参快照（大纲快照/指令/scope/brandKitId/assetIds/usedTemplateIds/lengthOption） |
| channel_code / model_code | VARCHAR(64) | ✅ | 路由快照 |
| task_status | VARCHAR(32) | ✅ | TaskStatus |
| result_version_id | VARCHAR(32) | — | 成功产物（SUCCEEDED 必有） |
| error_msg | VARCHAR(512) | — | 失败摘要 |
| prompt_tokens / completion_tokens | INT | — | 用量计量回填 |
| user_id | VARCHAR(32) | ✅ | 属主 |
| data_version / delete_sign / 审计字段 | — | ✅ | 同规约（子表级：无 delete_sign 需求，保留以统一模板） |

不变量：同 deck 同时最多 1 个非终态任务（INV-8，唯一性以 deck_id+状态条件事务校验）；SUCCEEDED ⇔ result_version_id 非空。

### 4.2 状态模型

TaskStatus：QUEUED→RUNNING→SUCCEEDED/FAILED；QUEUED/RUNNING→CANCELLED。触发角色均为创作者（取消）或系统（回调推进）。驳回/撤回不适用。状态历史=任务表本身（终态留存）+ 操作日志。

### 4.3 子流程设计（I/O 契约）

| 子流程类型 | 触发 | 输入 | 输出 | 输出写入 |
|-----------|------|------|------|---------|
| OUTLINE | POST /gen/outline/generate | deckId、extraRequirement、assetIds[]、brandKitId、（路由） | 大纲 JSON | Deck.draftOutline（经编排） |
| FULL_GENERATE | POST /gen/full/generate | deckId、outlineSnapshot（确认版）、brandKitId、assetIds[]、lengthOption | 版本内容快照 JSON | 新 DeckVersion(source=FULL_GENERATE) + Deck 指针/状态编排 |

内部接口（网关协作，进程内）：submitToGateway(task)、onTaskCallback(taskId, status, result, usage)——幂等键=taskId+期望前置状态。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 发起大纲生成 | POST /gen/outline/generate | →taskId |
| 保存大纲编辑 | POST /gen/outline/save | 持久化 draftOutline |
| 发起整稿生成 | POST /gen/full/generate | →taskId |
| 任务列表 | POST /gen/task/list | 分页/按 deck/状态筛 |
| 任务详情 | POST /gen/task/detail | 含指令快照 |
| 任务进度批量查询 | POST /gen/task/progress | 轮询 {taskIds[]} |
| 取消任务 | POST /gen/task/cancel | QUEUED/RUNNING |
| 重试任务 | POST /gen/task/retry | FAILED→新任务 |
| 枚举字典 | POST /gen/dict/batch | TaskType/TaskStatus |

#### 接口详情（关键接口）

**POST /gen/outline/generate** — AO：deckId✅、extraRequirement(≤500)、assetIds[]（≤10，启用态）、brandKitId（启用态）。
规则：INV-3 守卫；INV-8 互斥；按偏好档位 OUTLINE 路由。VO：taskId、taskCode、taskStatus。

**POST /gen/outline/save** — AO：deckId✅、outline✅（节点树 JSON：[{nodeId,title,points[],note,pageHint}]）。校验：节点 1~50；title ≤50 字。VO：void。

**POST /gen/full/generate** — AO：deckId✅、outlineSnapshot✅（若 draftOutline 已确认可传 useDraft=true 省略）、brandKitId、assetIds[]、lengthOption(SHORT/MEDIUM/LONG，默认 MEDIUM)。
规则：deck 必须存在 draftOutline 或显式快照；守卫同上。VO：taskId。

**POST /gen/task/list** — AO：pageNum/pageSize、deckId(eq)、taskStatus(eq)、taskType(eq)、timeRange。
行 VO：taskId、taskCode、taskType、taskStatus、deckId/deckName 冗余、instructionBrief(指令或「大纲/整稿」摘要 ≤80 字)、channelCode/modelCode、resultVersionSeq、createdTime、operList[]。
operList：cancel(QUEUED/RUNNING)、retry(FAILED)。

**POST /gen/task/progress** — AO：taskIds[]（≤20）。VO：[{taskId,taskStatus,progressPercent,stageText}]（progress 为派生展示数据）。

**POST /gen/task/cancel** — 规则：仅 QUEUED/RUNNING，否则 BIZ_TASK_NOT_CANCELLABLE。
**POST /gen/task/retry** — 规则：仅 FAILED；新建任务复制 instruction_snapshot（同入参新实例）。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 任务创建 | gen_task_created | taskId/deckId/taskType | 网关调度（进程内） |
| 任务终态 | gen_task_finished | taskId/deckId/taskStatus/resultVersionId | 多端同步、客户端通知（SSE 推送） |

仓储契约：TaskRepository（互斥校验=事务内存在性查询 INV-8；终态幂等更新=filter 含前置状态）。
关联域调用：渠道偏好读取（路由）、素材域（注入时取规范/素材摘要）——均进程内直调。

## 5. 模块清单汇总

### 5.1 对外服务清单

无（任务查询为模块管理接口；进度 SSE 由网关域通道提供）。

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 任务互斥创建 | dl_generation_task | insertOne（多文档事务内存在性校验 INV-8） |
| 任务终态回调更新 | dl_generation_task | updateOne（filter 含前置状态，幂等） |
| 任务分页 | dl_generation_task | find（AO→查询字段白名单映射；skip/limit） |

### 5.3 MongoDB collection 设计（dl_generation_task）

| 项目 | 值 |
|------|-----|
| collection | dl_generation_task（子流程独立聚合=document；四类 taskType 共用） |
| 主键 | _id=ObjectId（仅存储，不进 VO）；task_id=业务主键（string，唯一索引，对外契约不变） |
| 嵌入 | instruction_snapshot=object（入参/指令快照整体嵌入，含 adjust 节值对象——api-adjustment §4.1；不可变快照） |
| 引用（仅存业务 id） | deck_id / base_version_id / result_version_id（跨聚合引用，string；SUCCEEDED⇔result_version_id 非空契约保留） |
| 快照语义 | channel_code/model_code 为路由快照 string 字段（非引用解引用） |
| 更新语义 | 状态推进 updateOne（filter 含 task_id+user_id+前置状态）；INV-8 互斥=事务内存在性查询 |

**字段清单（=v1 列平移，类型改 Mongo 文档类型）**

| 字段 | Mongo 类型 | 必填 | 说明 |
|------|-----------|------|------|
| task_id | string | ✅ | 业务主键（雪花串，唯一索引） |
| task_code | string | ✅ | GT+yyMMdd+4 位 |
| deck_id | string | ✅ | 归属（跨聚合引用） |
| task_type | string | ✅ | TaskType |
| base_version_id | string | — | 基线版本（OUTLINE 空；跨聚合引用） |
| instruction_snapshot | object | ✅ | 入参快照（大纲快照/指令/scope/brandKitId/assetIds/usedTemplateIds/lengthOption，整体嵌入） |
| channel_code / model_code | string | ✅ | 路由快照 |
| task_status | string | ✅ | TaskStatus |
| result_version_id | string | — | 成功产物（SUCCEEDED 必有；跨聚合引用） |
| error_msg | string | — | 失败摘要 |
| prompt_tokens / completion_tokens | number | — | 用量计量回填 |
| user_id | string | ✅ | 属主 |
| data_version / delete_sign | number | ✅ | 同规约（子流程级无 delete_sign 需求，保留统一模板） |
| created_by/name、updated_by/name | string | ✅ | 审计 |
| created_time / updated_time | date | ✅ | 审计 |

**索引（schema 声明式创建，06 §3.5）**

| 索引 | 字段 | 约束 |
|------|------|------|
| uk_task_id | task_id | unique |
| idx_deck_status | deck_id, task_status | — |
| idx_user_created | user_id, created_time | — |

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成；任务子流程供 C-03 复用 |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→dl_generation_task collection 设计（instruction_snapshot 嵌入/跨聚合引用/索引）；§4.5 MQ→进程内事件（businessType 不变）；INV-8 互斥与终态幂等平移 Mongo 事务语义。接口契约冻结不变 |
| v1.2 | 2026-10-08 | restored | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：§4.5 gen_task_finished 订阅方恢复「多端同步、客户端通知（SSE 推送）」v1 原订阅方。契约与 collection 设计不变 |
