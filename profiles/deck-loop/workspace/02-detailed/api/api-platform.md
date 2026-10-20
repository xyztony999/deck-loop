# API 设计 — AI 生成网关 · 账号与设备同步（P-01 / P-02）

| 属性 | 值 |
|------|-----|
| 模块编码 | P-01 AI 生成网关、P-02 账号与设备同步（平台支撑域；v1.2 复议恢复多端同步，ADR-013） |
| 接口域 | auth（账号）/ gw（网关内部） |
| 功能类型 | 平台支撑（通用能力，薄业务建模） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | prd-platform.md v2.1 / domain-model.md v1.2 |

## 1. 模块设计概述

### 1.1 业务背景及目标

P-01：统一收口外部大模型调用（provider 适配/密钥托管/路由/重试/任务调度/计量），业务域不感知厂商。P-02：账号会话与多端同步（云端唯一主数据源）。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 渠道/模型清单下发、任务调度与回调、用量计量、SSE 进度通道、注册/登录/退出/资料、增量同步拉取 | 渠道运营后台（首期配置直配）、第三方登录、协作冲突解决（单用户无冲突）、素材双向同步（单向上传） |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 网关与业务任务同表共治：dl_generation_task 业务字段归 C-02/C-03，网关负责状态推进与计量回填 | 单服务无跨服务事务；聚合归属清晰 |
| D2 | 密钥仅网关配置域可读（服务端 env/config），无任何接口回显 | 安全红线（prd-platform 规则 1） |
| D3 | 同步用单调游标（拉增量式）；v3 Mongo 实现：游标=Date 毫秒+(聚合内业务 id) 复合推进 | 单用户无冲突，拉式最简；毫秒+id 复合消除 v1 MySQL 秒精度截断重投（ADR-013） |
| D4 | SSE 进度通道为增强，轮询 /gen/task/progress 为兜底 | 弱网可用性 |
| D5 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 账号 Account | 聚合根（通用，薄） | dl_account |
| ChannelModel | 注册数据（服务端配置来源） | 渠道清单（env/config 注册，进程内读缓存） |
| UsageRecord | 实体（日志型只追加） | dl_usage_record |
| GenerationTask | 跨模块聚合（api-generation 建模） | 网关侧负责状态推进 |

### 1.5 上下文映射

| 对方 | 关系 | 模式 |
|------|------|------|
| 外部 AI provider | 出站集成 | ACL（provider 适配器隔离厂商模型） |
| 业务域（C-02/C-03/D-01） | 被调用 | OHS（标准任务/清单/回调协议） |
| 全域 | 账号会话 | 遵奉者（消费方） |

## 2. 跨聚合根设计

不适用（任务跨模块协作已在 api-generation/api-deck 定义；网关侧仅推进状态）。

## 3. 应用/基础设施层设计

### 3.1 接口规范

POST 业务接口；登录态 token 返回；SSE 端点 GET /gw/task/stream（会话鉴权）；Provider/Select 分类：渠道选择器经 /channel/select/model-options（api-channel 登记），网关内部接口不暴露 Gateway。

### 3.2 依赖与约束

- 出站：外部 AI provider HTTP（适配器接口 AiProviderAdapter：generateOutline/generateContent/adjustContent；实现=**OpenAI 兼容协议适配器 + Mock 渠道**，Mock 供开发/演示）。
- 幂等：provider 调用幂等键=taskId；回调重复投递以终态守卫。

### 3.3 权限模型

会话+属主；注册/登录免鉴权；网关内部回调走服务内进程调用（不暴露）。

### 3.4 公共规范

错误码：BIZ_AUTH_{ERROR}（BIZ_AUTH_CREDENTIALS / BIZ_AUTH_EMAIL_EXISTS / BIZ_AUTH_SESSION_EXPIRED）、BIZ_GW_{ERROR}（BIZ_GW_PROVIDER_TIMEOUT / BIZ_GW_PROVIDER_FAILED / BIZ_GW_QUOTA_EXCEEDED）；枚举 AccountStatus（枚举池）。

## 4. 聚合根详细设计

### 4.1 领域模型 — Account（首位聚合根）

| 表 | 类型 | 说明 |
|----|------|------|
| dl_account | 主表 | 账号 |
| dl_usage_record | 日志表（只追加） | 用量计量 |

**dl_account**：account_id PK、email✅(唯一)、password_hash✅、nickname✅、account_status✅(AccountStatus)、last_login_at、审计字段（无 user_id——自身即主体；无 delete_sign 需求，保留统一模板）。

**dl_usage_record**：usage_id PK、user_id✅、task_id✅、task_type✅、channel_code/model_code✅、prompt_tokens/completion_tokens INT✅、occurred_at✅；只追加无版本/删除标记（规约日志表）。

**渠道注册（服务端配置 gw-channel-registry，env/config 文件，v3 起不建表不暴露接口）**：channel_code✅、channel_name、model_code/model_name、capability_tags JSON、enabled、priority、密钥引用（env/config 加密存储，不进任何 VO、不进库）。适配器：OpenAI 兼容协议适配器 + Mock 渠道（ADR-010 语义保留：密钥仅服务端）。进程内读缓存。

不变量：INV-24 email 全局唯一；INV-25 并发任务 ≤3/用户（超出排队）；INV-26 密钥不出网关域（静态检查）。

### 4.2 状态模型

任务状态推进（QUEUED→RUNNING→终态）由网关调度器驱动，状态机定义见 api-generation §4.2（同一状态机，此处不重复）；账号无状态机（AccountStatus 启停）。

### 4.3 子流程设计

无独立子流程（调度器为平台机制：队列消费→适配器调用→回调业务编排）。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 注册 | POST /auth/account/register | |
| 登录 | POST /auth/account/login | →token |
| 退出 | POST /auth/account/logout | |
| 账户资料 | POST /auth/account/profile | 读/改昵称 |
| 增量同步 | POST /auth/sync/pull | 游标拉取 |
| 任务进度流 | GET /gw/task/stream | SSE（增强） |

#### 接口详情（关键接口）

**POST /auth/account/register** — AO：email✅(格式)、password✅(≥8 位)、nickname✅。规则：INV-24（BIZ_AUTH_EMAIL_EXISTS）。VO：accountId、nickname。

**POST /auth/account/login** — AO：email、password。规则：失败 5 次锁 10 分钟（BIZ_AUTH_CREDENTIALS）。VO：token(30 天滑动)、nickname、syncCursor 初始。

**POST /auth/sync/pull** — AO：lastCursor(long，首次 0)。
VO：changes[{aggregate: DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT, op: UPSERT/DELETE, id, cursor, payload 摘要或全量}]、newCursor、hasMore。
规则：服务端各 collection 维护单调 cursor（写时分配；Mongo 游标=Date 毫秒+(聚合内业务 id) 复合推进，规约见 06-node-api-conventions §3.6）；单页 ≤200 条变更。

**GET /gw/task/stream** — Query：deckId(可选过滤)。SSE 事件：task-progress{taskId,percent,stageText}、task-finished{taskId,taskStatus}。心跳 15s。
Node 实现：GET 路由直接回写 text/event-stream 响应流（headers 设 Connection: keep-alive，禁用代理缓冲），事件名/载荷与 v1 SSE 完全一致。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 任务状态推进 | gw_task_advanced | taskId/taskStatus | SSE 下发、同步游标分配 |
| 用量入账 | gw_usage_recorded | usageId/taskId/tokens | 统计聚合（D-01） |

仓储契约：AccountRepository、UsageRecordRepository（append=insertOne）；渠道注册读缓存（服务端配置）。

## 5. 模块清单汇总

### 5.1 对外服务清单

| 服务 | 路径 | 消费方 |
|------|------|--------|
| 渠道/模型清单（内部 OHS） | 进程内 ChannelRegistryService#listEnabled | api-channel Select（域内） |
| 任务执行（内部 OHS） | 进程内 GatewayTaskService#execute(task) | C-02/C-03（域内） |

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 账号注册/登录 | dl_account | insertOne / findOne（uk_email） |
| 用量入账 | dl_usage_record | insertOne（只追加） |
| 同步变更扫描（SyncChangeScanner） | 八聚合业务 collection（DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT） | find（(updated_time, 业务id) 升序、$gt [cursor,id] 复合推进分页，06 §3.6） |

### 5.3 MongoDB collection 设计

#### dl_account（聚合根 Account=document）

| 项目 | 值 |
|------|-----|
| 主键 | _id=ObjectId（仅存储，不进 VO）；account_id=业务主键（string，唯一索引） |
| 嵌入 | 无（薄账号标量字段） |
| 引用 | 无（自身即主体，无 user_id 隔离字段；会话 token 不落库，内存/缓存会话） |
| 更新语义 | 资料/登录时间 updateOne；INV-24 email 唯一由 uk_email 兜底 |

字段清单（=v1 列平移，类型改 Mongo 文档类型）：account_id(string,✅,业务主键)、email(string,✅,唯一)、password_hash(string,✅)、nickname(string,✅)、account_status(string,✅,AccountStatus)、last_login_at(date,—)、data_version/delete_sign(number,✅,无 delete_sign 需求保留统一模板)、审计（by/name=string、time=date）。

索引：uk_account_id{account_id}unique；uk_email{email}unique。

#### dl_usage_record（日志型实体=document，只追加）

| 项目 | 值 |
|------|-----|
| 主键 | _id=ObjectId（仅存储）；usage_id=业务主键（string，唯一索引） |
| 嵌入 | 无（计量标量） |
| 引用（仅存业务 id） | user_id / task_id（跨聚合引用，string）；channel_code/model_code 为路由快照 |
| 更新语义 | 只追加 insertOne，无版本/删除标记（06 §3.1 日志型） |

字段清单（=v1 列平移）：usage_id(string,✅,业务主键)、user_id(string,✅)、task_id(string,✅)、task_type(string,✅)、channel_code/model_code(string,✅)、prompt_tokens/completion_tokens(number,✅,默认 0)、occurred_at(date,✅)。

索引：uk_usage_id{usage_id}unique；idx_user_time{user_id, occurred_at}；idx_task{task_id}。

> 渠道注册不建 collection：v3 起为服务端配置（env/config，密钥仅服务端；OpenAI 兼容适配器 + Mock）。索引以 schema 声明式创建（06 §3.5）。

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成 |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→dl_account/dl_usage_record collection 设计；§4.5 MQ→进程内事件（businessType 不变）；渠道注册改服务端配置（env/config，密钥仅服务端；OpenAI 兼容适配器 + Mock）；GET /gw/task/stream 补 Node SSE 实现说明。账号 4 接口与网关任务/回调/用量接口契约冻结不变 |
| v1.1 | 2026-10-08 | interface_removed | 删除 POST /auth/sync/pull 及专用配套（ADR-013）：登录 VO 去 syncCursor、游标扫描机制（原 D3/SyncChangeScanner）删除、SyncChangeOp 枚举标废弃（03-common-enums）；无专用错误码需废弃。其余 65 端点契约不变 |
| v1.2 | 2026-10-08 | structural | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：模块复名「账号与设备同步」；§1.2 边界恢复增量同步拉取；§1.3 恢复 D3 游标决策（补 Mongo 实现：Date 毫秒+业务 id 复合推进，消除 v1 MySQL 秒精度截断重投）；§4.5 gw_task_advanced 订阅方恢复同步游标分配；§5.2 补同步变更扫描（SyncChangeScanner 八聚合）。collection 设计不变 |
| v1.2 | 2026-10-08 | interface_added | 恢复 POST /auth/sync/pull（v1 原文：AO lastCursor / VO changes[]·newCursor·hasMore / 单页 ≤200）与登录 VO 的 syncCursor 字段；端点口径 65→66，v1 契约 100% 冻结 |

## 更新记录（契约增量备案）

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-10-20 | sync/pull 增量可选字段（F07，功能核查修复） | AO 新增 `lastPosition?: string`、VO 新增 `newPosition?: string`（`AGGREGATE:id` 复合游标位置）——与 lastCursor 组成可续传全序，修复同毫秒 >200 条漏同步；旧客户端不传时行为不变（纯毫秒游标兼容）。 |
