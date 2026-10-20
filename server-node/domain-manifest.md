# deck-loop v3 域协调清单（domain-manifest）

> 创建：T01'（2026-10-09）。八域并行代码生成代理的**唯一协调输入**。
> 设计文档（唯一事实源）：profiles/deck-loop/workspace/02-detailed/api/api-{deck,generation,adjustment,version,delivery,assets,channel,platform}.md（v1 契约全量 66 端点冻结）+ api-index.md
> 栈规约：.claude/skills/node-specs/20-api-conventions.md；业务规则以 Java v1 源码（见文末「Java v1 参考索引」）+ v1 测试 68 用例为准
> 通用约束：单服务进程内直调（无 HTTP 回环）；每域一个 NestModule `src/{domain}/{domain}.module.ts`（T01' 已占位）；域内分层 controller→service→repository→schemas + dto；隔离字段 user_id 服务端注入（ADR-005）；`_id` 仅存储不进 VO；业务主键=雪花串（`common/utils/snowflake`）；查询白名单映射（请求体键名不得成为 filter/sort/projection 键）；事件=EventEmitter2、名=契约 businessType、**事务提交后发布**。
> 共享工件（T01' 预建，只消费不修改）：`src/common/enums/`（17 枚举 + getLabelByCode/enumToSelectOptions）；`src/{domain}/{domain}.errors.ts`（8 文件 27 码）；`src/common/`（Result/PageResult/SelectOption/OperItem/BizException/AuthGuard/@Public/@CurrentUser）。

## 0. @Public 端点清单（全局认证口径）

全局 AuthGuard 读 `X-Auth-Token` 头；@Public() 跳过守卫。**全 66 端点中仅 4 个**走 @Public，其中 2 个在 handler 内自证身份（浏览器 GET 语义无法携带自定义头）：

| 端点 | 标注 | 依据与实现口径 |
|------|------|---------------|
| POST /auth/account/register | @Public | api-platform §3.3「注册/登录免鉴权」 |
| POST /auth/account/login | @Public | 同上 |
| GET /gw/task/stream（SSE） | @Public + **handler 内 query token 校验** | api-platform §3.1「会话鉴权」：EventSource 无法自定义 header → 守卫旁路后在 handler 内校验 `?token=`（等价 AuthTokenVerifier），不得裸公开 |
| GET /deliver/export/download | @Public + **handler 内 HMAC 凭证校验** | api-delivery §3.3「校验凭证签名+属主」：token=HMAC(exportId,userId,exp 30min)，先经 POST download-ticket（受保护）换取；属主随凭证携带 |

判定说明（曾存疑项）：POST /asset/asset/file-url 与 POST /asset/brandkit/provider-get 虽为 OHS，但 api-assets §3.3「会话+属主；全部查询/写入强制 user_id」→ **非 @Public**（进程内消费方直调 Service，HTTP 端点留给会话调用）；POST /deliver/export/download-ticket 为业务 POST → 受保护（app.module 骨架注释中「下载票据」列入 @Public 系笔误，以本表为准）。

## 1. deck 域（api-deck.md，C-01/C-05）——10 端点

**① collection（§5.3 摘要）**：`dl_deck`（聚合根=document；dl_deck_log 平台框架只追加，不占十集合）。嵌入：`draft_outline`（大纲节点树整体嵌入，无独立生命周期）。引用（仅存业务 id）：`default_brand_kit_id`/`current_version_id`/`final_version_id`（跨聚合指针，INV-1/INV-2 应用层守卫）。更新语义：可更新文档，dataVersion 乐观锁（$inc），deleteSign 逻辑删除（查询默认 0）。索引：uk_deck_id{unique}、idx_user_status{user_id,deck_status,delete_sign}、idx_user_updated{user_id,updated_time}。取号：deck_code=DL+yyMMdd+4 位序列。

**② 端点清单（10）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /deck/deck/list | 分页+筛选（keyword/deckType/deckStatus/timeRange/archivedScope）；operList 由 DeckStatus 驱动（edit/finalize/unfinalize/archive/restore/delete） |
| 2 | POST /deck/deck/save | 新建/编辑（id 空新建）；仅 DRAFT/ITERATING 可改（BIZ_DECK_STATUS_FORBIDDEN）；INV-5/INV-7 |
| 3 | POST /deck/deck/detail | withStats{versionCount,adjustCount,exportCount}/withLatestTask 开关；brandKitName 冗余 |
| 4 | POST /deck/deck/archive | 无进行中任务；记录 archivedFromStatus |
| 5 | POST /deck/deck/restore | ARCHIVED→archivedFromStatus |
| 6 | POST /deck/deck/delete | 软删除，仅 ARCHIVED |
| 7 | POST /deck/deck/finalize | 守卫：无进行中任务+currentVersionId 非空；finalVersionId=currentVersionId |
| 8 | POST /deck/deck/unfinalize | 仅 FINALIZED；回 ITERATING；finalVersionId 保留 |
| 9 | POST /deck/dict/batch | DeckType/DeckStatus |
| 10 | POST /deck/select/deck-list | 选择池（deck.select.deckList，导出筛选等） |

**③ 事件**：`deck_deck_status-changed`｜载荷 deckId/deckStatus/userId｜订阅方：多端同步（P-02）、客户端通知。

**④ 跨域依赖**：
- 消费（出站）：无（BrandKit 名称经素材域 Select 冗余展示）；detail withStats 读 version/generation/deliver 计数（建议只读计数方法，见汇总表）。
- 提供（供他域调用，v1 DeckDomainService 对齐）：
  - `assertCanCreateTask(deckId, userId): void`——INV-3 守卫（FINALIZED/ARCHIVED 拒绝）；消费方 generation/adjustment 任务创建前置
  - `assertFinalized(deckId, userId): { deckId, finalVersionId }`——FINALIZED 守卫；消费方 deliver(submit/present/data)
  - `movePointer(deckId, versionId, branchName?, userId): void`——INV-1 指针/分支统一入口（乐观锁）；消费方 version(rollback/fork)、generation 成功回调
  - `onFirstVersionCreated(deckId, userId): void`——INV-4 DRAFT→ITERATING（幂等：仅 DRAFT 生效）；消费方 generation 成功回调
  - `updateDraftOutline(deckId, outline, userId): void`——gen outline/save 跨模块写
- 状态机：DRAFT→ITERATING（首版回调自动）；ITERATING↔FINALIZED；→ARCHIVED；ARCHIVED→恢复/软删除（§4.2）。

**⑤ @Public**：无（全部会话+属主）。

## 2. generation 域（api-generation.md，C-02）——9 端点

**① collection**：`dl_generation_task`（子流程独立聚合=document；四类 taskType 共用）。嵌入：`instruction_snapshot`（入参/指令快照整体嵌入，含 adjust 节值对象，不可变）。引用：`deck_id`/`base_version_id`/`result_version_id`（SUCCEEDED⇔result_version_id 非空）。快照：channel_code/model_code 为路由快照 string（非解引用）。更新语义：状态推进 updateOne（filter 含 task_id+user_id+前置状态，幂等）；INV-8 互斥=多文档事务内存在性查询（同 deck 至多 1 个非终态任务）。索引：uk_task_id{unique}、idx_deck_status、idx_user_created。取号：task_code=GT+yyMMdd+4 位。

**② 端点清单（9）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /gen/outline/generate | →taskId（assetIds≤10 启用态、brandKitId 启用态、extraRequirement≤500） |
| 2 | POST /gen/outline/save | 持久化 draftOutline（节点 1~50、title≤50） |
| 3 | POST /gen/full/generate | outlineSnapshot 或 useDraft=true；lengthOption SHORT/MEDIUM/LONG 默认 MEDIUM |
| 4 | POST /gen/task/list | 分页/按 deck/状态/类型；operList：cancel(QUEUED/RUNNING)、retry(FAILED) |
| 5 | POST /gen/task/detail | 含指令快照 |
| 6 | POST /gen/task/progress | 批量轮询 taskIds≤20（客户端 2s 间隔；SSE 为增强） |
| 7 | POST /gen/task/cancel | 仅 QUEUED/RUNNING（BIZ_TASK_NOT_CANCELLABLE） |
| 8 | POST /gen/task/retry | 仅 FAILED；新任务复制 instruction_snapshot |
| 9 | POST /gen/dict/batch | TaskType/TaskStatus |

**③ 事件**：`gen_task_created`｜taskId/deckId/taskType｜订阅方：网关调度（进程内 GatewayTaskService#execute）。`gen_task_finished`｜taskId/deckId/taskStatus/resultVersionId｜订阅方：多端同步、客户端通知（SSE 推送）。（adjustment 复用，taskType 区分。）

**④ 跨域依赖**：
- 消费：deck（assertCanCreateTask/movePointer/onFirstVersionCreated/updateDraftOutline）；channel（`ChannelPreferenceService.resolve(taskType,userId): {channelCode,modelCode}` 路由）；asset（素材 Select、品牌规范读取 getBrandKit）；platform（网关协作，见提供）。
- 提供：`GenerationTaskService.createTask({ deckId, taskType, instructionSnapshot, userId }): { taskId, taskCode, taskStatus }`——四类 taskType 共用创建入口；消费方 adjustment（whole/targeted submit）。
- **任务成功回调=跨聚合编排点**（本域 owner，同事务）：`version.createVersionFromTask(task, result)` → `deck.movePointer(...)` → `deck.onFirstVersionCreated(...)` → `asset.adjustRefCounts(assetIds, +1)`；发 gen_task_finished（提交后）。OUTLINE 成功仅写 deck.updateDraftOutline。
- 内部接口（对 platform）：submitToGateway(task)=发 gen_task_created 或直调 GatewayTaskService#execute；onTaskCallback(taskId,status,result,usage) 幂等（taskId+期望前置状态）。

**⑤ @Public**：无。

## 3. adjustment 域（api-adjustment.md，C-03）——4 端点

**① collection**：**无独立 collection**（调整指令=instruction_snapshot 内 adjust 节值对象，随 dl_generation_task / dl_deck_version 文档整体嵌入）。值对象契约（§4.1）：instructionText≤2000✅、baseVersionId✅、targetKind(TARGETED 必填)、targetPath{pageId}|{pageId,blockId}、applyBrandKit✅、brandKitId(apply 必填，默认取 Deck 默认)、usedTemplateIds[]、baseBranchName✅（发起时活动分支快照）。

**② 端点清单（4）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /adjust/whole/submit | →taskId/taskCode/taskStatus/forked(bool)；基线≠currentVersionId 时 needForkBranch 提示（confirm=false 拒绝/true+branchName 接受） |
| 2 | POST /adjust/targeted/submit | 增 targetKind/targetPath；INV-9 内联（等价 scope/validate） |
| 3 | POST /adjust/scope/validate | valid(bool)+targetSummary（页码+块摘要 UI 回显） |
| 4 | POST /adjust/dict/batch | TargetKind |

**③ 事件**：无独立事件（复用 gen_task_created / gen_task_finished，taskType 携带调整类型）。

**④ 跨域依赖**：
- 消费：deck（assertCanCreateTask）；generation（createTask 子流程，同表写入）；version（baseVersionId 归属/内容读取、scope 校验依据 content）；asset（品牌规范注入、`assertTemplatesExist(templateIds)` 话术存在性轻校验）。
- 提供：无（管理接口+值对象契约；提交即锁定基线 baseVersionId 快照进 instruction_snapshot）。
- 校验：INV-3/INV-8/INV-9/INV-10（占位符未替换→BIZ_ADJUST_PLACEHOLDER_UNRESOLVED）；定向调整一致性校验（未涉及页面逐字节一致）失败→任务 FAILED（D2）。

**⑤ @Public**：无。

## 4. version 域（api-version.md，C-04）——6 端点

**① collection**：`dl_deck_version`（独立聚合=document）。嵌入：`content`（页面树快照整体嵌入：pages[]→blocks[]，blockType TEXT|IMAGE|PLACEHOLDER，不可变）；`instruction_snapshot`（整体嵌入）。引用：`deck_id`/`parent_version_id`/`task_id`（INV-13）。**不可变语义：仓储仅 insertOne（INV-11），无任何 update 路径；无 dataVersion/deleteSign**。version_seq=deck 维度多文档事务内 max+1（冗余列，树浏览免解析 content）；content_hash=SHA-256。索引：uk_version_id{unique}、uk_deck_branch{deck_id,branch_name,version_seq unique 复合}、idx_deck_parent。

**② 端点清单（6）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /ver/version/tree | 谱系树（branchScope=ALL/ACTIVE 默认 ACTIVE）+branches[]；节点含 isCurrent/isFinal；operList：set-current/fork-from/export-from |
| 2 | POST /ver/version/detail | 全字段+content 完整 JSON（前端按页虚拟渲染） |
| 3 | POST /ver/version/compare | 双版本差异过程数据（changeKind NONE/STRUCTURE/TEXT/IMAGE/NEW/REMOVED，按页返回）；同版本拒绝 |
| 4 | POST /ver/version/rollback | 移当前指针（Deck 须 ITERATING；经 movePointer） |
| 5 | POST /ver/version/fork | 新命名分支（branchName≤50 同 deck 唯一）+activeBranch 切换 |
| 6 | POST /ver/dict/batch | VersionSourceType |

**③ 事件**：`ver_version_created`｜versionId/deckId/versionSeq/branchName｜订阅方：多端同步、客户端通知；**同时触发 asset 引用计数回调（INV-18，api-index 跨模块契约）**。

**④ 跨域依赖**：
- 消费：deck（movePointer——rollback/fork/留档指针统一入口）；asset（content 内 assetId 渲染时经 OHS 取文件）。
- 提供（v1 VersionDomainService 对齐）：
  - `createVersionFromTask(task, content): { versionId, versionSeq }`——**版本写入唯一入口**（仅任务成功回调路径调用；insert-only + seq 事务 + 发 ver_version_created）；
  - `getVersionContent(versionId, userId): content 快照`——消费方 adjustment（基线/scope 校验）、deliver（演示/渲染）；
  - `countByDeck(deckId, userId): { versionCount, adjustCount }` 等只读统计——消费方 deck detail withStats。
- 约束：禁止任何 update content 的接口存在（§3.2）。

**⑤ @Public**：无。

## 5. deliver 域（api-delivery.md，C-06/S-03）——7 端点

**① collection**：`dl_export_task`（子流程聚合=document；SUCCEEDED 终态即「导出记录」）。嵌入：无结构化嵌入（终态字段标量）。引用：`deck_id`/`version_id`（**INV-14：version_id 必须为该 deck 的 finalVersionId**）；file_key 指向对象存储（外部引用）。更新语义：终态 updateOne 幂等（filter 含前置状态）；INV-15 SUCCEEDED⇔file_key 非空。索引：uk_export_id{unique}、idx_deck{deck_id,export_status}、idx_user_created。取号：export_code=EX+yyMMdd+4 位。

**② 端点清单（7）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /deliver/export/submit | →exportId/exportStatus；FINALIZED 守卫；PPTX needConfirm=true（beta） |
| 2 | POST /deliver/export/list | 分页/按 deck/格式/状态；operList：download(SUCCEEDED)/cancel(QUEUED/RENDERING)/retry(FAILED) |
| 3 | POST /deliver/export/cancel | QUEUED/RENDERING |
| 4 | POST /deliver/export/download-ticket | 换取限时 url+expiresIn（HMAC 30min） |
| 5 | **GET** /deliver/export/download | **@Public+凭证校验**：Query exportId/token；SUCCEEDED+属主（BIZ_EXPORT_NOT_DOWNLOADABLE）；文件流 Content-Disposition=DL-{deck_code}-v{seq}.{ext} |
| 6 | POST /deliver/present/data | 定稿版本放映数据（finalVersionId.content+演讲者备注组装） |
| 7 | POST /deliver/dict/batch | ExportFormat/ExportStatus |

**③ 事件**：`deliver_export_finished`｜exportId/deckId/exportStatus｜订阅方：多端同步、客户端通知。

**④ 跨域依赖**：
- 消费：deck（`assertFinalized(deckId)` 定稿守卫——错误码复用 deck 域 BIZ_DECK_STATUS_FORBIDDEN + 本域 EXPORT_NOT_FINALIZED）；version（finalVersionId 快照读取 getVersionContent）；asset（渲染取素材文件 signFileUrls）。
- 提供：`countByDeck(deckId, userId): number`（deck detail withStats exportCount）；内部接口 submitToRenderer(task)/onRenderCallback(exportId,status,fileKey)（幂等）。

**⑤ @Public**：GET /deliver/export/download（见 §0 全局表）。

## 6. asset 域（api-assets.md，S-01/S-02）——20 端点

**① collection（三聚合根）**：
- `dl_asset`：无结构化嵌入；无出站引用；被 dl_brand_kit.logo_asset_id 与版本 content 引用（ref_count 计数维护 INV-18，$inc 原子更新）；uk_user_hash{user_id,file_hash unique}（INV-20 重复上传检测）；idx_user_type。
- `dl_brand_kit`：嵌入 colors{primary,assistants[]}/fonts{title,body}；引用 logo_asset_id（INV-16 启用态守卫）；is_default（INV-17 用户维度唯一，默认切换=多文档事务旧默认置 0+新默认置 1）；idx_user{user_id,delete_sign}。
- `dl_prompt_template`：无嵌入（content 含 {占位符} string）；无引用；idx_user_scene。
- 上传约束 INV-19（jpg/png/svg/webp、≤10MB）；INV-21 占位符语法 {名称}≤10 处；被引用（refCount>0）素材/规范仅可停用不可删除（D1/ADR-004）。

**② 端点清单（20）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /asset/asset/list | 分页/分类/类型/状态/关键词；operList：edit/disable(ACTIVE)/enable(DISABLED)/delete(refCount=0) |
| 2 | POST /asset/asset/upload | multipart；hash 命中返回 existingAssetId+assetUrl 不新建；VO 含 thumbnailUrl/duplicated |
| 3 | POST /asset/asset/save | 名称/分类编辑 |
| 4 | POST /asset/asset/disable | 停用 |
| 5 | POST /asset/asset/enable | 恢复 |
| 6 | POST /asset/asset/delete | 仅 refCount=0（BIZ_ASSET_IN_USE） |
| 7 | POST /asset/select/asset-list | 选择池 asset.select.assetList |
| 8 | POST /asset/brandkit/list | 规范分页 |
| 9 | POST /asset/brandkit/save | 新建/编辑（logoAssetId 启用态校验 INV-16） |
| 10 | POST /asset/brandkit/delete | 非默认（BIZ_BRANDKIT_IS_DEFAULT）且未被 deck.default_brand_kit_id 引用 |
| 11 | POST /asset/brandkit/set-default | 事务切换默认 |
| 12 | POST /asset/select/brandkit-list | 选择池 asset.select.brandkitList |
| 13 | POST /asset/prompt/list | 话术分页 |
| 14 | POST /asset/prompt/save | 占位符校验 INV-21 |
| 15 | POST /asset/prompt/delete | 删除 |
| 16 | POST /asset/select/prompt-list | 选择池 asset.select.promptList |
| 17 | POST /asset/prompt/touch | 使用计数 +1（指令引用后） |
| 18 | POST /asset/dict/batch | AssetType/AssetStatus/TemplateScene |
| 19 | POST /asset/asset/file-url | OHS：素材文件限时 URL 签发（受保护，见 §0） |
| 20 | POST /asset/brandkit/provider-get | OHS：品牌规范读取（受保护，见 §0） |

**③ 事件**：`asset_{resource}_changed`（resource=asset/brandkit/prompt）｜载荷 {resource}Id/op｜订阅方：多端同步。

**④ 跨域依赖**：
- 消费：无出站（被依赖方；对象存储为基础设施）。
- 提供（v1 AssetDomainService 对齐）：
  - `adjustRefCounts(assetIds[], delta): void`——$inc ref_count（INV-18）；消费方 version 留档回调（ver_version_created 订阅或 generation 编排直调）
  - `signFileUrls(assetIds[]): { assetId, url, expiresAt }[]`——OHS file-url 服务化；消费方 deliver（渲染）、generation（注入）、演示
  - `getBrandKit(brandKitId, userId): BrandKit`——OHS provider-get 服务化；消费方 generation（品牌注入）
  - `assertTemplatesExist(templateIds[]): void`——轻校验；消费方 adjustment（usedTemplateIds）
  - BrandKit 名称冗余读取（deck 列表展示）

**⑤ @Public**：无。

## 7. channel 域（api-channel.md，D-01）——4 端点

**① collection**：`dl_channel_preference`（聚合根=document；1:1 用户，每用户至多一篇）。嵌入：`preference_map`（{OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST:{channelCode,modelCode}}，缺省回落默认档）。引用：default_channel_code/default_model_code 为渠道配置代码（引用服务端渠道注册 env/config，非业务 id 外键；INV-22 应用层守卫）。更新语义：upsert（uk_user 唯一，INV-23）。索引：uk_preference_id{unique}、uk_user{unique}。渠道注册不建 collection（v3 起服务端配置）。

**② 端点清单（4）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /channel/preference/detail | 含渠道可用性标注（preferenceMap 逐档位 available）+fallbackChannel（平台兜底只读） |
| 2 | POST /channel/preference/save | upsert；逐项 INV-22 校验；空值=清除档位回落默认 |
| 3 | POST /channel/usage/summary | 维度聚合 dimension=CHANNEL/DECK/TASK_TYPE、timeRange≤12 个月、DECK 维度分页 |
| 4 | POST /channel/select/model-options | 选择池 channel.select.modelOptions（capabilityTag 可选） |

（无 dict 端点：档位键=TaskType，无独立业务枚举。）

**③ 事件**：`channel_preference_changed`｜userId｜订阅方：多端同步。

**④ 跨域依赖**：
- 消费：platform（`ChannelRegistryService.listEnabled()` 渠道清单/可用性/兜底；dl_usage_record 聚合读——**服务端静态构造 aggregate 管道，维度值白名单校验，用户输入只作 $match 值**）。
- 提供：`ChannelPreferenceService.resolve(taskType, userId): { channelCode, modelCode }`——任务创建路由输入（缺省回落默认档→平台兜底；渠道下线容错降级 D3）；消费方 generation/adjustment。

**⑤ @Public**：无。

## 8. platform 域（api-platform.md，P-01/P-02）——6 端点

**① collection**：
- `dl_account`（聚合根=document）：薄标量；无嵌入/引用（自身即主体，无 user_id 隔离字段；会话 token 不落库，内存/缓存会话）；uk_email{unique} 兜底 INV-24；资料/登录时间 updateOne。
- `dl_usage_record`（日志型实体=document，只追加）：标量；引用 user_id/task_id（业务 id）；channel/model 为路由快照；无版本/删除标记；idx_user_time、idx_task。
- 渠道注册（**不建 collection**）：env/config（gw-channel-registry：channel_code/model_code/capability_tags/enabled/priority/密钥引用——密钥不进任何 VO 不进库，INV-26 静态检查），进程内读缓存；适配器=OpenAI 兼容 + Mock（ADR-010 语义）。
- 与 generation 同表共治：dl_generation_task 业务字段归 C-02/C-03，网关侧仅状态推进与计量回填（D1）。

**② 端点清单（6）**：

| # | 方法/路径 | 说明 |
|---|----------|------|
| 1 | POST /auth/account/register | **@Public**；email 格式/password≥8/nickname；INV-24 |
| 2 | POST /auth/account/login | **@Public**；失败 5 次锁 10 分钟；VO：token(30 天滑动)/nickname/syncCursor 初始 |
| 3 | POST /auth/account/logout | 会话 |
| 4 | POST /auth/account/profile | 读/改昵称 |
| 5 | POST /auth/sync/pull | 游标拉取 lastCursor(long 首次 0)；changes[{aggregate: DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/PREFERENCE/EXPORT, op: UPSERT/DELETE, id, cursor, payload}]、newCursor、hasMore；单页≤200 |
| 6 | GET /gw/task/stream | SSE；Query deckId 可选；事件 task-progress{taskId,percent,stageText}/task-finished{taskId,taskStatus}；心跳 15s；**@Public+query token 校验**（见 §0） |

**③ 事件**：`gw_task_advanced`｜taskId/taskStatus｜订阅方：SSE 下发、同步游标分配。`gw_usage_recorded`｜usageId/taskId/tokens｜订阅方：统计聚合（D-01）。另订阅全域事件驱动 SSE（gen_task_finished 等）与多端同步。

**④ 跨域依赖**：
- 消费：generation/adjustment（任务协议：GatewayTaskService#execute 被 C-02/C-03 进程内调用；onTaskCallback 推进 dl_generation_task 终态+计量回填）；SyncChangeScanner 直读八聚合业务 collection（§5.2：find (updated_time,业务id) 升序、$gt [cursor,id] 复合推进分页——06 §3.6）。
- 提供（v1 gateway 包对齐）：
  - `provide AUTH_TOKEN_VERIFIER`（实现 AuthTokenVerifier 接口）——全局 AuthGuard 消费（登录态打通，T06' 集成项）
  - `ChannelRegistryService.listEnabled(): ChannelModel[]`——消费方 channel（Select/INV-22/兜底展示）
  - `GatewayTaskService.execute(task): void`——submitToGateway 调度入队（队列消费→适配器调用→回调业务编排）；INV-25 并发≤3/用户
  - `GatewayTaskCallback.onTaskCallback(taskId, status, result, usage): void`——provider 适配器回调入口（幂等键=taskId+期望前置状态）
  - `SyncChangeScanner.pull(userId, lastCursor): { changes, newCursor, hasMore }`——/auth/sync/pull 实现
- 出站：外部 AI provider HTTP（AiProviderAdapter：generateOutline/generateContent/adjustContent；实现=OpenAI 兼容适配器+Mock）。

**⑤ @Public**：register/login（免鉴权）；/gw/task/stream（@Public+token 校验）。

## 9. 66 端点分域对账表（与 api-index v1.2 口径一致）

| 域 | 文档 | 端点数 | 明细 |
|----|------|--------|------|
| deck | api-deck | 10 | 9 业务/dict + 1 select |
| generation | api-generation | 9 | 8 业务/dict（outline 2+full 1+task 5）… 计：outline/generate、outline/save、full/generate、task/list、task/detail、task/progress、task/cancel、task/retry、dict/batch |
| adjustment | api-adjustment | 4 | whole/submit、targeted/submit、scope/validate、dict/batch |
| version | api-version | 6 | tree、detail、compare、rollback、fork、dict/batch |
| deliver | api-delivery | 7 | submit、list、cancel、download-ticket、**GET download**、present/data、dict/batch |
| asset | api-assets | 20 | 18 业务/dict/select + 2 OHS（file-url、provider-get） |
| channel | api-channel | 4 | preference/detail、preference/save、usage/summary、select/model-options |
| platform | api-platform | 6 | auth 4 + sync/pull + **GET stream** |
| **合计** | | **66** | POST 64 + GET 2（download、stream）✓（v1 契约全量冻结，无删除） |

## 10. 跨域契约方法汇总（进程内直调；签名建议，按契约 §4 编排语义提取）

| 提供方 | 方法（建议签名） | 消费方 | 契约依据 |
|--------|----------------|--------|---------|
| deck.DeckDomainService | `assertCanCreateTask(deckId, userId): void` | generation、adjustment | INV-3（api-deck §2.2/§4.1） |
| deck.DeckDomainService | `assertFinalized(deckId, userId): { finalVersionId }` | deliver（submit/present） | api-delivery §3.2/D2 |
| deck.DeckDomainService | `movePointer(deckId, versionId, branchName?, userId): void` | version（rollback/fork）、generation（成功回调） | INV-1（api-deck §2.2） |
| deck.DeckDomainService | `onFirstVersionCreated(deckId, userId): void` | generation（成功回调） | INV-4 |
| deck.DeckDomainService | `updateDraftOutline(deckId, outline, userId): void` | generation（outline/save） | api-generation §4.3 |
| version.VersionDomainService | `createVersionFromTask(task, content): { versionId, versionSeq }` | generation（成功回调；**版本写入唯一入口**） | api-deck §2.3/api-version §3.2 |
| version.VersionDomainService | `getVersionContent(versionId, userId): ContentSnapshot` | adjustment（基线/scope）、deliver（演示/渲染） | api-adjustment §4.4/api-delivery §4.4 |
| version.VersionDomainService | `countByDeck(deckId, userId): { versionCount, adjustCount }` | deck（detail withStats） | api-deck §4.4 |
| generation.GenerationTaskService | `createTask({ deckId, taskType, instructionSnapshot, userId }): { taskId, taskCode }` | adjustment（whole/targeted submit） | api-adjustment §1.2/§4.3 |
| deliver.ExportService（只读） | `countByDeck(deckId, userId): number` | deck（detail withStats exportCount） | api-deck §4.4 |
| channel.ChannelPreferenceService | `resolve(taskType, userId): { channelCode, modelCode }` | generation、adjustment（任务路由） | api-channel §5.1/api-index |
| asset.AssetDomainService | `adjustRefCounts(assetIds[], delta): void` | version 留档回调/generation 编排（INV-18） | api-assets §2.2/api-index |
| asset.AssetDomainService | `signFileUrls(assetIds[]): { assetId, url, expiresAt }[]` | deliver（渲染）、generation（注入）、演示 | api-assets §5.1 OHS |
| asset.AssetDomainService | `getBrandKit(brandKitId, userId): BrandKit` | generation（品牌注入） | api-assets §5.1 OHS |
| asset.AssetDomainService | `assertTemplatesExist(templateIds[]): void` | adjustment（usedTemplateIds） | api-adjustment §4.5 |
| platform | `provide AUTH_TOKEN_VERIFIER` | common.AuthGuard（全局） | api-platform §3.3/骨架 auth-token-verifier.ts |
| platform.ChannelRegistryService | `listEnabled(): ChannelModel[]` | channel（Select/INV-22/兜底） | api-platform §5.1 |
| platform.GatewayTaskService | `execute(task): void`（=submitToGateway） | generation（gen_task_created 订阅或直调） | api-generation §4.3 |
| platform.GatewayTaskCallback | `onTaskCallback(taskId, status, result, usage): void` | provider 适配器（回调入口） | api-generation §4.3 幂等键=taskId+前置状态 |
| platform.SyncChangeScanner | `pull(userId, lastCursor): { changes, newCursor, hasMore }` | platform 自身 /auth/sync/pull | api-platform §4.4/§5.2 |

依赖序建议（供并行编排）：channel/platform/asset/deck → version → generation/deliver → adjustment。

## 11. Java v1 参考索引（业务规则基准 = v1 源码 + 68 测试用例）

（v1 Java 源码归档已移除；契约以 workspace/02-detailed/api/ 冻结文档为准）
（层优先包 {layer}/{domain}/；v1 域包名与 v3 差异：adjust→adjustment、deliver 同名 deliver、generation 同名；测试：deck-loop-core-test）

| v3 域 | v1 参考路径（包根相对） | 备注 |
|-------|----------------------|------|
| deck | `controller/deck/`、`service/deck/`（+`service/impl/`）、`entity/deck/`、`mapper/deck/`、`ao/deck/`、`vo/deck/`、`mq/deck/` | DeckDomainService 三方法 v1 原型 |
| generation | 同层 `/generation/` | 任务子流程/回调编排/INV-8 |
| adjustment | 同层 `/adjust/` | 无独立表；指令值对象/needForkBranch |
| version | 同层 `/version/` | insert-only/seq 分配/组树/对比 |
| deliver | 同层 `/deliver/` | HMAC 下载凭证/渲染回调 |
| asset | 同层 `/asset/` | 三聚合/uk_user_hash/refCount |
| channel | 同层 `/channel/` + `gateway/ChannelRegistryServiceImpl.java` | 偏好 upsert/用量聚合管道 |
| platform | 同层 `/platform/` + `gateway/`（`GatewayTaskServiceImpl`、`AiProviderAdapter`、`MockAiProviderAdapter`、`ProviderCall*`）+ `mq/platform/` | 会话/调度器/适配器/同步扫描 |
| 共享 | `enums/`（17）、`constant/`（8 错误码类） | v3 已平移至 common/enums 与各域 errors.ts |

DDL 参考（字段/索引平移源）：v1 MySQL 10 表 DDL（历史归档已移除；字段/索引已平移至本文档 collection 建模）。

## 12. 已知缺口（枚举池外，v1 manifest 遗留沿用——补池前不得私建枚举类）

- LengthOption（SHORT/MEDIUM/LONG，api-generation §4.4 lengthOption 入参）未入池——按 AO 字符串参数处理；需字典展示则先补 04 池再在 enums/ 增类。
- compare changeKind（NONE/STRUCTURE/TEXT/IMAGE/NEW/REMOVED）与 usage dimension（CHANNEL/DECK/TASK_TYPE）为过程数据/查询参数，未入池。
- 页面树 blockType（TEXT/IMAGE/PLACEHOLDER，api-version §4.1 content JSON 契约）未入池（值对象内字符串）。
