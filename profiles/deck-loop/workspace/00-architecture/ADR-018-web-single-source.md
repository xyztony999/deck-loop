# ADR-018 · 云端 PG 单源 + Web 管理站 + MCP 远程模式（AI 网关彻底移除）

- 状态：Accepted（2026-11-25，D0 用户裁决四项分叉；D1 设计裁决见 §4）
- 增量 id：web-mgmt-20261125（模块 deck-loop-full）
- 关联：ADR-005（单用户 user_id 隔离）、ADR-008（语言指令驱动）、ADR-013（多端同步）、ADR-014（UI 设计铁律）、ADR-015（服务端零渲染）、ADR-016（PostgreSQL）、ADR-017（本地优先 MCP，本 ADR 部分反转其「本地优先」口径）
- 输入：05-reports/D0-web-management-2026-11-25.md

## 1. 背景

ADR-017 确立了「coding agent 出推理、deck-loop 出确定性状态机」的形态，但数据落本地
SQLite、云端 PG 与本地库彼此独立。用户裁决：客户端的管理类功能（素材、产出内容）
上网站管理；AI 产出完全交 coding agent（MCP），不再需要平台侧 AI 网关。由此产生
三个架构问题：①网站与 agent 读写哪份数据；②MCP 如何访问云端；③网关移除的边界。

## 2. 决策（D0 四项裁决，不可再议）

1. **云端 PG 单源 + MCP 远程模式**：server-node/PostgreSQL 为唯一权威数据源，网站与
   远程 agent 实时读写同一份数据。MCP 增远程模式（HTTP 客户端 + 个人 API token 鉴权
   + 服务端 agent 直写端点）；本地 SQLite 保留为**离线可选模式**。ADR-017「本地优先」
   部分反转为「云端单源、本地离线可选」（用户明示演进，非方向背叛——ADR-008 定位不变）。
2. **AI 网关彻底移除**：platform/gateway、channel、generation、adjustment 模块与端点
   删除；AI 产出唯一路径 = agent 经 MCP 直写。`dl_generation_task` 表保留作历史审计。
   契约破坏性变更（冻结解除）以本 ADR 为据。
3. **Web 四功能组**：素材管理（含品牌规范/话术）、Deck 管理、版本树操作（浏览/对比/
   回退/分叉）、浏览器侧预览放映 + 已导出产物下载。**新导出仍由 MCP 触发**——服务端
   零渲染红线（ADR-015）不变，网站无渲染器、不发起导出。
4. **前端 git 历史恢复**：commit 779f3d6 的被删 `client/`（Vue3 + AntdV4 + DlListPage
   引擎 + 暗色主题）恢复至 `web/`，剥 Tauri 改纯 Web；ADR-014 设计铁律与 07 设计语言
   v2.0 沿用（领导已评审，不复议）。

## 3. 架构口径

```
┌─ 用户桌面 ─────────────────────────────┐      ┌─ 云端（1.6G VPS）──────────────┐
│ coding agent（ZCode 等，coding plan）  │      │ Nginx ─┬─ / → web/ 静态站      │
│   └─ MCP server（mcp-server/）         │ HTTP │        └─ /api → deck-loop-core│
│       ├─ remote 模式：HTTP + API token ├──────▶│            ├─ 会话鉴权（网站） │
│       │   28 tools 语义不变            │      │            ├─ API token 守卫   │
│       ├─ local 模式：SQLite 离线可选   │      │            │  （MCP，独立）    │
│       └─ headless 导出（本地 Edge，    │      │            └─ PostgreSQL 单源  │
│           两模式均在本地渲染）         │      │               （deck_loop 库） │
│ 浏览器：web/ 管理站（Vue3+AntdV）      │      └────────────────────────────────┘
│   预览放映 = 浏览器侧 render-template  │
└────────────────────────────────────────┘
```

- **网站**：会话体系（register/login + X-Auth-Token）直读直写 PG，**不经同步模块**。
- **MCP 远程模式**：个人 API token（X-Api-Token）调既有端点 + agent 直写端点；
  导出渲染仍在 MCP 本地进程（headless Edge），产物经 `/deliver/export/upload` 回传落账。
- **MCP 本地模式**：ADR-017 原样保留（SQLite、固定属主 local、零鉴权）；与云端的
  版本对账经 agent-create 端点 + ADR-013 游标拉取（见 §4.1）。
- **服务端零渲染**（ADR-015）与 **1.6G 内存红线**（ADR-016）不变：网关移除后服务端
  净减 provider 适配器/任务调度/SSE _hub_，内存只降不升；web 静态站由 Nginx 直出，
  不占 Node 进程内存。

## 4. D1 设计裁决（本 ADR 新增决策）

### 4.1 同步模块（ADR-013）去留 —— 保留，服务对象收窄为 MCP 本地离线模式

| 消费方 | 是否经同步 | 理由 |
|--------|-----------|------|
| Web 管理站 | 否 | 直读直写 PG 单源，无本地副本 |
| MCP 远程模式 | 否 | HTTP 实时读写 PG，无本地副本 |
| MCP 本地模式（离线可选） | **是** | SQLite 副本需与云端对账 |

- `POST /auth/sync/pull` + SyncChangeScanner **保留**（契约冻结不变，含 F07 复合游标
  lastPosition/newPosition）；登录 VO syncCursor 字段保留。
- 扫描聚合调整：**PREFERENCE 移除**（dl_channel_preference 表删除，见 §4.4）；
  **TASK 保留为历史只读扫描**（dl_generation_task 不再有新写入，历史行仍可拉取）；
  DECK/VERSION/ASSET/BRANDKIT/PROMPT/EXPORT 六聚合活跃不变。SyncChangeOp 枚举保留。
- 本地→云端方向：版本对账经 `POST /ver/version/agent-create`（§4.5，deck 须已存在
  于云端）；**deck/asset 主数据的本地→云端推送本期不做**（离线模式已知限制：本地
  新建的 deck/素材不自动上云，须在线经网站或远程 MCP 创建后再离线迭代）。完整双向
  同步留待后续增量（ADR-017 Phase 4 余量）。

### 4.2 MCP 远程/本地模式切换机制

- 环境变量驱动（缺省 local，向后兼容 ADR-017）：
  - `DECK_LOOP_MODE=local|remote`（缺省 local）
  - `DECK_LOOP_API_URL`（remote 必填，如 `https://host/api`）
  - `DECK_LOOP_API_TOKEN`（remote 必填，个人 API token，§4.3）
- 装配缝 = `ToolContext`：local 持 `LocalCore`（进程内域服务直调，现状）；remote 持
  `RemoteClient`（HTTP 客户端，逐 tool 映射到既有端点，见 api-web-agent §5）。
  **28 tools 名称/入参 schema/语义/回执结构两模式完全一致**，agent 侧无感知。
- 导出/预览两模式均本地执行：remote 的 export_deck = HTTP submit → 本地 headless
  渲染 → HTTP upload 回传；preview_deck = HTTP 取版本 content + 素材签名 URL →
  本地生成 HTML。渲染依赖（playwright-core/系统 Edge/pptxgenjs）不上服务端。
- remote 模式错误透传：服务端 `Result{status,code,msg}` 的 BIZ_* 码与文案原样转
  MCP 错误回执（不翻译、不吞码）；网络层失败归一 `DECK_LOOP_REMOTE_UNREACHABLE`
  提示（含 URL 与状态码，不含 token）。

### 4.3 个人 API token 体系（新）

- **新聚合根 ApiToken**（账号域 P-02，通用薄建模）→ 新表 `dl_api_token`（第 10 张
  物理表：11−2+1，W1 计数修正）。字段：token_id(PK 雪花)、user_id、token_name(≤50)、token_prefix(展示用
  前 12 字符)、token_hash(SHA-256 全 token，唯一索引)、expires_at(可空=永久)、
  last_used_at、revoked_at(可空)、审计六件套（无 delete_sign 需求，保留统一模板）。
- **token 格式**：`dlpat_` + 32 字节随机数 base64url（43 字符）。**明文仅签发回执
  出现一次**；库内只存 SHA-256 哈希（uk_token_hash O(1) 查找 + 恒时比较），沿用
  INV-26「密钥不可回显」红线精神。
- **签发/吊销/列表**（会话守卫，网站设置页消费）：
  - `POST /auth/token/issue`：AO {tokenName✅, expiresDays(1~365 缺省 90),
    permanent(bool 缺省 false，true=永久)}；VO {tokenId, tokenName, token(明文仅此
    一次), tokenPrefix, expiresAt}。
  - `POST /auth/token/revoke`：AO {tokenId}；置 revoked_at（幂等）；即时生效。
  - `POST /auth/token/list`：分页；VO 行 {tokenId, tokenName, tokenPrefix,
    createdTime, expiresAt, lastUsedAt, status(ACTIVE/EXPIRED/REVOKED 派生)}。
- **独立守卫**：新 `ApiTokenGuard` + `ApiTokenService`（platform 域），与
  SessionTokenService 完全独立（独立表/哈希/过期/吊销逻辑）。全局 AuthGuard 增
  **双凭证回落**：有 X-Auth-Token → 会话校验（现状不变）；无会话头但有 X-Api-Token
  → 委托 ApiTokenService.verify（哈希查找 + 过期/吊销校验 + last_used_at 节流更新
  ≤1 次/分钟），通过则挂 request.user={userId: token.user_id, accountId, via:'api-token'}。
  属主隔离（ADR-005）口径不变——userId 注入后所有查询/写入强制携带。
- **agent 直写端点仅认个人 token**：`/ver/version/agent-create` 标 @Public() 旁路
  全局会话守卫 + @UseGuards(ApiTokenGuard) 独立校验 X-Api-Token（缺头/无效 →
  BIZ_AUTH_TOKEN_INVALID）；网站会话不可调用（网站无内容写入口，§4.6）。
- 权限口径：个人 token 等价该账号全量属主操作（单用户产品无 RBAC，ADR-005）；
  不做 scope 细分（本期）；token 泄露处置 = 网站吊销。
- 新错误码：`BIZ_AUTH_TOKEN_INVALID`（缺头/哈希不匹配/已过期/已吊销统一码，防枚举）。

### 4.4 网关移除影响面（模块/端点/表/枚举/事件/错误码）

**模块**（编码退役不复用，D1 编码规则）：

| 模块 | 编码 | 处置 |
|------|------|------|
| 初稿生成 | C-02 | 删除（generation 域整体；outline/save 迁 deck 域） |
| 语言调整 | C-03 | 删除（adjustment 域整体；定向不变性校验迁 agent-create） |
| AI 渠道与偏好 | D-01 | 删除（channel 域整体，含 2026-10-23 渠道管理端 6 端点） |
| AI 生成网关 | P-01 | 删除（platform/gateway 包 + gateway-stream controller） |
| 账号与设备同步 | P-02 | 保留（auth 4 + sync/pull）+ 新增个人 API token 子模块 |

**端点**（基线 75 = 66 冻结 + ADR-015 upload/fail 2 + 渠道管理端 6 + files GET 1）：
移除 23、迁移 1、新增 4 → **56 端点**（POST 54 + GET 2）。逐条清单见 api-web-agent §4。

**表**：

| 表 | 处置 | 理由 |
|----|------|------|
| dl_generation_task | **保留**（历史审计，只读；不再有新写入） | D0 明示；deck detail withStats/withLatestTask 历史读保留 |
| dl_usage_record | **保留**（历史审计，只读） | 日志型只追加，与 task 同理；usage 端点删除但历史可追溯 |
| dl_channel | **删除**（迁移脚本 drop） | 配置数据无审计价值；task/usage 行内 channel_code/model_code 为快照字符串，无解引用依赖 |
| dl_channel_preference | **删除**（迁移脚本 drop） | 同上；同步扫描 PREFERENCE 聚合同步移除 |
| dl_api_token | **新增**（第 10 张物理表：11−2+1） | §4.3 |
| 其余 7 表 | 不变 | deck/deck_version/export_task/asset/brand_kit/prompt_template/account（dl_deck_log 设计层未落地，不计物理表——W1 修正） |

**枚举**（04 池值域冻结不动，仅使用面注记）：TaskType/TaskStatus/TargetKind 保留
（历史行 + VersionSourceType 共享值域）；SyncChangeOp 保留（本地同步）；
AccountStatus 保留；无枚举删除。

**事件**：gen_task_created / gen_task_finished / gw_task_advanced / gw_usage_recorded /
channel_preference_changed **退役**（无发布方）；ver_version_created /
deck_deck_status-changed / asset_{resource}_changed / deliver_export_finished 保留。

**错误码**：BIZ_TASK_* / BIZ_GW_* / BIZ_CHANNEL_* / BIZ_ADJUST_* 随模块退役；
outline-save 迁 deck 域后校验失败改 `BIZ_DECK_OUTLINE_INVALID`（新）；agent-create
定向越界改 `BIZ_VERSION_TARGET_INVARIANCE`（新，BIZ 错误而非集成缺陷——agent 产物
是不可信输入）；新增 BIZ_AUTH_TOKEN_INVALID。

**不变量**：INV-1/2/4/5/6/7/11/12/13/14/15/16/17/18/19/20/21/24 保留；
INV-22/23（渠道可用性/偏好唯一）随渠道域退役；INV-3（FINALIZED/ARCHIVED 禁内容
写入）与 INV-9（scope 存在性）迁 agent-create 守卫；INV-8（任务互斥）/INV-10
（占位符）/INV-25（并发≤3）/INV-26（密钥不出网关）随模块退役——INV-26 精神由
token 哈希存储延续。INV-11 版本不可变、单事务归档、引用计数 INV-18 **全部保留**
（硬约束）。

### 4.5 agent 直写端点（唯一内容写入口红线）

`POST /ver/version/agent-create`（ver 域，个人 token 独立守卫）：

- 复用 `VersionArchiveService.createVersionFromTask(VersionArchiveCommand)` ——
  **唯一写入口，禁绕过**（与 ADR-017 本地 version_create 同一服务同一事务：
  seq FOR UPDATE 分配 → insert-only → movePointer → adjustRefCounts，单事务）。
- taskId 合成 `agent-<snowflake>`（不建 dl_generation_task 行，与本地模式同口径；
  树 taskStatusOfSource 自然回落 null）。
- sourceType 自动判定：scope 存在→TARGETED_ADJUST；有基线→FULL_ADJUST；首版→
  FULL_GENERATE。首版成功 → onFirstVersionCreated（DRAFT→ITERATING，幂等）。
- 定向调整：基线 content 固化进 instruction_snapshot + scope 存在性校验（INV-9）+
  assertTargetedInvariance（非目标页/块 canonical 不变，越界 →
  BIZ_VERSION_TARGET_INVARIANCE，不产版本）。
- 状态守卫：Deck 须 DRAFT/ITERATING（FINALIZED/ARCHIVED → BIZ_DECK_STATUS_FORBIDDEN，
  INV-3 延续）；属主校验（token.userId）。
- 载荷红线（1.6G 内存）：content JSON ≤ 2MB（env AGENT_CONTENT_MAX_MB 缺省 2）、
  pages 1~200、instruction ≤ 2000 字。
- 契约详情见 api-web-agent §3.1。

### 4.6 Web 形态与渲染

- `web/` = 779f3d6 `client/` 恢复剥 Tauri：删 src-tauri/、@tauri-apps/* 依赖、
  原生命令（export_renderer.rs 等）与隐藏渲染窗路由 /export-render；API 基址改
  同源 `/api`（Nginx 反代）或 env 注入；会话 token 存 localStorage（现状沿用）。
- **移除页面**：生成向导（/gen、/deck/:deckId/generate）、迭代工作台（/adjust、
  /deck/:deckId/iterate）、任务面板、渠道/用量设置 Tab。
- **保留/改造**：/deck 列表·新建·详情（详情内嵌版本树 + 预览画布 + DRAFT 大纲编辑 +
  「交 agent 调整」上下文复制引导，替代迭代工作台）；/deck/:deckId/compare 对比；
  /deck/:deckId/present 放映（浏览器侧渲染）；/assets 三 Tab；/deliver 导出记录
  （**仅下载，无发起入口**）；/settings（账户/API token/外观）。
- **浏览器侧渲染**：`render-template.ts`（parseSlides/slidesHtml/renderDocument/
  previewDocument，纯 TS 零 node 依赖）为单一源（现居 mcp-server/src/render/），
  web 经 TS 路径别名直接消费同一文件（零复制零分叉）；预览/放映 = version/detail
  取 content + asset/file-url 签名 URL 取图 → 浏览器渲染。文档表面永远白纸
  （07 §1），chrome 暗色三层（ADR-014）。
- **网站无内容写入口**（ADR-008 延续）：版本内容只能经 agent 直写；网站版本操作
  仅指针类（回退/分叉）与大纲保存（DRAFT 中间产物，非版本内容）。
- 刷新策略：工作台版本树轻轮询 10s（页面隐藏暂停）+ 手动刷新；**不新建 SSE**
  （gw/task/stream 已删，服务端保持薄）。

## 5. 影响

- AGPL-3.0-only 不变；web/ 同许可证。
- 契约破坏性变更：66 端点冻结声明解除（06 规约 §1 修订，v1.3）；受影响旧客户端
  即被删 Tauri client（已不存在）与本地 MCP（local 模式不经 HTTP，零影响）。
- profile：vue3-engine 栈重新激活（web/ 消费 DlListPage 引擎）；FRONTEND_ROOT 改 web/。
- 部署：Nginx 增 web 静态站 + /api 反代；Node 进程净减网关包；PG 增 dl_api_token、
  减 dl_channel/dl_channel_preference（迁移脚本，synchronize=false 红线不变）。
- ADR-017 修订注记：「本地优先」→「云端单源、本地离线可选」；「网关保留 BYO-key」
  →「网关彻底移除」；Phase 4 预留的 agent-create 端点本期落地。

## 6. 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | D1 初版：D0 四项裁决入档 + D1 六项设计裁决（同步去留/MCP 切换/token 体系/移除影响面/agent 直写/Web 形态） |