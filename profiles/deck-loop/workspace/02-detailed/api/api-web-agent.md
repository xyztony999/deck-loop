# API 设计 — Web 管理站 · agent 直写 · 网关移除（deck-loop-full 增量）

| 属性 | 值 |
|------|-----|
| 模块编码 | 跨域增量：C-04（ver agent 直写）/ C-01（deck outline-save 迁移）/ P-02（auth token）；退役 C-02/C-03/D-01/P-01 |
| 接口域 | ver / deck / auth |
| 功能类型 | 业务流程类（版本归档编排）+ 平台支撑（API token 薄建模） |
| 服务形态 | Node.js + TypeScript + NestJS + PostgreSQL（deck-loop-core 单服务，06-node-api-conventions v1.3） |
| 版本 | v1.0 |
| 日期 | 2026-11-25 |
| 输入 | prd-web-management.md v1.0 / domain-model.md v1.3 / ADR-018 v1.0 |
| 增量 id | web-mgmt-20261125 |

> **契约地位**：本文档为 ADR-018 破坏性变更的**唯一增量契约事实源**——新增端点（§4）、
> 移除清单（§5.4）、MCP 远程协议（§5.5）以本文档为准；既有 api-deck/version/delivery/
> assets/platform 文档中**未被本文档修订的端点契约继续冻结有效**。66 端点全量冻结
> 声明自 ADR-018 起解除（06 规约 §1 v1.3 修订）。

## 1. 模块设计概述

### 1.1 业务背景及目标

网站四功能组（素材/Deck/版本树/预览放映+导出下载）直读直写云端 PG；AI 产出唯一
路径 = coding agent 经 MCP 远程模式直写（个人 API token 鉴权）；AI 网关彻底移除。
本增量交付：① agent 直写端点；② 个人 token 签发/吊销/列表；③ 大纲保存迁 deck 域；
④ 23 端点移除清单；⑤ MCP 28 tools 远程协议。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| agent-create 直写归档、token 生命周期管理、outline-save 迁移、移除清单与 MCP 映射 | 网站内容编辑/导出发起（ADR-008/015）、渲染（服务端零渲染）、SSE/任务调度（随网关移除）、token scope/RBAC、deck/asset 本地→云推送（ADR-018 §4.1 限制） |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | agent-create 复用 VersionArchiveService.createVersionFromTask 唯一写入口（单事务），禁绕过 | INV-11/18 与 ADR-017 本地路径同一服务同一事务；线上/本地零分叉 |
| D2 | taskId 合成 `agent-<snowflake>`，不建 dl_generation_task 行 | 任务表停写（历史审计）；树 taskStatusOfSource 回落 null（ADR-017 同口径） |
| D3 | 个人 token 独立守卫（ApiTokenGuard）+ 全局 AuthGuard 双凭证回落；agent-create 仅 token | 会话体系零改动（网站）；MCP 无交互登录能力；独立表/哈希/吊销逻辑 |
| D4 | token 明文仅签发回执一次，库内 SHA-256 哈希（uk_token_hash） | INV-26 精神延续（密钥不可回显）；O(1) 查找+恒时比较 |
| D5 | outline-save 迁 deck 域（/deck/deck/outline-save），AO/VO 不变，错误码改 BIZ_DECK_OUTLINE_INVALID | 大纲是 Deck.draft_outline 值对象（api-deck D4），generation 域退役后归属回正 |
| D6 | 定向越界为 BIZ 错误（BIZ_VERSION_TARGET_INVARIANCE）而非集成缺陷 | agent 产物是不可信输入（区别于网关时代回调缺陷语义） |
| D7 | MCP 远程错误透传 Result{status,code,msg}，不翻译不吞码 | agent 侧可据 BIZ_* 码决策（重试/换路径/上报用户） |
| D8 | 载荷红线 content≤2MB/pages≤200/instruction≤2000 | 1.6G 内存红线（ADR-016）；jsonb 单列体积约束 |
| D9 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 个人 API token ApiToken | 聚合根（通用薄，新增） | dl_api_token（§4.1） |
| 内容版本 DeckVersion | 既有聚合根（增量写入口） | agent-create（§4.2）；content JSON 契约沿用 api-version §4.1 |
| 创作物 Deck | 既有聚合根（增量接口） | outline-save 迁入（§4.3）；状态机/指针不变 |
| 素材 Asset | 关联领域对象 | 引用计数 INV-18（归档编排消费） |

### 1.5 上下文映射

| 对方 | 关系 | 模式 |
|------|------|------|
| MCP 远程（外部 coding agent） | 被调用 | OHS + PL（HTTP + Result 信封 + BIZ_* 透传 + content JSON 契约） |
| 网站（web/） | 被调用 | 会话体系（现状）；token 管理入口 |
| deck/asset 域 | 域内直调 | movePointer/onFirstVersionCreated/adjustRefCounts（进程内） |
| MCP 本地离线 | 同服务复用 | VersionArchiveService 直写 SQLite（ADR-017）；sync/pull 对账 |

## 2. 跨聚合根设计

### 2.1 聚合根关系图

```
ApiToken(Account 1:N) ──守卫──▶ agent-create 请求上下文（userId 注入）
Deck(聚合根) ──1:N──▶ DeckVersion(聚合根)
     │ currentVersionId/activeBranch ◀── movePointer（归档同事务）
     └── draftOutline ◀── outline-save（DRAFT 守卫）
DeckVersion.content.assetId ──▶ Asset.refCount（INV-18，归档同事务 +1）
```

### 2.2 跨聚合根不变量

| # | 不变量 | 守卫位置 |
|---|--------|---------|
| INV-1 | currentVersionId 指向本 Deck 版本 | movePointer（归档事务内） |
| INV-3 | FINALIZED/ARCHIVED 禁内容写入 | agent-create 前置（BIZ_DECK_STATUS_FORBIDDEN） |
| INV-4 | 首版成功 DRAFT→ITERATING（有且仅一次） | onFirstVersionCreated（幂等） |
| INV-9 | scope.pageId/blockId 必须存在于基线 content | agent-create 定向分支前置 |
| INV-11 | 版本插入后不可变（仓储 insert-only） | VersionArchiveService（唯一写入口） |
| INV-18 | 版本引用素材 refCount+1（同事务） | adjustRefCounts |
| INV-27（新） | token_hash 全局唯一 | uk_api_token_hash |
| INV-28（新） | token 明文不落库、不进日志、不回显（签发回执除外） | ApiTokenService 静态红线 |

### 2.3 跨聚合根编排

| 编排 | 步骤 | 一致性 |
|------|------|--------|
| agent 直写归档 | 属主/状态守卫 → sourceType 判定 →（定向：基线固化+INV-9+不变性）→ **单事务**：seq FOR UPDATE 分配 → insertOnly DeckVersion → movePointer → adjustRefCounts →（首版）onFirstVersionCreated → 提交后发 ver_version_created | PG 单事务（ADR-016 口径，与 ADR-017 本地同服务） |
| token 签发 | 会话属主 → 随机生成 → SHA-256 → insert（uk 兜底 INV-27）→ 回执明文一次 | 单表写 |
| token 吊销 | 会话属主 → 条件更新 revoked_at（幂等） | 单表写；即时生效（每次校验查库） |

## 3. 应用/基础设施层设计

### 3.1 接口规范

- 路径 `/{domain}/{resource}/{action}`；业务 POST；Result\<T\>/PageResult\<T\> 包装；pageNum 默认 1/pageSize 默认 20。
- **双凭证**（06 规约 §8 v1.3）：X-Auth-Token（会话，现状）优先；无会话头时 X-Api-Token（个人 token）回落，经独立 ApiTokenService 校验。属主隔离（ADR-005）口径不变。
- agent-create **仅 X-Api-Token**（@Public() 旁路全局会话守卫 + @UseGuards(ApiTokenGuard)）。

### 3.2 依赖与约束

- 进程内直调：DeckDomainService（getDeck/movePointer/onFirstVersionCreated/updateDraftOutline）、VersionArchiveService（createVersionFromTask/getVersionContent）、AssetDomainService（adjustRefCounts）。
- 约束：content JSON ≤2MB（env AGENT_CONTENT_MAX_MB 缺省 2，NestJS body limit 配套）、pages 1~200、instruction ≤2000；id 入参格式校验（≤32、[A-Za-z0-9]，agent- 前缀 taskId 含连字符为服务端合成不受入参校验约束）。
- 查询安全 NR 规约沿用（06 §4 + api-persistence-migration NR-02/03/05/08）：白名单映射、userId 服务端注入、静态 SQL 绑定值。

### 3.3 权限模型

| 端点 | 守卫 | 属主 |
|------|------|------|
| /auth/token/issue·revoke·list | 会话（AuthGuard） | token.user_id = 会话 userId |
| /ver/version/agent-create | **ApiTokenGuard 独立**（仅 X-Api-Token） | deck.user_id = token.user_id 级联校验 |
| /deck/deck/outline-save | 会话或 token（双凭证） | deck 属主 |
| 其余既有端点 | 双凭证（会话优先） | 现状不变 |

### 3.4 公共规范

- 新错误码：`BIZ_AUTH_TOKEN_INVALID`（token 缺头/格式错/哈希不匹配/过期/吊销统一码，防枚举）、`BIZ_DECK_OUTLINE_INVALID`（outline-save 节点校验失败，替代原 BIZ_TASK_SCOPE_INVALID 语义）、`BIZ_VERSION_TARGET_INVARIANCE`（定向产物越界/scope 不存在）。
- 复用错误码：BIZ_DECK_NOT_FOUND / BIZ_DECK_STATUS_FORBIDDEN / BIZ_VERSION_BRANCH_EXISTS / BIZ_AUTH_SESSION_EXPIRED。
- 退役错误码：BIZ_TASK_* / BIZ_GW_* / BIZ_CHANNEL_* / BIZ_ADJUST_*（随模块，§5.4）。
- 枚举：VersionSourceType / DeckStatus / AssetType / AssetStatus / TemplateScene / ExportFormat / ExportStatus（04 池，值域不变）；token status 为派生展示值（ACTIVE/EXPIRED/REVOKED，**不入池**，过程数据 P2）。

## 4. 聚合根详细设计

### 4.1 个人 API token ApiToken（新增聚合根，账号域 P-02）

#### 4.1.1 领域模型

| 表 | 类型 | 说明 |
|----|------|------|
| dl_api_token | 主表（第 10 张物理表：11−dl_channel−dl_channel_preference+本表，ADR-018；W1 计数修正） | 凭证 |

**字段清单（PG，ADR-016 口径）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token_id | varchar(32) | PK | 雪花 |
| user_id | varchar(32) | ✅ | 属主（ADR-005） |
| token_name | varchar(50) | ✅ | 用途名 |
| token_prefix | varchar(16) | ✅ | 明文前 12 字符（`dlpat_`+6），列表回显 |
| token_hash | varchar(64) | ✅ | SHA-256(全 token) hex，唯一索引 |
| expires_at | timestamptz | — | null=永久 |
| last_used_at | timestamptz | — | 校验时节流更新（≤1 次/分钟/token） |
| revoked_at | timestamptz | — | 吊销时刻（null=未吊销） |
| data_version / delete_sign | integer | ✅ | 统一模板（无软删需求，吊销用 revoked_at） |
| 审计六件套 | — | ✅ | 同规约 |

不变量：INV-27 token_hash 唯一；INV-28 明文不落库不进日志。
领域服务：ApiTokenService（issue/revoke/listPage/verify）；**独立于 SessionTokenService**。

#### 4.1.2 状态模型

无状态列。派生 status：revoked_at≠null→REVOKED；expires_at≠null 且已到期→EXPIRED；否则 ACTIVE。吊销即时生效（verify 每次查库，无缓存撤销表——区别于会话内存撤销表，重启不丢失）。

#### 4.1.3 接口设计

**接口清单**：

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 签发 token | POST /auth/token/issue | 会话守卫；明文仅此次 |
| 吊销 token | POST /auth/token/revoke | 会话守卫；幂等 |
| token 列表 | POST /auth/token/list | 会话守卫；分页 |

**POST /auth/token/issue** — AO：tokenName✅(≤50)、expiresDays(1~365，缺省 90)、permanent(bool，缺省 false；true 时忽略 expiresDays，expires_at=null)。
规则：会话属主；生成 `dlpat_`+32B 随机 base64url；SHA-256 落库（INV-27/28）。
VO：tokenId、tokenName、**token（明文，仅此一次）**、tokenPrefix、expiresAt(可空)、createdTime。

**POST /auth/token/revoke** — AO：tokenId✅。规则：属主校验；置 revoked_at=now（已吊销幂等成功）；不物理删除。VO：void。

**POST /auth/token/list** — AO：pageNum/pageSize。
行 VO：tokenId、tokenName、tokenPrefix、createdTime、expiresAt、lastUsedAt、status(派生)、operList[]（revoke：status≠REVOKED）。
规则：强制 user_id；按 created_time DESC；**永不回显 token/token_hash**。

#### 4.1.4 领域事件与集成

无领域事件（token 不参与同步扫描——非八聚合；吊销即时查库生效）。
仓储契约：ApiTokenRepository（insert/findByHash（uk）/conditionalRevoke/pageByUser/touchLastUsed 节流）。
守卫集成：ApiTokenGuard 读 X-Api-Token → ApiTokenService.verify → request.user={userId, accountId, via:'api-token'}；失败抛 BIZ_AUTH_TOKEN_INVALID。全局 AuthGuard 双凭证回落委托同一 verify（06 §8）。

### 4.2 内容版本 DeckVersion — agent 直写增量（既有聚合根）

> 聚合根模型/字段/索引/content JSON 契约**沿用 api-version §4.1/§5.3 零变更**；
> 本节仅定义增量写入口。

#### 4.2.1 接口设计

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| agent 直写版本 | POST /ver/version/agent-create | **仅 X-Api-Token**；唯一内容写入口 |

**POST /ver/version/agent-create** — AO：

| 字段 | 必填 | 约束 |
|------|------|------|
| deckId | ✅ | 格式校验 + 属主（token.userId） |
| content | ✅ | {pages:[{pageId,layout?,title?,note?,blocks:[{blockId,blockType:TEXT\|IMAGE\|PLACEHOLDER,text?,assetId?,style?}],style?}]}；pages 1~200；JSON ≤2MB |
| instruction | ✅ | ≤2000 字（落 instruction_snapshot.instruction） |
| parentVersionId | — | 缺省=deck.current_version_id；非空须同 deck 存在（INV-13） |
| branchName | — | ≤50；缺省=活动分支；≠活动分支=分叉留档（同 deck 唯一 INV-12） |
| scope | — | {pageId✅, blockId?}；提供即 TARGETED_ADJUST |

规则（顺序）：
1. token 守卫（ApiTokenGuard）→ userId 注入。
2. deck 存在且属主（BIZ_DECK_NOT_FOUND）；状态 DRAFT/ITERATING（BIZ_DECK_STATUS_FORBIDDEN，INV-3）。
3. sourceType 自动判定：scope≠null→TARGETED_ADJUST；基线≠null→FULL_ADJUST；否则 FULL_GENERATE。
4. 定向分支：基线必存（无基线拒绝）；基线 content 固化进 instruction_snapshot.baseContent + targetPath=scope；scope 存在性校验（INV-9）+ assertTargetedInvariance（非目标页/块 canonical 不变）→ 越界 BIZ_VERSION_TARGET_INVARIANCE（不产版本）。
5. taskId=`agent-<snowflake>`（不建任务行）；组装 VersionArchiveCommand → **VersionArchiveService.createVersionFromTask 单事务**（seq FOR UPDATE→insertOnly→movePointer→adjustRefCounts）。
6. 首版（归档前 deck=DRAFT）→ onFirstVersionCreated（DRAFT→ITERATING，幂等）。
7. 提交后发 ver_version_created（NR-07）。

VO：versionId、versionSeq、sourceType、taskId、branchName。

#### 4.2.2 领域事件与集成

沿用 api-version §4.5：ver_version_created（versionId/deckId/versionSeq/branchName），订阅方=多端同步（本地离线模式）；引用计数回调 INV-18 在归档事务内（adjustRefCounts）。仓储 insert-only 红线不变（INV-11）。

### 4.3 创作物 Deck — outline-save 迁移（既有聚合根）

> 聚合根模型沿用 api-deck 零变更；本节仅定义迁入接口。

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 保存大纲编辑 | POST /deck/deck/outline-save | 自 /gen/outline/save 迁入；AO/VO 契约不变 |

**POST /deck/deck/outline-save** — AO：deckId✅、outline✅（节点树 [{nodeId,title,points[],note,pageHint}]）。
规则：属主；**仅 DRAFT 态**（首版后只读）；节点 1~50、title≤50 → 失败 BIZ_DECK_OUTLINE_INVALID（替代原 BIZ_TASK_SCOPE_INVALID）；经 DeckDomainService.updateDraftOutline（乐观锁）。VO：void。
双凭证（会话或 token）；MCP outline_save 工具远程映射本端点（§5.5）。

## 5. 模块清单汇总

### 5.1 对外服务清单

| 服务 | 路径 | 消费方 |
|------|------|--------|
| agent 直写 | POST /ver/version/agent-create | MCP 远程 version_create / 本地模式版本对账 |
| token 管理 | POST /auth/token/issue·revoke·list | 网站设置页 |
| 大纲保存 | POST /deck/deck/outline-save | 网站 Deck 详情（DRAFT）/ MCP outline_save |
| ApiTokenService.verify（进程内 OHS） | AuthGuard 回落 / ApiTokenGuard | 全端点双凭证 |

### 5.2 数据访问清单（PostgreSQL）

| 数据访问 | 表 | 操作 |
|----------|-----|------|
| token 签发 | dl_api_token | insert（uk_token_hash 兜底） |
| token 校验 | dl_api_token | findOne（token_hash，恒时比较；expires_at/revoked_at 判定） |
| token 吊销/列表/节流 | dl_api_token | conditionalUpdate（revoked_at）/ pageByUser / touchLastUsed |
| agent 归档 | dl_deck_version + dl_deck + dl_asset | 单事务（FOR UPDATE seq + insert + 指针 + refCount） |
| 大纲保存 | dl_deck | updateDraftOutline（乐观锁） |
| 历史审计读 | dl_generation_task / dl_usage_record | 只读（deck detail withStats/withLatestTask） |

### 5.3 表设计（dl_api_token DDL + 移除迁移）

```sql
CREATE TABLE dl_api_token (
  token_id      varchar(32)  PRIMARY KEY,
  user_id       varchar(32)  NOT NULL,
  token_name    varchar(50)  NOT NULL,
  token_prefix  varchar(16)  NOT NULL,
  token_hash    varchar(64)  NOT NULL,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  data_version  integer      NOT NULL DEFAULT 0,
  delete_sign   integer      NOT NULL DEFAULT 0,
  created_by    varchar(32), created_name varchar(64), created_time timestamptz,
  updated_by    varchar(32), updated_name varchar(64), updated_time timestamptz
);
CREATE UNIQUE INDEX uk_api_token_hash ON dl_api_token(token_hash);
CREATE INDEX idx_api_token_user ON dl_api_token(user_id, delete_sign);
```

**移除迁移（脚本，synchronize=false 红线不变）**：`DROP TABLE dl_channel_preference; DROP TABLE dl_channel;`（配置数据无审计价值；task/usage 行内渠道编码为快照字符串，无解引用依赖）。dl_generation_task / dl_usage_record **保留**（历史审计只读）。索引声明式登记沿 06 §3.5/§7。

### 5.4 端点移除清单（破坏性变更，ADR-018）

**基线 75**（66 冻结 + ADR-015 upload/fail 2 + 渠道管理端 6 + files GET 1）→ **移除 23 + 迁移 1 + 新增 4 = 56**。

**移除（23，逐条）**：

| # | 方法/路径 | 原归属 | 移除理由 |
|---|----------|--------|---------|
| 1 | POST /gen/outline/generate | generation | 大纲生成=agent 侧 |
| 2 | POST /gen/full/generate | generation | 整稿生成=agent 直写 |
| 3 | POST /gen/task/list | generation | 任务表停写 |
| 4 | POST /gen/task/detail | generation | 同上 |
| 5 | POST /gen/task/progress | generation | 同上 |
| 6 | POST /gen/task/cancel | generation | 同上 |
| 7 | POST /gen/task/retry | generation | 同上 |
| 8 | POST /gen/dict/batch | generation | 模块退役（TaskType/TaskStatus 枚举留池供历史） |
| 9 | POST /adjust/whole/submit | adjustment | 整稿调整=agent 直写 |
| 10 | POST /adjust/targeted/submit | adjustment | 定向调整=agent 直写（不变性迁守卫） |
| 11 | POST /adjust/scope/validate | adjustment | scope 校验内联 agent-create |
| 12 | POST /adjust/dict/batch | adjustment | 模块退役（TargetKind 枚举留池） |
| 13 | POST /channel/preference/detail | channel | 渠道域退役 |
| 14 | POST /channel/preference/save | channel | 同上 |
| 15 | POST /channel/usage/summary | channel | 用量端点退役（表留审计） |
| 16 | POST /channel/select/model-options | channel | 渠道选择器退役 |
| 17 | POST /channel/admin/list | channel（2026-10-23 管理端） | 渠道配置退役 |
| 18 | POST /channel/admin/detail | channel | 同上 |
| 19 | POST /channel/admin/save | channel | 同上 |
| 20 | POST /channel/admin/set-enabled | channel | 同上 |
| 21 | POST /channel/admin/test | channel | 同上 |
| 22 | POST /channel/admin/fetch-models | channel | 同上 |
| 23 | GET /gw/task/stream | platform/gateway | SSE 进度通道随网关移除 |

**迁移（1）**：POST /gen/outline/save → **POST /deck/deck/outline-save**（AO/VO 不变；错误码 BIZ_TASK_SCOPE_INVALID→BIZ_DECK_OUTLINE_INVALID；§4.3）。

**新增（4）**：POST /ver/version/agent-create（§4.2）、POST /auth/token/issue·revoke·list（§4.1）。

**移除后分域对账（56 = POST 54 + GET 2）**：

| 域 | 端点数 | 明细 |
|----|--------|------|
| deck | 11 | 原 10 + outline-save |
| version | 7 | 原 6 + agent-create |
| deliver | 9 | submit/list/cancel/upload/fail/download-ticket/GET download/present/data/dict（不变） |
| asset | 21 | 原 20 + GET /files/:userId/:name（HMAC，不变） |
| auth（platform） | 8 | register/login/logout/profile/sync-pull + token issue/revoke/list |
| generation/adjustment/channel/gw | 0 | 模块退役 |
| **合计** | **56** | 冻结有效端点 = 56 − 4 新增 = 52（原 75 − 23 移除） |

**配套退役**：事件 gen_task_created/gen_task_finished/gw_task_advanced/gw_usage_recorded/channel_preference_changed；错误码 BIZ_TASK_*/BIZ_GW_*/BIZ_CHANNEL_*/BIZ_ADJUST_*；INV-8/10/22/23/25/26；同步扫描 PREFERENCE 聚合（TASK 转历史只读）。**保留**：会话体系、sync/pull（F07 复合游标）、download HMAC、files 签名、NR 规约、全部核心域不变量。

### 5.5 MCP 远程协议（28 tools → HTTP 映射）

**模式切换**（ADR-018 §4.2）：`DECK_LOOP_MODE=local|remote`（缺省 local）；remote 必填 `DECK_LOOP_API_URL`（如 https://host/api）+ `DECK_LOOP_API_TOKEN`。ToolContext 缝：local=LocalCore 进程内直调（现状）；remote=RemoteClient HTTP。**28 tools 名称/入参 schema/语义/回执两模式一致**。

**鉴权头**：全部远程请求携 `X-Api-Token: <个人 token>`；agent-create 仅认此头；其余端点服务端双凭证回落（§3.1）。Content-Type: application/json（upload 为 multipart/form-data）。

**错误透传**：HTTP 200 但 Result.status≠success → MCP 错误回执 `{code, msg}` 原样（D7）；BIZ_AUTH_TOKEN_INVALID/BIZ_AUTH_SESSION_EXPIRED → 提示「token 无效/过期，请在网站设置页重新签发」；网络层失败 → `DECK_LOOP_REMOTE_UNREACHABLE`（含 URL/状态码，**不含 token**）。

**映射表（28）**：

| # | tool | 远程 HTTP 映射 | 备注 |
|---|------|----------------|------|
| 1 | deck_create | POST /deck/deck/save | deckType=DECK 固定 |
| 2 | deck_list | POST /deck/deck/list | |
| 3 | deck_get | POST /deck/deck/detail | withStats=true，withLatestTask=false |
| 4 | deck_update | POST /deck/deck/save | 携 deckId |
| 5 | outline_save | POST /deck/deck/outline-save | 迁移端点（§4.3）；本地预校验保留 |
| 6 | deck_finalize | POST /deck/deck/finalize | confirm=true |
| 7 | deck_unfinalize | POST /deck/deck/unfinalize | confirm=true |
| 8 | deck_archive | POST /deck/deck/archive | |
| 9 | deck_restore | POST /deck/deck/restore | |
| 10 | deck_delete | POST /deck/deck/delete | |
| 11 | version_create | **POST /ver/version/agent-create** | 唯一内容写入口（§4.2） |
| 12 | version_tree | POST /ver/version/tree | |
| 13 | version_get | POST /ver/version/detail | |
| 14 | version_compare | POST /ver/version/compare | |
| 15 | version_rollback | POST /ver/version/rollback | confirm=true |
| 16 | version_fork | POST /ver/version/fork | |
| 17 | asset_add | POST /asset/asset/upload | multipart：本地文件→file 字段 + assetName/category/assetType；hash 查重/复活服务端守卫 |
| 18 | asset_list | POST /asset/asset/list | |
| 19 | brandkit_save | POST /asset/brandkit/save | |
| 20 | brandkit_list | POST /asset/brandkit/list | |
| 21 | brandkit_set_default | POST /asset/brandkit/set-default | |
| 22 | brandkit_delete | POST /asset/brandkit/delete | |
| 23 | prompt_save | POST /asset/prompt/save | |
| 24 | prompt_list | POST /asset/prompt/list | |
| 25 | prompt_delete | POST /asset/prompt/delete | |
| 26 | export_deck | 编排（见下） | 渲染始终本地 |
| 27 | export_list | POST /deliver/export/list | |
| 28 | preview_deck | 编排（见下） | HTML 始终本地生成 |

**export_deck 远程编排**（状态机沿用 ADR-015/017）：
1. POST /deliver/export/submit {deckId, exportFormat, confirm} → exportId（QUEUED）；PPTX 未 confirm 提示态回执直接返回（不渲染）。
2. POST /deck/deck/detail → finalVersionId；POST /ver/version/detail → content；POST /asset/asset/file-url（assetIds）→ 签名 URL → 下载图片转 data URI。
3. **本地 headless 渲染**（playwright-core 系统 Edge PDF/PNG、pptxgenjs PPTX——依赖不上服务端）。
4. 成功：POST /deliver/export/upload（multipart：exportId + file，魔数/50MB 服务端校验）→ SUCCEEDED 落账；失败：POST /deliver/export/fail {exportId, errorMsg} → FAILED。
5. 回执：exportId/exportFormat/filePath（本地产物）/fileSize（与本地模式回执结构一致）。

**preview_deck 远程编排**：POST /deck/deck/detail（取当前指针）或指定 versionId → POST /ver/version/detail → file-url 签名取图 → 本地 previewDocument HTML（键盘翻页）→ 回执 filePath/pageCount。

**本地模式不变**：ADR-017 原样（SQLite/零鉴权/进程内直调）；version_create 经同一 VersionArchiveService；离线版本对账在线时经 agent-create（deck 须已存在云端）+ sync/pull 拉取云端变更。

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-11-25 | initial / interface_added×4 / interface_removed×23 / interface_changed×1（迁移） / table_added（dl_api_token）/ table_removed（dl_channel、dl_channel_preference）/ rule_added（INV-27/28、载荷红线） | ADR-018 增量契约（web-mgmt-20261125）：agent-create 唯一内容写入口（单事务+定向不变性+首版流转）；个人 token 签发/吊销/列表+独立守卫+双凭证回落；outline-save 迁 deck 域；23 端点移除清单+56 对账；MCP 28 tools 远程映射与错误透传。既有未修订端点契约继续冻结 |