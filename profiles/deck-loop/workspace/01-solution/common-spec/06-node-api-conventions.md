# Node/NestJS API 规约（deck-loop v3）

> 对 v1 java-microservice 栈规约（skills/backend-specs/20-api-conventions.md）的**替代规约**，依据 D0-v3 技术栈重定向（2026-10-08）。八份 api-*.md 与 api-index.md 自 v1.1 起按本规约执行。

| 属性 | 值 |
|------|-----|
| 版本 | v1.1 |
| 日期 | 2026-10-08 |
| 服务形态 | Node.js + TypeScript + NestJS 单服务 deck-loop-core + MongoDB（宝塔「Node 项目」部署/PM2 守护+内存限额，MongoDB 用服务器既有实例；Docker Compose 备选——ADR-011） |

## 1. 契约冻结声明

- **v1 API 契约全量冻结沿用（v1 全量 66 端点，无删除）**：接口路径 / HTTP 方法 / AO / VO 字段 / `Result<T>`·`PageResult<T>` 包装 / 错误码（BIZ_*）/ 枚举池（03/04）**一字不改**（前端 v1 代码全量复用，含多端同步交互；仅代理目标随 v3 调整）。
- 2026-10-08 复议修订（D0-v3 §5，ADR-013 修订）：恢复 POST /auth/sync/pull 及其专用配套（登录 VO 的 syncCursor 字段、游标扫描机制、SyncChangeOp 枚举），端点口径 65→66；v1.0 曾按「砍同步」声明的唯一契约删除**作废**。
- 本规约与 v1 的差异仅限**实现层**：DDL→MongoDB collection、MQ→进程内事件、Java→Node/TS；传输契约永不冲突。各 api 文档 §4.4（接口清单/详情）为契约唯一事实源，本规约不重复也不修改它。

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

## 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-08 | initial | 随 v3 技术栈重定向新建（替代 java-microservice 20-api-conventions；契约冻结 + Mongo 建模 + 查询安全 + 进程内事件） |
| v1.1 | 2026-10-08 | reconsidered | 复议修订（D0-v3 §5）：§1 契约冻结声明改「v1 全量 66 端点冻结，无删除」（/auth/sync/pull 及专用配套恢复，v1.0 的删除声明作废）；§3.6 新增同步游标 Mongo 实现规约（Date 毫秒游标+(cursor,id) 复合推进、SyncChangeScanner 八聚合 updated_time+id 升序扫描）；服务形态注记改宝塔 Node 项目部署+既有 MongoDB 实例（ADR-011） |

> **增量（2026-10-20，F07）**：同步游标升级为复合游标——AO `lastPosition`
> （`AGGREGATE:id`，可选）与 `lastCursor` 组成可续传全序；仓储扫描按
> `$or [>$ms, =ms 且业务id>afterId]` / `$gte $ms` / `$gt $ms` 三态取行
> （聚合名序决定边界毫秒行归属，`tiebreakFor`）。同毫秒任意行数不再漏行；
> 旧客户端（仅 lastCursor）行为不变。见 sync-change-scanner.ts SPI 注释。
