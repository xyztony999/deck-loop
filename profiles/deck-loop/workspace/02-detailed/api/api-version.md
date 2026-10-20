# API 设计 — 版本管理（C-04）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-04 版本管理 |
| 接口域 | ver |
| 功能类型 | 业务流程类（不可变版本聚合 + 只读分析 + 指针编排） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | prd-version.md v1.1 / domain-model.md v1.2 |

## 1. 模块设计概述

### 1.1 业务背景及目标

语言迭代的产物组织：自动留档不可变版本、树状谱系、双版本对比、回退与分叉——「每句话的结果可找回、可比较、可重来」。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 版本树查询、版本详情（内容快照）、双版本对比（过程数据）、回退/分叉（写 Deck 指针）、版本留档写入（任务回调编排） | 版本编辑/删除（不可变）、跨创作物合并、版本备注标注 |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | DeckVersion 独立聚合根，内容快照 JSON 单列 | 避免巨型聚合；对比/分叉以版本为中心（ADR-002） |
| D2 | versionSeq 为谱系内自增序号（deck 维度），展示用；真实排序靠树边+时间 | 人类可读 |
| D3 | 回退=移指针；若随后在历史基线上继续调整，产出 parent=该历史版本的新版本（同分支线性追加） | 历史不可变且不丢路径 |
| D4 | 对比结果为 P7 过程数据，实时计算不落库 | 数据量小、无复用价值 |
| D5 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 内容版本 DeckVersion | 聚合根（本模块核心建模） | dl_deck_version |
| 页面/内容块 | 值对象（content JSON 内） | blockType: text/image/placeholder |
| Deck | 关联聚合根（指针写回） | api-deck 建模 |

### 1.5 上下文映射

域内与 Deck 双聚合协作（api-deck §2）；素材域（content 内 assetId 引用，渲染时经 OHS 取文件）；无外部系统。

## 2. 跨聚合根设计

指针不变量 INV-1/INV-2 与编排（回退/分叉/留档）统一走 api-deck §2.2/§2.3 定义的 DeckDomainService#movePointer / 任务成功编排；本模块发起调用，不重复实现。

## 3. 应用/基础设施层设计

### 3.1 接口规范

同栈规约；POST 业务接口；对比接口响应体积大（分页按页返回差异）。

### 3.2 依赖与约束

- 依赖：无出站模块依赖（被 deck/detail、export、演示消费）。
- 约束：版本写入仅由任务成功回调路径（禁止任何 update content 的接口存在）。

### 3.3 权限模型

会话+属主（deck→version 级联归属校验）。

### 3.4 公共规范

错误码：BIZ_VERSION_{ERROR}（BIZ_VERSION_NOT_FOUND / BIZ_VERSION_BRANCH_EXISTS / BIZ_VERSION_SAME_COMPARE）；枚举 VersionSourceType（枚举池）。

## 4. 聚合根详细设计 — 内容版本 DeckVersion

### 4.1 领域模型

| 表 | 类型 | 说明 |
|----|------|------|
| dl_deck_version | 主表（独立聚合） | 版本 |

**主表字段（dl_deck_version）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| version_id | VARCHAR(32) | PK | 雪花 |
| deck_id | VARCHAR(32) | ✅ | 归属 |
| version_seq | INT | ✅ | 谱系内序号（deck 维度自增） |
| branch_name | VARCHAR(50) | ✅ | 分支（首版=main） |
| parent_version_id | VARCHAR(32) | — | 首版为空 |
| source_type | VARCHAR(32) | ✅ | VersionSourceType |
| task_id | VARCHAR(32) | ✅ | 来源任务 |
| instruction_snapshot | JSON | ✅ | 来源指令/入参快照（含 scope/brand/assetIds/outline 快照） |
| content | JSON | ✅ | 页面树快照（pages[]→blocks[]，文本/图片引用/布局） |
| content_hash | VARCHAR(64) | ✅ | content SHA-256（对比加速/一致性校验） |
| page_count | INT | ✅ | 冗余 |
| user_id | VARCHAR(32) | ✅ | 属主 |
| 审计字段 | — | ✅ | 同规约；**无 data_version/delete_sign**（不可变，只插入） |

**页面树 content JSON 契约（值对象）**

```
{ pages: [ { pageId, layout, title, note(演讲者备注),
    blocks: [ { blockId, blockType: TEXT|IMAGE|PLACEHOLDER,
                text?: string, assetId?: string, style?: {} } ] } ] }
```

不变量：INV-11 版本插入后任何字段不可更新（仓储层仅 insert）；INV-12 branch_name 同 deck 唯一（含 dl_deck.active_branch 联合）；INV-13 parent_version_id 若非空必须同 deck 存在。

冗余字段：page_count（树浏览列表免解析 JSON）。

### 4.2 状态模型

版本无状态机（不可变）。指针/分支状态属 Deck（api-deck §4.2）。

### 4.3 子流程设计

无（版本由任务子流程产出）。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 版本树 | POST /ver/version/tree | 谱系树（节点摘要） |
| 版本详情 | POST /ver/version/detail | 含 content 快照 |
| 版本对比 | POST /ver/version/compare | 双版本差异（过程数据） |
| 版本回退 | POST /ver/version/rollback | 移当前指针 |
| 版本分叉 | POST /ver/version/fork | 新命名分支 |
| 枚举字典 | POST /ver/dict/batch | VersionSourceType |

#### 接口详情（关键接口）

**POST /ver/version/tree** — AO：deckId、branchScope(ALL/ACTIVE 默认 ACTIVE)。
VO：tree（节点递归：versionId/versionSeq/branchName/sourceType/instructionBrief/taskStatusOfSource/createdTime/isCurrent/isFinal/children[]）+ branches[{branchName,headVersionId,versionCount,isActive}]。

**POST /ver/version/detail** — AO：versionId。VO：全字段 + content 完整 JSON（体积大，前端按页虚拟渲染）。

**POST /ver/version/compare** — AO：deckId、leftVersionId、rightVersionId。
VO：sameHash(bool)、pages[{pageId,leftIndex,rightIndex,changeKind(NONE/STRUCTURE/TEXT/IMAGE/NEW/REMOVED),diffBlocks[{blockId,changeKind}]}]。
规则：同版本比较拒绝（BIZ_VERSION_SAME_COMPARE）；差异按页返回。

**POST /ver/version/rollback** — AO：deckId、versionId、confirm(true)。
规则：版本归属校验；Deck 须 ITERATING（FINALIZED 需先解锁）；经 movePointer（INV-1）；操作日志记录前后指针。

**POST /ver/version/fork** — AO：deckId、versionId、branchName✅(≤50，同 deck 唯一)。
规则：branchName 冲突 BIZ_VERSION_BRANCH_EXISTS；分叉头=versionId；activeBranch 切换至新分支。

operList（树节点）：set-current(rollback 语义)、fork-from、export-from(已定稿限制)——由 Deck 状态驱动。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 版本留档 | ver_version_created | versionId/deckId/versionSeq/branchName | 多端同步、客户端通知 |

仓储契约：VersionRepository（insert-only=仅 insertOne；tree 查询=deck_id 全量取回内存组树；seq 分配=deck 维度多文档事务内取 max+1）。

## 5. 模块清单汇总

### 5.1 对外服务清单

无（版本读取经 detail/tree 管理接口消费）。

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 版本插入（seq 分配） | dl_deck_version | insertOne（seq=deck 维度事务内取 max+1） |
| 版本树查询 | dl_deck_version | find（deck_id 全量，内存组树） |
| 对比取两版 | dl_deck_version | find（两个业务 id，白名单映射） |

### 5.3 MongoDB collection 设计（dl_deck_version）

| 项目 | 值 |
|------|-----|
| collection | dl_deck_version（独立聚合=document；v3 决策 2：版本内容快照本就是不可变 JSON 文档，天然文档形态） |
| 主键 | _id=ObjectId（仅存储，不进 VO）；version_id=业务主键（string，唯一索引，对外契约不变） |
| 嵌入 | content=object（页面树快照**整体嵌入文档**：pages[]→blocks[]，不可变）；instruction_snapshot=object（来源指令/入参快照整体嵌入，含 scope/brand/assetIds/outline 快照） |
| 引用（仅存业务 id） | deck_id / parent_version_id / task_id（跨聚合引用，string；INV-13 应用层守卫） |
| 不可变语义 | 仓储仅 insertOne（INV-11），无任何 update 路径；无 data_version/delete_sign（沿用 v1 不可变约定）；version_seq 冗余列平移（树浏览列表免解析 content） |

**字段清单（=v1 列平移，类型改 Mongo 文档类型）**

| 字段 | Mongo 类型 | 必填 | 说明 |
|------|-----------|------|------|
| version_id | string | ✅ | 业务主键（雪花串，唯一索引） |
| deck_id | string | ✅ | 归属（跨聚合引用） |
| version_seq | number | ✅ | 谱系内序号（deck 维度自增） |
| branch_name | string | ✅ | 分支（首版=main） |
| parent_version_id | string | — | 首版为空（跨聚合引用） |
| source_type | string | ✅ | VersionSourceType |
| task_id | string | ✅ | 来源任务（跨聚合引用） |
| instruction_snapshot | object | ✅ | 来源指令/入参快照（整体嵌入） |
| content | object | ✅ | 页面树快照（pages[]→blocks[]，整体嵌入；契约见 §4.1） |
| content_hash | string | ✅ | content SHA-256（对比加速/一致性校验） |
| page_count | number | ✅ | 冗余 |
| user_id | string | ✅ | 属主 |
| created_by/name | string | ✅ | 审计 |
| created_time | date | ✅ | 审计 |

**索引（schema 声明式创建，06 §3.5）**

| 索引 | 字段 | 约束 |
|------|------|------|
| uk_version_id | version_id | unique |
| uk_deck_branch | deck_id, branch_name, version_seq | unique（复合） |
| idx_deck_parent | deck_id, parent_version_id | — |

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成 |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→dl_deck_version collection 设计（content/instruction_snapshot 整体嵌入、跨聚合仅存 id、uk 复合唯一索引）；§4.5 MQ→进程内事件（businessType 不变）；seq 分配改事务内 max+1。接口契约与 content JSON 契约冻结不变 |
| v1.2 | 2026-10-08 | restored | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：§4.5 ver_version_created 订阅方恢复「多端同步、客户端通知」v1 原订阅方。契约与 collection 设计不变 |
