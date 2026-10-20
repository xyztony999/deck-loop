# API 设计 — AI 渠道与偏好（D-01）

| 属性 | 值 |
|------|-----|
| 模块编码 | D-01 AI 渠道与偏好 |
| 接口域 | channel |
| 功能类型 | 主数据类（用户级配置，薄建模） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | prd-channel.md v1.1 / domain-model.md v1.2 |

## 1. 模块设计概述

### 1.1 业务背景及目标

用户级生成资源配置：默认渠道/模型 + 分任务类型档位；用量统计透明。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 偏好读取/保存、渠道模型选择器、用量汇总查询 | 渠道接入运营管理（P-01）、密钥管理、计费充值 |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 偏好与用户 1:1（dl_channel_preference），无列表页 | 配置型主数据 |
| D2 | 用量数据源于网关域 dl_usage_record，本模块只做聚合查询（跨模块读，域内直调） | 计量归属网关（ADR 平台域职责） |
| D3 | 渠道下线容错：存量偏好保留+标记不可用，路由自动降级 | prd-channel 规则 3 |
| D4 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 渠道偏好 ChannelPreference | 聚合根（薄） | dl_channel_preference |
| ChannelModel | 关联领域对象（AI 网关域） | 只读清单 |
| UsageRecord | 网关域实体（聚合数据源） | dl_usage_record（api-platform 建模） |

### 1.5 上下文映射

| 对方 | 关系 | 模式 |
|------|------|------|
| AI 网关域 | 消费渠道清单/用量明细 | 遵奉者 |
| 账号域 | user 上下文 | 遵奉者 |

## 2. 跨聚合根设计

不适用（单聚合根薄模块）。

## 3. 应用/基础设施层设计

### 3.1 接口规范

POST 业务接口；偏好接口无分页；统计查询分页/时间范围。Select 端点入选择池。

### 3.2 依赖与约束

依赖网关域渠道清单与用量记录读取（域内服务直调，单服务进程内）。

### 3.3 权限模型

会话+属主（偏好天然单行属主）。

### 3.4 公共规范

错误码：BIZ_CHANNEL_{ERROR}（BIZ_CHANNEL_UNAVAILABLE）；无独立业务枚举（档位键=TaskType）。

## 4. 聚合根详细设计 — 渠道偏好 ChannelPreference

### 4.1 领域模型

| 表 | 类型 | 说明 |
|----|------|------|
| dl_channel_preference | 主表（1:1 用户） | 偏好 |

**主表字段（dl_channel_preference）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| preference_id | VARCHAR(32) | PK | 雪花 |
| user_id | VARCHAR(32) | ✅ | 唯一 |
| default_channel_code | VARCHAR(64) | ✅* | 默认渠道（有可用渠道时必填） |
| default_model_code | VARCHAR(64) | ✅* | 默认模型 |
| preference_map | JSON | — | {OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST: {channelCode,modelCode}}，缺省回落默认 |
| data_version / 审计 | — | ✅ | 同规约（无 delete_sign 需求，保留统一模板） |

不变量：INV-22 所填渠道/模型必须在网关清单中为 enabled；INV-23 user_id 唯一（upsert）。

### 4.2 状态模型

无状态机（配置数据）。

### 4.3 子流程设计

无。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 偏好详情 | POST /channel/preference/detail | 含渠道可用性标注 |
| 偏好保存 | POST /channel/preference/save | upsert |
| 用量汇总 | POST /channel/usage/summary | 维度聚合 |
| 渠道选择器 | POST /channel/select/model-options | 选择池 |

#### 接口详情（关键接口）

**POST /channel/preference/detail** — VO：preferenceId、defaultChannel{code,name}、defaultModel{code,name}、preferenceMap（逐档位含 available(bool) 标注）、fallbackChannel（平台兜底，只读展示）。

**POST /channel/preference/save** — AO：defaultChannelCode✅、defaultModelCode✅、preferenceMap（逐项校验 INV-22；空值=清除档位回落默认）。VO：void。

**POST /channel/usage/summary** — AO：dimension(CHANNEL/DECK/TASK_TYPE)、timeRange✅(≤12 个月)、pageNum/pageSize（DECK 维度分页）。
VO：rows[{dimKey,dimName,taskCount,promptTokens,completionTokens,lastUsedAt}]、total。

**POST /channel/select/model-options** — AO：capabilityTag(eq 可选)。VO：SelectOption+扩展（选择池 channel.select.modelOptions）。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 偏好变更 | channel_preference_changed | userId | 多端同步 |

仓储契约：PreferenceRepository（upsert by user_id 唯一索引，INV-23）；用量聚合走 dl_usage_record 服务端静态构造的 aggregate 管道（06 §4）。

## 5. 模块清单汇总

### 5.1 对外服务清单

| 服务 | 路径 | 消费方 |
|------|------|--------|
| 偏好读取（路由输入） | 进程内 ChannelPreferenceService#resolve(taskType,userId) | 生成/调整任务路由（域内） |

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 偏好 upsert | dl_channel_preference | updateOne（upsert，filter=user_id 唯一索引） |
| 用量聚合 | dl_usage_record | aggregate（服务端静态构造管道，维度值白名单校验） |

### 5.3 MongoDB collection 设计（dl_channel_preference）

| 项目 | 值 |
|------|-----|
| collection | dl_channel_preference（聚合根=document；1:1 用户，每用户至多一篇文档） |
| 主键 | _id=ObjectId（仅存储，不进 VO）；preference_id=业务主键（string，唯一索引） |
| 嵌入 | preference_map=object（{taskType:{channelCode,modelCode}}，无独立生命周期，整体嵌入；缺省回落默认档） |
| 引用 | default_channel_code/default_model_code 为渠道配置代码（引用服务端渠道注册配置，非业务 id 外键；可用性校验 INV-22 应用层守卫） |
| 更新语义 | upsert（uk_user 唯一，INV-23） |

**字段清单（=v1 列平移，类型改 Mongo 文档类型）**

| 字段 | Mongo 类型 | 必填 | 说明 |
|------|-----------|------|------|
| preference_id | string | ✅ | 业务主键（雪花串，唯一索引） |
| user_id | string | ✅ | 唯一 |
| default_channel_code | string | ✅* | 默认渠道（有可用渠道时必填） |
| default_model_code | string | ✅* | 默认模型 |
| preference_map | object | — | {OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST: {channelCode,modelCode}}，整体嵌入 |
| data_version / delete_sign | number | ✅ | 同规约（配置级无 delete_sign 需求，保留统一模板） |
| created_by/name、updated_by/name | string | ✅ | 审计 |
| created_time / updated_time | date | ✅ | 审计 |

**索引（schema 声明式创建，06 §3.5）**

| 索引 | 字段 | 约束 |
|------|------|------|
| uk_preference_id | preference_id | unique |
| uk_user | user_id | unique |

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成 |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→dl_channel_preference collection 设计（preference_map 嵌入/uk_user 唯一索引）；§4.5 MQ→进程内事件；用量聚合改 aggregate（服务端构造）。接口契约冻结不变 |
| v1.2 | 2026-10-08 | restored | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：§4.5 channel_preference_changed 订阅方恢复「多端同步」v1 原订阅方。契约与 collection 设计不变 |
