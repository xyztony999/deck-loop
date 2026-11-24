# 数据模型 / 持久层迁移设计（MongoDB → PostgreSQL / TypeORM）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 日期 | 2026-11-24 |
| 关联 | ADR-016、prd-persistence-migration v1.0、06 规约 v1.2 增补节 |
| 红线 | **对外 API 契约零变化**（66 端点冻结）；本文档仅描述实现层持久层，不修改任何 api-*.md §4.4 契约 |

## 0. 总则

- ORM：TypeORM 0.3（`@nestjs/typeorm` 10）+ `pg` 8。每物理表单一 `@Entity`；业务主键（雪花串）= `@PrimaryColumn`（varchar），**取代 ObjectId `_id`**（NR-08：无 `_id` 暴露面）。
- 字段名沿契约 snake_case 逐字平移（`@Column({ name: 'xxx' })`，property 名亦 snake_case，服务层读取口径不变）。
- 类型映射：VARCHAR→`varchar`（不截断长度，约束在应用层 INV 守卫，沿 v1 口径）；INT→`integer`；BIGINT（file_size）→`bigint`（TypeORM 返回 string，仓储归一为 number，JS 安全整数内）；DATETIME→`timestamptz`（毫秒精度）；JSON/Mixed/Map/数组嵌入→`jsonb`；Boolean→`boolean`。
- 审计六件套 / `data_version`（乐观锁，条件更新携带期望值 + `data_version = data_version + 1`）/ `delete_sign`（软删，查询默认 0）语义保留。
- 事务：`DataSource.transaction(async (manager) => …)`；仓储尾参 `session?: EntityManager`（替代 mongoose `ClientSession`）；`manager = session ?? dataSource.manager`。
- 查询安全（NR-02/03/05）：SQL/QueryBuilder 服务端静态构造，入参仅作绑定值（`$1`/`:param`）；userId 服务端注入；keyword 经 `ILIKE` 绑定值（无需正则转义，PG 参数化天然防注入）。
- 重复键判定：PG `error.code === '23505'`（unique_violation）替代 Mongo `11000`；公共工具 `isDuplicateKeyError`。
- 复合游标（ADR-013/F07）：以**展开 OR 式** `(t > $1) OR (t = $1 AND id > $2)` 表达（等价 row-value 比较，pg-mem 兼容）；排序 `(t ASC, id ASC)`。

## 1. 物理表 ↔ entity 映射（13 schema → 11 表）

| 物理表 | entity 类（文件） | 主键 | 唯一索引 | 普通索引 | jsonb 列 |
|--------|------------------|------|----------|----------|----------|
| dl_account | Account（platform/schemas/account.schema.ts） | account_id | uk_account_id, uk_email | — | — |
| dl_deck | Deck（deck/schemas/dl_deck.schema.ts） | deck_id | uk_deck_id | idx_user_status(user_id,deck_status,delete_sign), idx_user_updated(user_id,updated_time) | draft_outline |
| dl_deck_version | DeckVersion（version/schemas/dl_deck_version.schema.ts） | version_id | uk_version_id, uk_deck_branch(deck_id,branch_name,version_seq) | idx_deck_parent(deck_id,parent_version_id) | instruction_snapshot, content |
| dl_generation_task | GenerationTask（generation/schemas/dl_generation_task.schema.ts） | task_id | uk_task_id, uk_task_code | idx_gentask_deck_status(deck_id,task_status), idx_gentask_user_created(user_id,created_time) | instruction_snapshot |
| dl_export_task | ExportTask（deliver/schemas/dl_export_task.schema.ts） | export_id | uk_export_id | idx_export_deck(deck_id,export_status), idx_export_user_created(user_id,created_time) | — |
| dl_asset | Asset（asset/schemas/asset.schema.ts） | asset_id | uk_asset_id, uk_user_hash(user_id,file_hash) | idx_user_type(user_id,asset_type,asset_status) | — |
| dl_brand_kit | BrandKit（asset/schemas/brand-kit.schema.ts） | brand_kit_id | uk_brand_kit_id | idx_user(user_id,delete_sign) | colors, fonts |
| dl_prompt_template | PromptTemplate（asset/schemas/prompt-template.schema.ts） | template_id | uk_template_id | idx_user_scene(user_id,template_scene) | — |
| dl_channel | ChannelConfig（channel/schemas/channel-config.schema.ts） | channel_code | uk_channel_code | — | models |
| dl_channel_preference | ChannelPreference（channel/schemas/channel-preference.schema.ts） | preference_id | uk_preference_id, uk_user(user_id) | — | preference_map |
| dl_usage_record | UsageRecord（platform/schemas/usage-record.schema.ts） | usage_id | uk_usage_id | idx_user_time(user_id,occurred_at), idx_task(task_id) | — |

**只读投影（同表双模型消解）**：
- `GenerationTaskCore`（platform）→ 不再独立 entity；`GenerationTaskCoreRepository` 以 `dataSource`/manager 对 `dl_generation_task` 做条件 UPDATE 与游标 SELECT（同表共治 D1，索引归 GenerationTask entity）。
- `ChannelUsageRecordRow`（channel）→ 不再独立 entity；`ChannelRepository.aggregateUsage` 以 SQL 直查 `dl_usage_record`（只读）。
- `ChannelConfigDoc`（platform/gateway）→ 不再独立 schema；`GatewayRuntimeStore` 以 SQL 直查 `dl_channel`（只读快照）。

### 1.1 逐表字段清单（snake_case = 列名 = property 名）

**dl_account**：account_id(PK), email, password_hash, nickname, account_status(default 'ACTIVE'), last_login_at(timestamptz null), data_version(int default 0), delete_sign(int default 0), created_by/created_name/created_time/updated_by/updated_name/updated_time（审计，null 可）。

**dl_deck**：deck_id(PK), deck_code, deck_name, deck_type, topic, requirement(null), deck_status, draft_outline(jsonb null), default_brand_kit_id(null), current_version_id(null), active_branch(default 'main'), final_version_id(null), archived_from_status(null), user_id, created_by/created_name/created_time/updated_by/updated_name/updated_time, data_version(int default 0), delete_sign(int default 0)。

**dl_deck_version**（不可变，无 data_version/delete_sign/updated_*）：version_id(PK), deck_id, version_seq(int), branch_name, parent_version_id(null), source_type, task_id, instruction_snapshot(jsonb), content(jsonb), content_hash, page_count(int), user_id, created_by/created_name/created_time。

**dl_generation_task**：task_id(PK), task_code, deck_id, task_type, base_version_id(null), instruction_snapshot(jsonb), channel_code, model_code, task_status, result_version_id(null), error_msg(null), prompt_tokens(int null), completion_tokens(int null), user_id, data_version(int default 0), delete_sign(int default 0), 审计六件套。

**dl_export_task**：export_id(PK), export_code, deck_id, version_id, export_format, export_status, file_key(null), file_size(bigint null), error_msg(null), user_id, 审计六件套, data_version(int default 0), delete_sign(int default 0)。

**dl_asset**：asset_id(PK), asset_name, category(null), asset_type, storage_key, file_hash, width(int null), height(int null), file_size(bigint), asset_status, ref_count(int default 0), user_id, data_version(int default 0), delete_sign(int default 0), 审计六件套。

**dl_brand_kit**：brand_kit_id(PK), kit_name, colors(jsonb), fonts(jsonb null), logo_asset_id(null), is_default(int default 0), user_id, data_version(int default 0), delete_sign(int default 0), 审计六件套。

**dl_prompt_template**：template_id(PK), title, content, category(null), template_scene, use_count(int default 0), user_id, data_version(int default 0), delete_sign(int default 0), 审计六件套。

**dl_channel**：channel_code(PK), channel_name, api_base_url(default ''), api_key_cipher(default ''), api_key_env(default ''), priority(int default 0), enabled(bool default false), builtin(bool default false), source(default 'admin'), models(jsonb default '[]'), created_by/created_time/updated_by/updated_time, data_version(int default 0)。

**dl_channel_preference**：preference_id(PK), user_id, default_channel_code(null), default_model_code(null), preference_map(jsonb null), data_version(int default 0), delete_sign(int default 0), 审计六件套。

**dl_usage_record**（日志型，无审计/版本/软删）：usage_id(PK), user_id, task_id, task_type, channel_code, model_code, prompt_tokens(int default 0), completion_tokens(int default 0), occurred_at(timestamptz)。

## 2. 仓储重写规约（12 仓储 + adjustment 只读投影）

通用：注入 `@InjectRepository(E) repo` + `@InjectDataSource() dataSource`；事务方法 `const m = session ?? this.dataSource.manager`，实体操作用 `m.getRepository(E)`，跨表用 `m.query(sql, params)`。返回实体实例（property snake_case，服务层读取不变）。

### 2.1 DeckRepository（deck）
- findByIdOwned / findById：`repo.findOne({ where: { deck_id, user_id?, delete_sign: 0 } })`（manager 透传）。
- pageList：QueryBuilder 白名单 filter（keyword→`deck_name ILIKE '%'||$kw||'%'`；deckType/deckStatus eq；archivedScope=1→ARCHIVED，否则默认 `deck_status <> 'ARCHIVED'`；created_time >= / <=）；`ORDER BY updated_time DESC, deck_id DESC` + offset/limit；total 用同 filter `getCount`。
- create：`m.getRepository(Deck).insert(deck)`，返回 deck。
- conditionalUpdate：`UPDATE dl_deck SET <setFields>, updated_time=now, data_version=data_version+1 WHERE deck_id=$ AND user_id=$ AND delete_sign=0 AND deck_status IN($…) AND data_version=$`；返回 `affected===1`。setFields 由服务层白名单构造（键为代码级常量）。
- updateDraftOutline：`UPDATE … SET draft_outline=$jsonb, updated_by, updated_name, updated_time=now, data_version=data_version+1 WHERE deck_id/user_id/delete_sign=0`。
- selectList：同 pageList filter（默认非归档），`ORDER BY updated_time DESC, deck_id DESC`，无分页。

### 2.2 DeckStatsRepository（deck 跨聚合只读）
- countVersions/countAdjustTasks/countRunningTasks/countExports：`SELECT deck_id, COUNT(*)::int cnt FROM <表> WHERE deck_id = ANY($1) AND <extra> GROUP BY deck_id` → Map。extra 由枚举 code 绑定值。
- countRunningTasksOfDeck：`SELECT COUNT(*)::int … WHERE deck_id=$ AND delete_sign=0 AND task_status = ANY($2)`。
- findVersionSeqs：`SELECT version_id, version_seq FROM dl_deck_version WHERE version_id = ANY($1)` → Map。
- findLatestTask：`SELECT task_id, task_type, task_status FROM dl_generation_task WHERE delete_sign=0 AND deck_id=$ ORDER BY created_time DESC LIMIT 1`。
- findBrandKitName / countValidBrandKit：dl_brand_kit 点查/计数（delete_sign=0）。
- countVersionInDeck(session)：`SELECT COUNT(*)::int FROM dl_deck_version WHERE version_id=$ AND deck_id=$`（manager 透传，单事务可见新插入版本）。
- findMaxDeckCode(prefix, session)：`SELECT deck_code FROM dl_deck WHERE deck_code LIKE $1 ORDER BY deck_code DESC LIMIT 1`（$1=`prefix||'%'`）。

### 2.3 VersionRepository（version，insert-only INV-11）
- insert(doc, session)：`m.getRepository(DeckVersion).insert(doc)`；捕获 23505 → BizException(VERSION_BRANCH_EXISTS)。
- findMaxVersionSeq(deckId, session)：`SELECT version_seq FROM dl_deck_version WHERE deck_id=$ ORDER BY version_seq DESC LIMIT 1`（事务内可加 `FOR UPDATE` 锁 deck 维度，见 §4）。
- findBranchNames(deckId, session)：`SELECT DISTINCT branch_name FROM dl_deck_version WHERE deck_id=$`。
- findByDeckId：`WHERE deck_id=$ ORDER BY version_seq ASC`。
- findById：`WHERE version_id=$`。
- findTaskStatuses：`SELECT task_id, task_status FROM dl_generation_task WHERE delete_sign=0 AND task_id = ANY($1)` → Map。
- countByDeck / countByDeckAndSourceTypes：COUNT（source_type = ANY）。
- scanCreatedAfter(userId, cursorMs, limit, tiebreak)：投影 version_id/deck_id/version_seq/branch_name/source_type/created_time；cursor>0 时展开 OR 游标（created_time, version_id）；`ORDER BY created_time ASC, version_id ASC LIMIT $`。

### 2.4 GenerationTaskRepository（generation）
- insert(task, session)：insert；23505 → BizException(CODE_FAIL,'任务编码取号冲突')。
- conditionalAdvanceStatus：`UPDATE dl_generation_task SET <setFields>, task_status=$target, updated_by, updated_name, updated_time=now WHERE task_id=$ AND delete_sign=0 AND task_status = ANY($expected) [AND user_id=$]`；返回 affected===1。
- countActiveTasks(deckId, statuses, session)：COUNT（deck_id + task_status ANY + delete_sign=0）。
- findMaxTaskCode(prefix, session)：`SELECT task_code … WHERE task_code LIKE $1 ORDER BY task_code DESC LIMIT 1`。
- findById / findByIdOwned / findByIdsOwned：点查/属主/批量（task_id ANY）。
- pageList：白名单 filter（deckId/taskStatus/taskType eq；created_time >= / <=）；`ORDER BY created_time DESC, task_id DESC` + 分页 + getCount。

### 2.5 GenerationQueryRepository（generation 跨聚合只读）
- countActiveAssets：dl_asset COUNT（user_id + delete_sign=0 + asset_status=$ + asset_id ANY）。
- countValidBrandKit：dl_brand_kit COUNT。
- findDeckNames / findVersionSeqs：dl_deck / dl_deck_version 投影 → Map。

### 2.6 ExportTaskRepository（deliver）
- insert(task, session)：insert。
- conditionalTransition：`UPDATE dl_export_task SET <setFields>, export_status=$to, updated_by, updated_name, updated_time=now, data_version=data_version+1 WHERE export_id=$ AND delete_sign=0 AND export_status = ANY($from)` **RETURNING \***（取更新后行，事件载荷可用）；无行→null。
- findMaxExportCode(prefix, session)：LIKE prefix% ORDER BY export_code DESC LIMIT 1。
- findById / findByIdOwned：点查/属主。
- pageList：白名单 filter；`ORDER BY created_time DESC, export_id DESC` + 分页。
- countSucceededByDeck：COUNT（deck_id + user_id + delete_sign=0 + export_status='SUCCEEDED'）。
- scanUpdatedAfter：投影 export_id/deck_id/version_id/export_format/export_status/updated_time；展开 OR 游标（updated_time, export_id）。
- findDeckRefs / findVersionRefs：dl_deck（**不带 delete_sign 过滤**，软删 deck 历史导出仍回显名）/ dl_deck_version 投影 → Map。

### 2.7 AssetRepository / BrandKitRepository / PromptTemplateRepository / DeckBrandKitRefRepository（asset）
- Asset.findByHashIncludeDeleted：`WHERE user_id=$ AND file_hash=$`（**刻意不带 delete_sign**，INV-20 复活路径）。
- Asset.findById/findByIds：属主 + delete_sign=0（批量 asset_id ANY）。
- Asset.findPage：白名单（keyword→asset_name ILIKE；category/assetType/assetStatus eq）；`ORDER BY updated_time DESC` + 分页。
- Asset.findSelectList：ACTIVE + 属主；keyword ILIKE；`ORDER BY created_time DESC LIMIT 200`。
- Asset.insert(doc, session)：insert。
- Asset.revive：`UPDATE … SET delete_sign=0, asset_status='ACTIVE', <业务字段>, ref_count=0, data_version=0, updated_by, updated_time WHERE asset_id=$ AND user_id=$`（不带 delete_sign 过滤）。
- Asset.updateMeta/updateStatus/softDelete：条件 UPDATE + `data_version=data_version+1`；返回 affected。
- Asset.adjustRefCounts(userId, ids, delta, updatedBy?, session)：`UPDATE dl_asset SET ref_count = GREATEST(ref_count + $delta, 0), updated_time=now [, updated_by=$] WHERE user_id=$ AND asset_id = ANY($ids)`（INV-18 下限 0）。
- BrandKit.findById/findNamesByIds/findPage/findSelectList：属主 + delete_sign=0；findPage/findSelectList `ORDER BY is_default DESC, updated_time DESC`（默认置顶）；keyword→kit_name ILIKE。
- BrandKit.insert/update/clearDefault/setDefault/softDelete：条件 UPDATE + data_version+1；clearDefault=`UPDATE … SET is_default=0 … WHERE user_id=$ AND is_default=1 AND delete_sign=0`（INV-17 事务第一步）；setDefault 置 1（第二步）。
- PromptTemplate.findById/findPage/findSelectList/countByIds：属主 + delete_sign=0；findPage keyword→`(title ILIKE $ OR content ILIKE $)`；findSelectList `ORDER BY use_count DESC LIMIT 200`。
- PromptTemplate.insert/update/softDelete：条件 UPDATE + data_version+1。
- PromptTemplate.touchUseCount：`UPDATE … SET use_count=use_count+1, data_version=data_version+1 WHERE template_id/user_id/delete_sign=0`（仅计数不动 updated_time）；返回 affected。
- DeckBrandKitRefRepository.countDeckReference：dl_deck COUNT（default_brand_kit_id + user_id + delete_sign=0）。

### 2.8 ChannelRepository（channel）
- findSnapshotByUserId：`WHERE user_id=$ AND delete_sign=0`；preference_map jsonb → sanitizeTiers（驼峰 channelCode/modelCode 容错清洗）。
- upsertByUser：`INSERT INTO dl_channel_preference (…) VALUES (…) ON CONFLICT (user_id) DO UPDATE SET default_channel_code=EXCLUDED.…, preference_map=EXCLUDED.…, updated_by, updated_name, updated_time, data_version=dl_channel_preference.data_version+1`；首存 preference_id=雪花、created_* 固化（INV-23）。
- aggregateUsage：见 §3.1。

### 2.9 ChannelConfigRepository（channel 管理端）
- findByCode/listAll/countAll/insert/updateByCode：dl_channel CRUD；listAll `ORDER BY priority DESC, channel_code ASC`；updateByCode 条件 UPDATE + data_version+1。

### 2.10 AccountRepository / UsageRecordRepository / GenerationTaskCoreRepository（platform）
- Account.insert：insert（23505 由 Service 翻译 BIZ_AUTH_EMAIL_EXISTS）；findByEmail/findByAccountId（delete_sign=0）；touchLastLogin/updateNickname 条件 UPDATE + data_version+1。
- UsageRecord.append：insert（只追加）。
- GenerationTaskCoreRepository（同表共治，raw SQL on dl_generation_task）：
  - advanceToRunning：`UPDATE … SET task_status='RUNNING', updated_time=now WHERE task_id=$ AND task_status='QUEUED'`；返回 affected>0。
  - backfillUsage：`UPDATE … SET prompt_tokens=$, completion_tokens=$, updated_time=now WHERE task_id=$`。
  - fallbackAdvanceFailed：`UPDATE … SET task_status='FAILED', error_msg=$trunc512, updated_time=now WHERE task_id=$ AND task_status='RUNNING'`。
  - scanUpdatedAfter：投影 task_id/deck_id/task_type/task_status/user_id/updated_time/delete_sign；展开 OR 游标（updated_time, task_id）。

### 2.11 AdjustmentQueryRepository（adjustment 只读）
- findBaseVersionRow：`SELECT version_id, deck_id, user_id, content FROM dl_deck_version WHERE version_id=$`（content jsonb 形状校验）。
- countVersionBranch：`SELECT COUNT(*)::int FROM dl_deck_version WHERE deck_id=$ AND branch_name=$`。

## 3. 聚合管道 → SQL 对照

### 3.1 用量汇总（channel.aggregateUsage，dl_usage_record）

**CHANNEL / TASK_TYPE 维度**（Mongo `$match→$group→$sort→$project`）：
```sql
SELECT <dimCol> AS "dimKey",
       COUNT(*)::int AS "taskCount",
       COALESCE(SUM(prompt_tokens),0)::int AS "promptTokens",
       COALESCE(SUM(completion_tokens),0)::int AS "completionTokens",
       MAX(occurred_at) AS "lastUsedAt"
FROM dl_usage_record
WHERE user_id=$1 AND occurred_at >= $2 AND occurred_at <= $3
GROUP BY <dimCol>
ORDER BY "taskCount" DESC, "lastUsedAt" DESC, "dimKey" ASC;
```
`<dimCol>` 白名单常量：CHANNEL→channel_code，TASK_TYPE→task_type（非用户输入）。total=行数。

**DECK 维度**（Mongo `$lookup dl_generation_task → $unwind → $group → $facet{page:$sort+$skip+$limit+$lookup dl_deck, total:$count}`）：
```sql
-- 归组（任务已清理的记录不归组 = INNER JOIN 语义）
WITH agg AS (
  SELECT t.deck_id AS dim_key,
         COUNT(*)::int AS task_count,
         COALESCE(SUM(u.prompt_tokens),0)::int AS prompt_tokens,
         COALESCE(SUM(u.completion_tokens),0)::int AS completion_tokens,
         MAX(u.occurred_at) AS last_used_at
  FROM dl_usage_record u
  JOIN dl_generation_task t ON t.task_id = u.task_id
  WHERE u.user_id=$1 AND u.occurred_at >= $2 AND u.occurred_at <= $3
  GROUP BY t.deck_id
)
SELECT a.dim_key AS "dimKey", d.deck_name AS "dimName",
       a.task_count AS "taskCount", a.prompt_tokens AS "promptTokens",
       a.completion_tokens AS "completionTokens", a.last_used_at AS "lastUsedAt"
FROM agg a LEFT JOIN dl_deck d ON d.deck_id = a.dim_key   -- 不过滤 delete_sign（历史名称回显）
ORDER BY a.task_count DESC, a.last_used_at DESC, a.dim_key ASC
LIMIT $4 OFFSET $5;
-- total：SELECT COUNT(*)::int FROM agg（同 CTE）
```

### 3.2 deck 统计（DeckStatsRepository）
Mongo `$match{deck_id:$in,…}→$group{_id:'$deck_id',cnt:$sum:1}` → `SELECT deck_id, COUNT(*)::int cnt … WHERE deck_id = ANY($1) AND <extra> GROUP BY deck_id`（见 §2.2）。

### 3.3 sync 复合游标扫描（VERSION/TASK/EXPORT）
Mongo `cursorTimeFilter`（$gt / $or[>$ms, =ms且id>afterId] / $gte）+ `sort{time:1,id:1}` → SQL 展开 OR 式：
```sql
-- tiebreak=null（严格 gt）：
WHERE user_id=$1 AND <t> > $2
-- tiebreak.includeCursorRow && afterId（同毫秒续传）：
WHERE user_id=$1 AND ((<t> > $2) OR (<t> = $2 AND <id> > $3))
-- tiebreak.includeCursorRow && !afterId：
WHERE user_id=$1 AND <t> >= $2
ORDER BY <t> ASC, <id> ASC LIMIT $n;
```
`<t>`/`<id>`：VERSION=created_time/version_id；TASK=updated_time/task_id；EXPORT=updated_time/export_id。cursor=0 全量起始（仅 user_id 过滤）。

## 4. 版本归档事务方案（rs0 → PSQL 原生）

**v3 Mongo 现状**：`connection.transaction`（需 rs0 副本集 + keyFile）；`VersionArchiveService.insertAndAdvance` 事务内 seq 分配 + insertOnly，**movePointer/adjustRefCounts 在提交后**（两段式遗留偏离，因 countVersionInDeck/adjustRefCounts 不接受 session）。

**PSQL 目标（恢复 v1 单事务）**：
```
DataSource.transaction(async (manager) => {
  // seq 分配：锁 deck 维度，防并发取号
  SELECT version_seq FROM dl_deck_version WHERE deck_id=$1 ORDER BY version_seq DESC LIMIT 1 FOR UPDATE;
  versionSeq = (max ?? 0) + 1;
  // 分叉留档：锁内复查分支名（writeGuard(manager)）
  INSERT INTO dl_deck_version (…) VALUES (…);          // uk_deck_branch 兜底 23505→BRANCH_EXISTS
  // 指针回写（同事务，countVersionInDeck(manager) 可见新插入版本）
  DeckDomainService.movePointer(deckId, versionId, branch, userId, manager);
  // 引用计数（同事务）
  AssetDomainService.adjustRefCounts(userId, assetIds, +1, manager);
});
// 提交后发 ver_version_created（NR-07）
```
- `countVersionInDeck` / `adjustRefCounts` / `movePointer` / `findMaxVersionSeq` / `findBranchNames` 增 `session?: EntityManager` 透传（修复 v3 缺口）。
- 取号并发：`FOR UPDATE` 锁 deck 维度最大 seq 行 + uk_deck_branch 唯一索引兜底；deck/GT/EX 取号同模式（事务内 MAX+1 + 唯一索引）。
- **移除 rs0/keyFile 依赖**：PG 单机即支持 ACID 事务；部署不再需要副本集。
- 事件 NR-07：TypeORM 事务回调成功返回即提交，调用点在 `await transaction` 之后发布；`DeckEventPublisher.publishStatusChanged` 携带 manager 时改为「事务提交后发布」由调用点保证（无 session 'ended' 监听）。

## 5. 一次性数据迁移脚本（scripts/migrate-mongo-to-pg.ts）与建表（src/scripts/init-schema.ts）

> **索引命名约束（实施教训）**：PG 索引名 schema 级唯一（Mongo 按集合隔离）——同名索引跨表复用
> 会在 synchronize/建表时报 `relation "idx_user_created" already exists`。已全部改为表前缀
> （idx_export_*/idx_gentask_*）；新增索引必须带表前缀。

- 运行：`pnpm migrate:mongo-to-pg -- [--dry-run] [--mongo-uri=…] [--pg-url=…]`（env `MONGODB_URI`/`DATABASE_URL` 兜底）。
- 依赖：`mongodb` 驱动（读源）+ `pg` Client（写目标）；**无 TypeORM 装饰器**（纯 SQL，tsx 可运行）。
- 流程：连接 Mongo（源）+ PG（目标）→ 逐表 `find({})` 全量读 → 字段 transform → 批量 `INSERT … ON CONFLICT (PK) DO UPDATE`（幂等）→ 逐表 count 校验 + 关键聚合比对（usage tokens / asset ref_count 求和）。
- transform 规则：
  - 丢弃 `_id`/`__v`；业务 id 保留；不属于目标列的键丢弃并汇总报告。
  - Date→ISO timestamptz（毫秒不变）；null/缺失→NULL。
  - Mixed/对象/数组（content/instruction_snapshot/draft_outline/colors/fonts/preference_map/models）→ `JSON.stringify` 写 jsonb。
  - preference_map：Mongo Map BSON 原貌为对象，直接 jsonb。
  - 数值：number→int/bigint（file_size bigint）；prompt/completion_tokens null→NULL（usage 默认 0 由列默认）。
  - 键缺失（undefined）→ 目标列默认（**解析自 information_schema.column_default，不硬编码**）；
    默认未知且列 NOT NULL → 数值/布尔零值兜底（文本/json 不臆造，交由目标库拒绝暴露脏文档）。
- 目标表须先存在：`node dist/scripts/init-schema.js`（按 entity 一次性 synchronize 建表；
  目标库已有本应用表时拒绝执行，防对非空库做结构同步；应用运行时 synchronize=false 不变）。
- `--dry-run`：只读源 + transform + 统计/抽样，**不写目标**。
- 校验：源计数 vs 目标计数（目标可多于源——如 builtin 渠道 seed，仅提示）；聚合不一致 → 退出码 1。
- 安全：密码仅经 env/参数（日志脱敏 `://***@`）；脚本不删除源数据（Mongo 下线另经授权）。
- **部署形态**：脚本随 `pnpm build` 编译进部署包（`dist/scripts/`，`tsconfig.scripts.json`）；
  `mongodb` 已移入 dependencies（服务器 `--prod` node_modules 可用）——Mongo 下线后可回收。
- 单测：`test/migrate-mongo-to-pg.spec.ts`（pg-mem + 内存源跑通 transform/upsert/默认/幂等/聚合）。

## 6. 测试基建改造（实况）

- `pg-mem` 内存 PostgreSQL：**每 TestContext 独立建库**（`test/helpers/testing-app.ts#createTestDataSource`），
  `synchronize:true` 建表后以 `.overrideProvider(DataSource)` 覆盖 AppModule 的 DataSource
  （`forRoot` 不连真实 PG）；global-setup/teardown 保留为空操作。
- pg-mem 原生函数极少：注册 `version/current_database/current_schema/current_setting`
  （TypeORM initialize/synchronize 所需）。
- `TestContext.dataSource()` 替代原 mongoose `connection()`；既有测试直查铺底改 raw SQL /
  `getRepository(Entity).insert()`（6 处：dl_usage_record / dl_export_task / dl_channel /
  dl_channel_preference）。
- app.spec：PG DataSource `isInitialized` + `options.type === 'postgres'` 断言。
- 1.6G 服务器约束只影响部署，不影响本地测试（pg-mem 进程内，零外部依赖）。

### 6.1 实施期揪出的真 bug（迁移引入，已修）

- **占位符序号与参数位次错位**：`DeckStatsRepository.countRunningTasksOfDeck` 拼
  `task_status IN ($2,$3)` 时 `$2` 已被 `deck_id` 占用 → 实际执行 `IN (deckId,'QUEUED')`，
  永不匹配 RUNNING，**归档/定稿「进行中任务」守卫形同虚设**（Mongoose 无占位符概念故旧版无此问题）。
  由 deck.spec 守卫用例暴露；修正为 `$${i + 3}` 严格对齐 `[delete_sign, deckId, ...statuses]`。
  **铁律：手拼 `$n` 占位符时，序号必须与参数数组位次逐一对齐；新增 `$k` 参数先数前面有几个。**
- 同类排查：`countActiveTasks`、`inClause`/`cursorCondition` 各调用点的 startIndex 均已核对无误。

## 7. 契约不变性核验清单

- 66 端点 AO/VO/Result/错误码：由既有 jest 全量用例守护（零改动通过即契约不变）。
- 字典 key 驼峰（deckType/taskStatus/exportFormat/assetType/templateScene/channelCode/modelCode）：枚举池与 dict-service 零改动。
- 同步游标 syncCursor 字段与复合推进：sync-cursor 用例守护。
- client typecheck/build：零源码改动绿。