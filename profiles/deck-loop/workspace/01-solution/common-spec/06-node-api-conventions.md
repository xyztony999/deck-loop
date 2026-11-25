# Node/NestJS API 规约（deck-loop v3）

> 对 v1 java-microservice 栈规约（skills/backend-specs/20-api-conventions.md）的**替代规约**，依据 D0-v3 技术栈重定向（2026-10-08）。八份 api-*.md 与 api-index.md 自 v1.1 起按本规约执行。

| 属性 | 值 |
|------|-----|
| 版本 | v1.3 |
| 日期 | 2026-11-25 |
| 服务形态 | Node.js + TypeScript + NestJS 单服务 deck-loop-core + **PostgreSQL（TypeORM）**（宝塔「Node 项目」部署/PM2 守护+内存限额，PG 与 UniGate 共实例不同 database；Docker Compose 备选——ADR-011/016）。**§3 MongoDB 建模规约自 v1.2 起由 §7 PostgreSQL 增补节替代**；模块组织（§2）/查询安全（§4）/进程内事件（§5）/错误码枚举（§6）口径不变。**§1 契约冻结声明自 v1.3 起按 ADR-018 修订（首次破坏性变更）；新增 §8 双凭证鉴权与 agent 直写规约** |

## 1. 契约冻结声明

- **v1 API 契约全量冻结沿用（v1 全量 66 端点，无删除）**（**v1.3 起被 ADR-018 修订，见下**）：接口路径 / HTTP 方法 / AO / VO 字段 / `Result<T>`·`PageResult<T>` 包装 / 错误码（BIZ_*）/ 枚举池（03/04）**一字不改**（前端 v1 代码全量复用，含多端同步交互；仅代理目标随 v3 调整）。
- 2026-10-08 复议修订（D0-v3 §5，ADR-013 修订）：恢复 POST /auth/sync/pull 及其专用配套（登录 VO 的 syncCursor 字段、游标扫描机制、SyncChangeOp 枚举），端点口径 65→66；v1.0 曾按「砍同步」声明的唯一契约删除**作废**。
- 本规约与 v1 的差异仅限**实现层**：DDL→MongoDB collection、MQ→进程内事件、Java→Node/TS；传输契约永不冲突。各 api 文档 §4.4（接口清单/详情）为契约唯一事实源，本规约不重复也不修改它。
- **v1.3 修订（ADR-018，2026-11-25，web-mgmt-20261125）——66 端点全量冻结声明解除**：
  AI 网关彻底移除，generation/adjustment/channel/gateway 模块退役，**移除 23 端点、
  迁移 1（/gen/outline/save→/deck/deck/outline-save）、新增 4（agent-create + token
  issue/revoke/list），端点口径 75→56**（逐条清单与对账见 api-web-agent.md §5.4）。
  未被该增量修订的端点契约**继续冻结有效**；增量契约唯一事实源 = api-web-agent.md。
  受影响旧客户端（Tauri client）已移除，本地 MCP 不经 HTTP 零影响。

## 2. NestJS 模块组织

- 单服务 deck-loop-core；**八域 module 一一对应八份 api 文档**：DeckModule、GenerationModule、AdjustmentModule、VersionModule、DeliveryModule、AssetsModule、ChannelModule、PlatformModule（auth 账号 + gw 网关）。
- **进程内直调**：跨模块调用=注入对方 module 导出的 Service（无 Feign/自 HTTP 调用）；与 v1「单服务同库」语义一致。跨聚合编排点（任务成功回调、默认规范切换）沿用各文档 §2/§4.5 定义。
- **DTO=AO/VO 平移**：AO/VO 直接定义为 TS interface/class（class-validator 装饰器做入参校验，ValidationPipe 全局开启 whitelist+transform）；字段名/类型/可空性与 api 文档一致，禁止增删改。Controller 只做路由与校验，业务规则在 domain service，仓储经 MongooseModule 注入。

## 3. MongoDB 建模规约

### 3.1 collection 与字段平移

- collection 命名沿用 `dl_` 前缀，共 10 个（清单见 api-index）；操作日志类 `dl_deck_log`（平台框架）另计，不占十集合清单。
- **字段=原表列平移**：字段名/语义不变；类型映射 Mongo 文档类型 `string / number / boolean / date / object / array`（VARCHAR→string、INT/BIGINT→number、JSON→object/array、DATETIME→date）。
- 审计六件套（created_by/created_name/created_time/updated_by/updated_name/updated_time）、`dataVersion`（乐观锁：写 filter 携带当前 data_version + `$inc: {data_version: 1}`）、`deleteSign`（逻辑删除：查询默认 delete_sign=0）平移为文档字段，语义保留。
- 日志型 collection（dl_usage_record、dl_deck_log）只追加 insertOne，无版本/删除标记。

### 3.2 主键：ObjectId 与业务主键的关系

- `_id`=ObjectId（Mongo 自动生成），**仅作存储主键，不进任何 AO/VO/事件载荷**。
- 业务主键（deck_id / task_id / version_id / export_id / asset_id / brand_kit_id / template_id / preference_id / account_id / usage_id）为**独立保留的 string 字段**（沿用 v1 雪花串格式），建**唯一索引**；所有接口出入参、跨聚合引用、事件载荷一律使用业务 id。
- 规则编码列（deck_code/task_code/export_code）沿用 v1 生成规则，普通字段（与 v1 DDL 一致，不加唯一约束）。

### 3.3 嵌入 vs 引用判定

| 判定 | 规则 | 本域示例 |
|------|------|---------|
| 聚合根 | =独立 collection（一个聚合根一个 document） | dl_deck / dl_deck_version / dl_asset … |
| 版本内容快照 | **content 整体嵌入文档**（object，不可变，天然文档形态） | dl_deck_version.content / instruction_snapshot / dl_deck.draft_outline |
| 无独立生命周期的值对象 | 数组/对象内嵌 | brandkit.colors/fonts、preference_map、content.pages[].blocks[] |
| 跨聚合引用 | **只存业务 id**（string 字段），禁止嵌入对方文档 | current_version_id / final_version_id / default_brand_kit_id / logo_asset_id / base_version_id / result_version_id / task_id |
| 有独立生命周期或需独立查询的实体 | 独立 collection | Asset / BrandKit / GenerationTask / DeckVersion |

- Mongo 无外键：引用完整性由应用层不变量守卫（各文档 INV-* 表），跨聚合写入顺序沿用 v1 编排。

### 3.4 事务

- 跨聚合编排点（任务成功回调写版本+移指针、默认规范切换等 v1「同事务」语义）用 Mongo **多文档事务**（单实例副本集）实现；事务边界与 v1 编排表一致。

### 3.5 索引声明规约

- 每个业务主键字段建**唯一索引**（unique）。
- 其余索引=v1 DDL 的 KEY 平移为复合索引（字段顺序保留）；v1 唯一键（uk_*）平移为 unique 复合索引。
- 索引以 module 内 schema **声明式创建**（启动同步），禁止手工建索引；新增/变更索引必须先登记到对应 api 文档 §5.3。

### 3.6 同步游标实现规约（多端同步，复议恢复）

- **游标=Mongo Date（毫秒精度）**：sync_cursor 取 `updated_time`（或写入时分配的 Date）的毫秒值（long），**不做秒级截断**——消除 v1 MySQL DATETIME 秒精度导致的同秒变更截断重投（v1 已知问题），at-least-once → 可做到稳定 exactly-once 语义。
- **(cursor, id) 复合推进**：同一毫秒内多条变更以聚合内业务 id 破平——比较规则为 `(cursor, id)` 字典序；拉取查询用复合条件 `$gt: [cursor, id]` + `sort: {updated_time: 1, 业务id: 1}` + limit 分页，禁止跨请求 skip 跳页（统一以返回的 newCursor/末条 (cursor,id) 推进）。
- **扫描器**：SyncChangeScanner 按八聚合（DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT）逐一以 `updated_time+id` 升序扫描后归并，单页 ≤200 条变更，hasMore 由任一聚合未取尽判定（接口契约=api-platform §4.4 /auth/sync/pull，v1 原文冻结）。
- **索引配套**：参与扫描的业务 collection 建复合索引 `{updated_time: 1, 业务id: 1}`（§3.5 声明式登记）；DELETE 型变更以 delete_sign=1 的软删文档承载（可扫描），op 映射 SyncChangeOp（UPSERT/DELETE）。

## 4. 查询安全红线（强制）

- **所有查询构造仅允许白名单字段映射**：每个接口的 AO 字段→查询字段/运算符由服务端显式对照表写死（示例：deck/list 的 keyword→`deck_name` 正则、deckType→`deck_type` 等值、timeRange→`created_time` 区间），**禁止把客户端输入直接或拼接为查询运算符/投影/排序键**（防 NoSQL 注入：任何请求体键名不得成为 filter 的键）。
- 排序/分页：sort 键仅允许该接口白名单列（默认 created_time/updated_time DESC）；pageNum/pageSize 走 skip/limit，默认 20，上限沿用 v1。
- **id 入参一律格式校验后再查询**：业务 id 校验为非空 string（长度 ≤32、字符集 [A-Za-z0-9]）；涉及 `_id` 的场景必须先过 ObjectId.isValid。校验失败按参数错误返回，不进库。
- 枚举/字典入参：值必须在枚举池成员内，否则参数错误；禁止透传为白名单运算之外的任何形式。
- **禁止 `$where` / `$eval` / mapReduce 等动态脚本运算符**；聚合管道（如用量汇总）由服务端代码静态构造，客户端仅提供白名单维度值。
- 隔离条件（user_id）由服务端会话注入，所有查询/写入强制携带（ADR-005）。

## 5. 进程内事件规约

- 无 MQ broker：领域事件经 **NestJS EventEmitter（@nestjs/event-emitter）进程内发布订阅**（D0 决策 8；规模到多实例再引 Redis/MQ）。
- **事件名=businessType**：沿用 v1 命名（如 gen_task_created / gen_task_finished / ver_version_created / deliver_export_finished / deck_deck_status-changed / channel_preference_changed / asset_{resource}_changed / gw_task_advanced / gw_usage_recorded），载荷字段与触发时机不变。
- **事务后发布语义**：emit 必须在数据库写入/事务**成功提交之后**执行（回滚不发布），保证「事件⇒已落库」。
- 订阅方（原 MQ Consumer→事件订阅）：`@OnEvent(businessType)`；订阅方异常不影响发布方（解耦语义同 v1），失败记日志。
- SSE 下发（GET /gw/task/stream）由平台域订阅任务事件后推流，事件协议不变。

## 6. 错误码与枚举引用（不变）

- 错误码格式与清单不变：`BIZ_{DOMAIN}_{ERROR}`，以各 api 文档 §3.4 为准；全局异常过滤器映射为 `Result{status, code, msg, data}`。
- 枚举池引用不变：`03-common-enums.md` / `04-business-enum.md`（存储由 VARCHAR(32) 变为 string，**值域与成员不变**；SyncChangeOp 随多端同步复议恢复活跃）。

## 7. PostgreSQL 建模增补节（v1.2，ADR-016，替代 §3）

> 自 v1.2 起持久层为 PostgreSQL（TypeORM 0.3 + @nestjs/typeorm 10 + pg 8）。§3 的 Mongo 建模规约作废，以本节为准；**字段名/语义/审计六件套/乐观锁/软删/契约冻结口径全部保留**。详表见 `02-detailed/api/api-persistence-migration.md`。

- **表与字段平移**：表名沿 `dl_` 前缀，11 张物理表（13 schema 中 dl_generation_task/dl_usage_record/dl_channel 的「全量+只读投影」双模型消解为单 entity + 只读 SQL）。字段名=原列名 snake_case 逐字平移；类型 VARCHAR→varchar、INT→integer、BIGINT→bigint（file_size，仓储归一 number）、DATETIME→timestamptz（毫秒精度）、JSON/Mixed/Map/数组嵌入→jsonb、Boolean→boolean。
- **主键**：业务主键（deck_id/task_id/version_id/export_id/asset_id/brand_kit_id/template_id/preference_id/account_id/usage_id/channel_code，雪花串）= 表 `PRIMARY KEY`，**取代 ObjectId `_id`**（NR-08：无 `_id` 暴露面）。规则编码（deck_code/task_code/export_code）普通列；唯一/复合索引按各 api §5.3 平移。
- **嵌入 vs 引用**：原 Mixed 嵌入快照（content/instruction_snapshot/draft_outline/colors/fonts/preference_map/models）→ jsonb 列整体读写；跨聚合引用仍仅存业务 id（应用层 INV 守卫，无物理外键，沿 v1 口径）。
- **乐观锁/软删**：data_version 条件更新（filter 携带期望值 + `data_version=data_version+1`）；delete_sign 软删（查询默认 0）；日志型 dl_usage_record 只追加。
- **事务**：`DataSource.transaction(async manager=>…)`；仓储尾参 `session?: EntityManager` 加入外层事务。版本留档恢复 v1 **单事务**（seq 分配 FOR UPDATE + insert + movePointer + adjustRefCounts）；**移除 rs0/keyFile 依赖**（PG 单机即 ACID）。
- **聚合**：Mongo aggregate → SQL（JOIN/GROUP BY/COALESCE/CTE 分页），服务端静态构造，入参仅作绑定值（NR-02/03）；复合游标以展开 OR 式 `(t>$1) OR (t=$1 AND id>$2)` 表达（ADR-013/F07 口径不变）。
- **重复键**：PG `23505`（unique_violation）替代 Mongo `11000`，公共 `isDuplicateKeyError` 判定。
- **测试**：mongodb-memory-server → pg-mem（进程内 PG，registerFunction version/current_database  shim）。
- **栈依赖**：运行时移除 @nestjs/mongoose/mongoose，新增 @nestjs/typeorm/typeorm/pg；后端栈实质 node-nestjs-mongo→node-nestjs-psql（profile depends 键改名留待用户确认）。

## 8. 双凭证鉴权与 agent 直写规约（v1.3，ADR-018）

> 增量 id web-mgmt-20261125。契约详情见 `02-detailed/api/api-web-agent.md`；本节为栈级强制规约。

### 8.1 双凭证鉴权

- **会话体系不变**：X-Auth-Token → SessionTokenService（30 天滑动/内存撤销表），网站消费。
- **个人 API token（新）**：X-Api-Token → **独立 ApiTokenService/ApiTokenGuard**（dl_api_token 表，SHA-256 哈希查找+恒时比较+expires_at/revoked_at 判定+last_used_at 节流≤1 次/分钟）。明文 `dlpat_`+43 字符 base64url，**仅签发回执一次**（INV-28：不落库不进日志不回显）；吊销即时生效（每次查库，重启不丢失）。
- **全局 AuthGuard 回落顺序**：有 X-Auth-Token → 会话校验（现状）；无会话头且有 X-Api-Token → 委托 ApiTokenService.verify；两者皆无 → BIZ_AUTH_SESSION_EXPIRED。校验通过挂 request.user={userId, accountId, via}，**属主隔离（ADR-005）与 NR 查询规约口径不变**。
- **agent 直写端点仅 token**：POST /ver/version/agent-create 标 @Public() 旁路会话守卫 + @UseGuards(ApiTokenGuard)；无效统一 BIZ_AUTH_TOKEN_INVALID（防枚举）。
- token 等价账号全量属主权限（单用户无 RBAC/scope）；token 管理端点（/auth/token/*）仅会话。

### 8.2 agent 直写红线

- **VersionArchiveService.createVersionFromTask 为版本内容唯一写入口**（线上 agent-create 与本地 MCP version_create 同一服务）：单事务（seq FOR UPDATE→insert-only→movePointer→adjustRefCounts）+ 首版 onFirstVersionCreated + 提交后发 ver_version_created。**禁止任何绕过该服务的内容写路径**（INV-11 不可变延续）。
- taskId 合成 `agent-<snowflake>`，不建 dl_generation_task 行（任务表历史只读）。
- 定向调整：基线固化进 instruction_snapshot + INV-9 scope 存在性 + assertTargetedInvariance，越界 BIZ_VERSION_TARGET_INVARIANCE（BIZ 错误，不产版本）。
- 载荷红线：content JSON ≤2MB（env AGENT_CONTENT_MAX_MB）、pages 1~200、instruction ≤2000（1.6G 内存红线 ADR-016）。
- 服务端零渲染（ADR-015）不变：导出渲染在 MCP 本地进程，产物经 upload/fail 回传。

### 8.3 模块与表口径

- 八域→**五域**：DeckModule/VersionModule/DeliveryModule/AssetsModule/PlatformModule（auth+token+sync）；GenerationModule/AdjustmentModule/ChannelModule 与 platform/gateway 包退役（编码 C-02/C-03/D-01/P-01 不复用）。
- 物理表 11→**10**（11−2+1，W1 计数修正）：+dl_api_token；−dl_channel、−dl_channel_preference（DROP 迁移脚本 scripts/migrate-web-agent.ts）；dl_generation_task/dl_usage_record 保留历史只读。dl_deck_log 设计层未落地，不计物理表。
- 同步扫描聚合：去 PREFERENCE；TASK 历史只读；DECK/VERSION/ASSET/BRANDKIT/PROMPT/EXPORT 活跃（/auth/sync/pull 契约与 F07 复合游标不变，仅服务 MCP 本地离线模式）。
- 退役事件：gen_task_created/gen_task_finished/gw_task_advanced/gw_usage_recorded/channel_preference_changed；退役错误码族：BIZ_TASK_*/BIZ_GW_*/BIZ_CHANNEL_*/BIZ_ADJUST_*；新增：BIZ_AUTH_TOKEN_INVALID/BIZ_DECK_OUTLINE_INVALID/BIZ_VERSION_TARGET_INVARIANCE。枚举池（03/04）值域不动。

## 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.3 | 2026-11-25 | redirected | ADR-018（web-mgmt-20261125）：§1 契约冻结声明修订（66 冻结解除，75→56 端点，增量事实源 api-web-agent.md）；新增 §8 双凭证鉴权（会话不变+独立 ApiTokenGuard+AuthGuard 回落）与 agent 直写红线（VersionArchiveService 唯一写入口/载荷红线/零渲染）；模块八域→五域、表 11→10、同步扫描收窄。NR 查询安全/进程内事件/错误码格式口径不变 |
| v1.2 | 2026-11-24 | redirected | ADR-016 持久层 MongoDB→PostgreSQL（TypeORM）：新增 §7 PostgreSQL 建模增补节替代 §3；服务形态注记改 PG/UniGate 共实例；契约冻结/模块组织/查询安全/进程内事件/错误码枚举口径不变；对外 API 契约与客户端零变化 |
| v1.0 | 2026-10-08 | initial | 随 v3 技术栈重定向新建（替代 java-microservice 20-api-conventions；契约冻结 + Mongo 建模 + 查询安全 + 进程内事件） |
| v1.1 | 2026-10-08 | reconsidered | 复议修订（D0-v3 §5）：§1 契约冻结声明改「v1 全量 66 端点冻结，无删除」（/auth/sync/pull 及专用配套恢复，v1.0 的删除声明作废）；§3.6 新增同步游标 Mongo 实现规约（Date 毫秒游标+(cursor,id) 复合推进、SyncChangeScanner 八聚合 updated_time+id 升序扫描）；服务形态注记改宝塔 Node 项目部署+既有 MongoDB 实例（ADR-011） |

> **增量（2026-10-20，F07）**：同步游标升级为复合游标——AO `lastPosition`
> （`AGGREGATE:id`，可选）与 `lastCursor` 组成可续传全序；仓储扫描按
> `$or [>$ms, =ms 且业务id>afterId]` / `$gte $ms` / `$gt $ms` 三态取行
> （聚合名序决定边界毫秒行归属，`tiebreakFor`）。同毫秒任意行数不再漏行；
> 旧客户端（仅 lastCursor）行为不变。见 sync-change-scanner.ts SPI 注释。
