# API 设计 — 创作物管理与定稿（C-01 / C-05）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-01 创作物管理、C-05 定稿管理 |
| 接口域 | deck |
| 功能类型 | 业务流程类（状态机驱动，无审批） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | prd-deck.md v1.2 / domain-model.md v1.2 |

## 1. 模块设计概述

### 1.1 业务背景及目标

以「创作物」为项目单元组织 AI 内容创作：建立、检索、归档恢复、状态机管理与定稿锁定/解锁。是全产品数据主链的根。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 创作物 CRUD/归档/恢复/软删除、状态机、定稿/解锁、当前版本指针维护、草稿大纲字段承载 | 版本内容管理（api-version）、生成/调整任务（api-generation/adjustment）、导出（api-delivery）、多用户协作 |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 隔离字段用 `user_id` 替代规约 company_id 三字段组（ADR-005） | 个人单用户产品无公司维度；其余公共字段层照用 |
| D2 | 定稿/解锁为 Deck 状态机动作接口（非审批流） | 个人产品自确认语义，无审批角色 |
| D3 | 无 submit/withdraw/approve 标准单据动作 | 无审批链；状态守卫内建于动作接口 |
| D4 | draft_outline 存 Deck 表 JSON 字段 | 大纲是生成前中间产物，首个版本生成后转只读 |
| D5 | 管理模式：全自管（混合模式声明 MIXED，当前无托管数据源） | 无外部系统同步；接口形态取自管列 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 创作物 Deck | 聚合根（本模块核心建模） | dl_deck |
| 内容版本 DeckVersion | 跨模块聚合根（api-version 建模） | 树挂接在本聚合根下 |
| 大纲 Outline | 值对象（Deck.draftOutline） | JSON |
| 品牌规范 BrandKit | 关联领域对象 | defaultBrandKitId 引用，api-assets 建模 |

### 1. 5 上下文映射

| 对方上下文 | 关系 | 模式 |
|-----------|------|------|
| 素材品牌域 | 引用默认品牌规范 | ACL+OHS（ID 引用） |
| 版本管理（本域内跨模块） | Deck↔DeckVersion 双聚合协作 | 见第 2 章 |
| 账号域 | user 上下文 | 遵奉者 |

## 2. 跨聚合根设计

### 2.1 聚合根关系图

```
Deck(聚合根) ──1:N──▶ DeckVersion(聚合根, dl_deck_version)
     │ currentVersionId/finalVersionId ──▶ DeckVersion.id（跨聚合指针）
     └──0..1──▶ BrandKit（关联领域对象, ID 引用）
```

### 2.2 跨聚合根不变量

| # | 不变量 | 守卫位置 |
|---|--------|---------|
| INV-1 | currentVersionId 若非空，必须指向本 Deck 的版本 | rollback/fork/任务回调（Deck 应用服务统一入口） |
| INV-2 | FINALIZED 态 finalVersionId 必有值且指向树内版本 | finalize 动作 |
| INV-3 | FINALIZED/ARCHIVED 态禁止创建生成/调整任务 | 任务创建前校验（调用侧执行，Deck 提供校验服务） |
| INV-4 | 首个版本创建成功 → Deck 由 DRAFT 流转 ITERATING（有且仅有一次） | 任务成功回调编排 |

### 2.3 跨聚合根编排

| 编排 | 步骤 | 一致性 |
|------|------|--------|
| 整稿生成成功 | 写 DeckVersion → 更新 Deck.currentVersionId →（首版）DRAFT→ITERATING | 同事务（同服务同库） |
| 回退/分叉 | 校验版本归属 → 更新 Deck.currentVersionId/activeBranch | 单事务 |

## 3. 应用/基础设施层设计

### 3.1 接口规范

- 路径 `/{domain}/{resource}/{action}`，domain=deck；业务接口统一 POST，下载 GET。
- 响应统一 `Result<T>`（status/code/msg/data）；分页 `PageResult<T>`；pageNum 默认 1 / pageSize 默认 20。
- 列表返回 operList（业务单据规约 §4.4）。
- 字典统一 `POST /deck/dict/batch`。

### 3.2 依赖与约束

- 单服务 deck-loop-core，模块间进程内直调（无跨服务调用）。
- 依赖：无（被 generation/adjustment/version/delivery 依赖）。

### 3.3 权限模型

个人单用户产品：不建 RBAC 矩阵。全部接口=登录会话 + `user_id` 属主数据隔离（所有查询/写操作强制 user_id 条件）。operList 由 DeckStatus 驱动（见 4.4）。

### 3.4 公共规范

- 错误码：`BIZ_DECK_{ERROR}`（如 BIZ_DECK_STATUS_FORBIDDEN / BIZ_DECK_NOT_FOUND / BIZ_DECK_TASK_RUNNING）。
- 枚举：DeckType / DeckStatus（枚举池 04-business-enum.md）。

## 4. 聚合根详细设计 — 创作物 Deck

### 4.1 领域模型

#### 表结构组合

| 表 | 类型 | 说明 |
|----|------|------|
| dl_deck | 主表 | 创作物 |
| dl_deck_log | 操作日志表 | 只追加（平台框架） |

#### 领域对象及角色

| 对象 | 角色 | 表 |
|------|------|-----|
| Deck | 聚合根 | dl_deck |
| Outline | 值对象 | dl_deck.draft_outline(JSON) |

#### 主表字段（dl_deck）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deck_id | VARCHAR(32) | PK | 雪花 |
| deck_code | VARCHAR(64) | ✅ | 系统生成规则编码 DL+yyMMdd+4 位序列 |
| deck_name | VARCHAR(100) | ✅ | 名称 |
| deck_type | VARCHAR(32) | ✅ | DeckType，首期仅 DECK |
| topic | VARCHAR(200) | ✅ | 主题 |
| requirement | TEXT | — | 需求描述 |
| deck_status | VARCHAR(32) | ✅ | DeckStatus |
| draft_outline | JSON | — | 草稿大纲（节点树） |
| default_brand_kit_id | VARCHAR(32) | — | 默认品牌规范 |
| current_version_id | VARCHAR(32) | — | 当前版本指针（DRAFT 空） |
| active_branch | VARCHAR(50) | ✅ | 默认 main |
| final_version_id | VARCHAR(32) | — | 定稿版本 |
| archived_from_status | VARCHAR(32) | — | 归档前状态（恢复用） |
| user_id | VARCHAR(32) | ✅ | 属主（隔离字段，替代 company 组，ADR-005） |
| data_version | INT | ✅ | 乐观锁 |
| delete_sign | INT(1) | ✅ | 逻辑删除 |
| created_by/name/time、updated_by/name/time | — | ✅ | 审计 |

#### 不变量（域内）

| # | 不变量 |
|---|--------|
| INV-5 | deck_name 非空 ≤100；topic 非空 ≤200 |
| INV-6 | active_branch 同 Deck 内分支名唯一（与 dl_deck_version.branch_name 联合校验） |
| INV-7 | 默认规范若填必须存在且启用 |

#### 领域服务

| 服务 | 职责 |
|------|------|
| DeckDomainService#assertCanCreateTask(deck) | INV-3 守卫（供任务模块调用） |
| DeckDomainService#onFirstVersionCreated(deck) | INV-4 编排 |
| DeckDomainService#movePointer(deck, versionId, branch?) | 指针/分支统一入口（INV-1） |

### 4.2 状态模型

见枚举池 DeckStatus；流转表：

| 流转 | 动作接口 | 守卫 |
|------|---------|------|
| DRAFT→ITERATING | （任务回调，自动） | 首版生成成功 |
| ITERATING→FINALIZED | /deck/deck/finalize | 无进行中任务；currentVersionId 非空 |
| FINALIZED→ITERATING | /deck/deck/unfinalize | 确认参数 confirm=true |
| →ARCHIVED | /deck/deck/archive | 无进行中任务；记录 archivedFromStatus |
| ARCHIVED→(archivedFromStatus) | /deck/deck/restore | — |
| ARCHIVED→删除 | /deck/deck/delete | 软删除（delete_sign=1），仅 ARCHIVED 可删 |

驳回/撤回：不适用（无审批）。状态历史：操作日志承载。

### 4.3 子流程设计

本聚合根无子流程（生成任务子流程见 api-generation 4.3）。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 | operList/权限 |
|------|----------|------|--------------|
| 创作物列表 | POST /deck/deck/list | 分页+筛选 | 会话+属主 |
| 创作物保存 | POST /deck/deck/save | 新建/编辑（id 空新建） | 会话+属主 |
| 创作物详情 | POST /deck/deck/detail | withStats/withLatestTask 开关 | 会话+属主 |
| 创作物归档 | POST /deck/deck/archive | 状态动作 | 会话+属主 |
| 创作物恢复 | POST /deck/deck/restore | 状态动作 | 会话+属主 |
| 创作物删除 | POST /deck/deck/delete | 软删除（仅 ARCHIVED） | 会话+属主 |
| 定稿 | POST /deck/deck/finalize | 状态动作 | 会话+属主 |
| 解锁定稿 | POST /deck/deck/unfinalize | 状态动作 | 会话+属主 |
| 枚举字典 | POST /deck/dict/batch | DeckType/DeckStatus | 会话 |

#### 接口详情（关键接口）

**POST /deck/deck/list**

ListAO：pageNum、pageSize、keyword（名称 like）、deckType(eq)、deckStatus(eq)、timeRange(createdTime between)、archivedScope(0=默认不含归档/1=仅归档)。

行 VO：deckId、deckCode、deckName、deckType、topic、deckStatus、currentVersionSeq、versionCount、adjustCount、activeBranch、defaultBrandKitName、createdTime、updatedTime、operList[]。

operList 计算：

| 操作 key | 显示条件（DeckStatus） |
|---------|----------------------|
| edit | DRAFT/ITERATING |
| finalize | ITERATING 且无进行中任务 |
| unfinalize | FINALIZED |
| archive | DRAFT/ITERATING/FINALIZED 且无进行中任务 |
| restore | ARCHIVED |
| delete | ARCHIVED |

校验规则：archivedScope=1 时 deckStatus 筛选强制 ARCHIVED。

**POST /deck/deck/save**

SaveAO：deckId(空=新建)、deckName✅、deckType✅(仅 DECK)、topic✅、requirement、defaultBrandKitId。
校验：INV-5/INV-7；新建时初始化 deck_code/deck_status=DRAFT/active_branch=main；编辑仅 DRAFT/ITERATING 态可改基本信息（FINALIZED/ARCHIVED 拒绝，BIZ_DECK_STATUS_FORBIDDEN）。

**POST /deck/deck/detail**

DetailAO：deckId、withStats(bool，默认 false)、withLatestTask(bool)。
DetailVO：主表全字段 + brandKitName 冗余展示 + stats{versionCount,adjustCount,exportCount}（开关）+ latestTask{taskId,taskType,taskStatus}（开关）。

**POST /deck/deck/finalize**

AO：deckId、confirm(true)。
规则：守卫=无进行中任务（BIZ_DECK_TASK_RUNNING）+ currentVersionId 非空；finalVersionId=currentVersionId；写操作发布进程内事件（见 4.5）。

**POST /deck/deck/unfinalize**：AO：deckId、confirm。规则：仅 FINALIZED；回 ITERATING；finalVersionId 保留（最近定稿记录）。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 创作物状态变更 | deck_deck_status-changed | deckId/deckStatus/userId | 多端同步（P-02）、客户端通知 |

仓储契约：DeckRepository（byId+userId、page、指针更新乐观锁）。
关联域调用：无出站（BrandKit 名称经素材域 Select 冗余，列表展示用）。

## 5. 模块清单汇总

### 5.1 对外服务清单

| 服务 | 路径 | 说明 |
|------|------|------|
| deck.select.deckList | POST /deck/select/deck-list | 选择池登记（导出筛选等） |

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 创作物分页查询 | dl_deck | find（user_id+筛选，AO→查询字段白名单映射；skip/limit） |
| 状态动作更新 | dl_deck | updateOne（filter 含 data_version 乐观锁，$inc data_version） |

### 5.3 MongoDB collection 设计（dl_deck）

| 项目 | 值 |
|------|-----|
| collection | dl_deck（聚合根 Deck=document；操作日志 dl_deck_log 为平台框架只追加 collection，不占十集合清单） |
| 主键 | _id=ObjectId（仅存储，不进 VO）；deck_id=业务主键（string，唯一索引，对外契约不变） |
| 嵌入 | draft_outline=object（大纲节点树，无独立生命周期值对象，整体嵌入） |
| 引用（仅存业务 id） | default_brand_kit_id / current_version_id / final_version_id（跨聚合指针，string；完整性由 INV-1/INV-2 应用层守卫） |
| 更新语义 | 可更新文档；dataVersion 乐观锁；delete_sign 逻辑删除（查询默认 0） |

**字段清单（=v1 列平移，类型改 Mongo 文档类型）**

| 字段 | Mongo 类型 | 必填 | 说明 |
|------|-----------|------|------|
| deck_id | string | ✅ | 业务主键（雪花串，唯一索引） |
| deck_code | string | ✅ | 系统生成规则编码 DL+yyMMdd+4 位序列 |
| deck_name | string | ✅ | 名称 |
| deck_type | string | ✅ | DeckType，首期仅 DECK |
| topic | string | ✅ | 主题 |
| requirement | string | — | 需求描述 |
| deck_status | string | ✅ | DeckStatus |
| draft_outline | object | — | 草稿大纲（节点树，整体嵌入） |
| default_brand_kit_id | string | — | 默认品牌规范（跨聚合引用） |
| current_version_id | string | — | 当前版本指针（DRAFT 空） |
| active_branch | string | ✅ | 默认 main |
| final_version_id | string | — | 定稿版本 |
| archived_from_status | string | — | 归档前状态（恢复用） |
| user_id | string | ✅ | 属主（隔离字段，ADR-005） |
| data_version | number | ✅ | 乐观锁 |
| delete_sign | number | ✅ | 逻辑删除 |
| created_by/name、updated_by/name | string | ✅ | 审计 |
| created_time / updated_time | date | ✅ | 审计 |

**索引（schema 声明式创建，06 §3.5）**

| 索引 | 字段 | 约束 |
|------|------|------|
| uk_deck_id | deck_id | unique |
| idx_user_status | user_id, deck_status, delete_sign | — |
| idx_user_updated | user_id, updated_time | — |

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成（PRD/领域模型输入） |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→dl_deck collection 设计（嵌入/引用/索引）；§4.5 MQ→进程内事件（businessType 不变）；§5.2 SQL→数据访问清单。接口路径/AO/VO/错误码/枚举契约冻结不变 |
| v1.2 | 2026-10-08 | restored | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：§4.5 事件订阅方恢复「多端同步（P-02）、客户端通知」v1 原订阅方。契约与 collection 设计不变 |
