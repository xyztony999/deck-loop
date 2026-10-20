# deck-loop v3 后端代码生成任务清单（server-node）

> 创建时间：2026-10-09
> 模块：server-node（NestJS 10 + Mongoose 8 单服务，ADR-006/008；pnpm）
> 设计文档：profiles/deck-loop/workspace/02-detailed/api/api-*.md（8 份，见 api-index.md；**v1 契约全量 66 端点冻结，无删除**）
> 栈规约：.claude/skills/node-specs/（20-api-conventions：契约冻结/模块组织/Mongo 建模/查询安全红线/进程内事件/错误码枚举）
> 枚举池：01-solution/common-spec/04-business-enum.md（12 业务）+ 03-common-enums.md（5 公共，SyncChangeOp 活跃）
> 代码输出目录：server-node/src/（八域并行子目录：deck/generation/adjustment/version/deliver/asset/channel/platform）
> 协调输入：server-node/domain-manifest.md（每域：collection/端点/事件/跨域契约/@Public/Java v1 参考）
> 业务规则基准：v1 冻结契约（66 端点 AO/VO/错误码，见 workspace/02-detailed/api/）；v1 Java 源码归档已移除
> 隔离字段：user_id（ADR-005，服务端注入）；collection 前缀 dl_（10 个）；业务主键=雪花串（common/utils/snowflake）
> 运行模式：全量生成（T00 骨架已就绪：Result/BizException/AuthGuard/@Public/@CurrentUser/snowflake，build/test 双绿）

## 共享工件（T01' 已完成）

- [x] T01' · 预建共享工件 + 协调产物（本清单的前置）
  - 17 枚举（`src/common/enums/`，每枚举一文件 + index 出口）：业务 12 + 公共 5，code 值与池逐字一致；统一 `getXxxLabel` + 通用 `getLabelByCode`/`enumToSelectOptions`（dict/batch 端点共用）
  - 八域错误码骨架（`src/{domain}/{domain}.errors.ts`，27 码 = deck3/gen3/adjust3/version3/deliver3/asset5/channel1/platform6）：常量+MSG 成对；platform re-export `AUTH_SESSION_EXPIRED`（common/exceptions 唯一真源）；deliver 复用 deck `DECK_STATUS_FORBIDDEN`（注释标注）
  - 八域占位 `{domain}.module.ts` 接入 app.module.ts（build 验证装配）
  - 协调产物：`server-node/tasks.md`（本文件）+ `server-node/domain-manifest.md`
  - 完成时间：2026-10-09；验证：`npm run build` exit 0、`npm test` 9/9 绿

## 后端代码生成（八域并行；依赖序建议：channel/platform/asset/deck → version → generation/deliver → adjustment）

> 每域四阶段（T1 schema/repository → T2 service+DTO → T3 事件 → T4 controller+测试）；
> 分层与命名按 node-specs 20 §2：`{domain}.controller.ts → {domain}.service.ts → {domain}.repository.ts → schemas/{xxx}.schema.ts`、DTO `{domain}.dto.ts`（AO/VO 平移 + class-validator）。
> 跨域方法签名以 domain-manifest「跨域契约方法汇总」为准（version.createVersionFromTask / deck.movePointer / channel.resolve / platform.submitToGateway·GatewayTaskCallback·SyncChangeScanner / asset.adjustRefCounts 等）。

### deck 域（api-deck.md，10 端点）

- [ ] T1 · DeckSchema + DeckRepository（dl_deck：draft_outline 嵌入；default_brand_kit_id/current_version_id/final_version_id 仅存业务 id；dataVersion 乐观锁 $inc；deleteSign；索引 uk_deck_id/idx_user_status/idx_user_updated；deck_code=DL+yyMMdd+4 序列）
- [ ] T2 · DeckService + DeckDomainService + DTO（状态机动作 save/archive/restore/delete/finalize/unfinalize；assertCanCreateTask/onFirstVersionCreated/movePointer 对外契约；operList 状态驱动；INV-5/6/7）
- [ ] T3 · 事件发布 `deck_deck_status-changed`（事务提交后 EventEmitter2）
- [ ] T4 · DeckController（10 端点含 dict/batch 与 select/deck-list）+ 单测

### generation 域（api-generation.md，9 端点）

- [ ] T1 · GenerationTaskSchema + TaskRepository（dl_generation_task：instruction_snapshot 嵌入；deck_id/base_version_id/result_version_id 引用；channel/model 快照；INV-8 事务互斥；索引 uk_task_id/idx_deck_status/idx_user_created）
- [ ] T2 · GenerationTaskService + DTO（outline/full 发起与 outline/save 跨模块写 Deck.draftOutline；task list/detail/progress/cancel/retry；task_code=GT 序列）
- [ ] T3 · 任务成功回调编排（同事务：version.createVersionFromTask → deck.movePointer → deck.onFirstVersionCreated → asset.adjustRefCounts(+1)）+ 事件 `gen_task_created`/`gen_task_finished`
- [ ] T4 · GenerationController（9 端点）+ 单测（回调幂等：taskId+期望前置状态）

### adjustment 域（api-adjustment.md，4 端点）

- [ ] T1 · 调整指令值对象/DTO 契约（instruction_snapshot 内 adjust 节：instructionText/baseVersionId/targetKind/targetPath/applyBrandKit/brandKitId/usedTemplateIds/baseBranchName；无独立 collection）
- [ ] T2 · AdjustmentService（whole/targeted 提交复用 generation 任务子流程；needForkBranch 分叉提示；INV-9/10；scope/validate）
- [ ] T3 · 事件复用 gen_task_created / gen_task_finished（taskType 携带，无独立事件）
- [ ] T4 · AdjustmentController（4 端点含 dict/batch）+ 单测

### version 域（api-version.md，6 端点）

- [ ] T1 · DeckVersionSchema + VersionRepository（dl_deck_version：content/instruction_snapshot 整体嵌入；**insert-only 无 update 路径**、无 dataVersion/deleteSign；seq=deck 维度事务内 max+1；索引 uk_version_id/uk_deck_branch/idx_deck_parent）
- [ ] T2 · VersionService + VersionDomainService + DTO（tree 内存组树/detail/compare 过程数据/rollback/fork 经 deck.movePointer；createVersionFromTask 对外契约）
- [ ] T3 · 事件 `ver_version_created`（版本留档；事务提交后）
- [ ] T4 · VersionController（6 端点含 dict/batch）+ 单测（不可变守卫、分支唯一）

### deliver 域（api-delivery.md，7 端点）

- [ ] T1 · ExportTaskSchema + ExportTaskRepository（dl_export_task：deck_id/version_id 引用（INV-14 version_id=finalVersionId）；file_key 对象存储；SUCCEEDED⇔file_key（INV-15）；索引 uk_export_id/idx_deck/idx_user_created）
- [ ] T2 · ExportService + DTO（submit/list/cancel/download-ticket/present/data；FINALIZED 守卫复用 deck DECK_STATUS_FORBIDDEN + EXPORT_NOT_FINALIZED；PPTX needConfirm；HMAC 凭证 30min）
- [ ] T3 · 渲染子流程（submitToRenderer/onRenderCallback 幂等）+ 事件 `deliver_export_finished`
- [ ] T4 · DeliverController（7 端点；GET download=@Public+凭证校验，见 manifest）+ 单测

### asset 域（api-assets.md，20 端点）

- [ ] T1 · 三 Schema + 三 Repository（dl_asset：uk_user_hash 查重/ref_count $inc；dl_brand_kit：colors/fonts 嵌入/logo_asset_id 引用/is_default；dl_prompt_template：template_scene/use_count；索引按 §5.3）
- [ ] T2 · AssetService/BrandKitService/PromptService + DTO（上传 INV-19/20、启停、删除 refCount=0、默认切换事务 INV-17、话术占位符 INV-21；OHS：adjustRefCounts/signFileUrls/getBrandKit）
- [ ] T3 · 事件 `asset_{resource}_changed`（resource=asset/brandkit/prompt）
- [ ] T4 · AssetController（20 端点含 3 select、2 OHS、dict/batch、multipart upload）+ 单测

### channel 域（api-channel.md，4 端点）

- [ ] T1 · ChannelPreferenceSchema + PreferenceRepository（dl_channel_preference：preference_map 嵌入；uk_user upsert INV-23）
- [ ] T2 · ChannelPreferenceService + DTO（detail 含可用性标注/save 逐档位 INV-22 校验/usage/summary 聚合白名单管道；**resolve(taskType,userId) 对外契约**）
- [ ] T3 · 事件 `channel_preference_changed`
- [ ] T4 · ChannelController（4 端点含 select/model-options）+ 单测（无 dict 端点：档位键=TaskType）

### platform 域（api-platform.md，6 端点）

- [ ] T1 · AccountSchema/UsageRecordSchema + 仓储（dl_account：uk_email；dl_usage_record：只追加；渠道注册=env/config 读缓存，不建 collection）
- [ ] T2 · Account/Auth/Gateway/Sync 服务 + DTO（register/login 锁定策略/logout/profile；**provide AUTH_TOKEN_VERIFIER**（AuthGuard 消费）；ChannelRegistryService.listEnabled；GatewayTaskService.execute + GatewayTaskCallback 幂等；SyncChangeScanner 八聚合游标扫描）
- [ ] T3 · 事件 `gw_task_advanced`/`gw_usage_recorded` + 订阅各域事件（SSE 下发/同步游标）
- [ ] T4 · PlatformController（6 端点；register/login=@Public、SSE stream=@Public+token 校验，见 manifest）+ 单测

## 全局项（域代码完成后）

- [ ] T06' · 全局集成与端到端验证
  - AuthGuard ↔ platform verifier 装配打通（登录→受保护端点→会话过期链路）
  - SSE /gw/task/stream（text/event-stream、心跳 15s、task-progress/task-finished）
  - GET /deliver/export/download 文件流 + Content-Disposition（DL-{deck_code}-v{seq}.{ext}）
  - 渠道注册 env/config 示例（OpenAI 兼容 + Mock）；多文档事务（replica set / mongodb-memory-server）
  - 全链路冒烟：注册→建 deck→大纲→整稿→调整→定稿→导出→下载→sync/pull
- [ ] T07' · 编码规则合规检查（必须）
  - node-specs 20 全项：契约冻结（66 端点逐条对账 domain-manifest）、白名单映射/禁 $where/$eval、隔离字段服务端注入、事务提交后发事件、_id 不进 VO、枚举/错误码无跨模块重复定义
  - `npm run build` exit 0 + `npm test` 全绿；更新本清单与 domain-manifest 的偏差记录
