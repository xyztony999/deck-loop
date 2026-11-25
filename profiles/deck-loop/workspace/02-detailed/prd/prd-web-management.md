# PRD — Web 管理站 + MCP 远程 + 网关移除（deck-loop-full 增量）

| 属性 | 值 |
|------|-----|
| 模块 | deck-loop-full（增量 web-mgmt-20261125；跨 C-01/C-04/C-06/S-01/S-02/S-03/P-02） |
| 功能类型 | 混合：业务流程类（Deck 状态机/版本归档）+ 主数据类（素材/品牌/话术）+ 平台能力（API token） |
| 版本 | v1.0 |
| 日期 | 2026-11-25 |
| 输入 | D0-web-management-2026-11-25（四项用户裁决）/ ADR-018 v1.0 / BA v1.1 / AA v1.4 / FL v1.3 |

## 1. 业务目标（G1）

让创作者在浏览器里管理创作资产与产出内容（素材、Deck、版本树、预览与导出产物），
AI 产出完全交给创作者自有的 coding agent（经 MCP 远程直写云端 PG）；平台不再运营
AI 网关。价值对象：创作者（网站会话）与其 coding agent（个人 API token）。
核心约束：云端 PG 单源、服务端零渲染（ADR-015）、版本不可变与单事务归档（INV-11/18）、
语言指令驱动（ADR-008，网站无内容编辑入口）。

## 2. 功能范围（G2）

**做**：
- **素材管理**（含品牌规范/话术）：素材上传/分类/检索/重命名/停用/恢复/删除（引用保护）；品牌规范多套维护/设默认/删除守卫；话术模板管理/删除。
- **Deck 管理**：列表检索/新建/信息编辑/详情（统计）/归档/恢复/软删除/定稿/解锁；DRAFT 态大纲编辑（outline-save 迁 deck 域）。
- **版本树操作**：谱系树浏览（分支/来源指令/当前/定稿标记）、任意版本预览、双版本对比、回退（移指针）、分叉（命名分支）。
- **预览放映 + 导出产物下载**：浏览器侧 render-template 渲染任意版本预览与定稿全屏放映（翻页/备注）；导出记录列表 + 限时凭证下载已导出产物。
- **个人 API token**：签发（明文仅一次）/吊销/列表（网站设置页）；MCP 远程模式全量 tools 经 token 鉴权。
- **agent 直写**：POST /ver/version/agent-create（MCP 远程 version_create 落点；本地模式同服务直写 SQLite）。
- **网关移除**：generation/adjustment/channel/gateway 模块与 23 端点删除；历史任务/用量表留存审计。

**不做**：
- 网站发起导出（新导出仅 MCP export_deck，本地 headless 渲染后回传）；网站任何渲染器。
- 网站内容编辑/指令输入面板（生成/调整在 agent 会话内完成；ADR-008）。
- 渠道/模型/用量管理（随网关移除）；任务面板/SSE 进度通道。
- deck/asset 主数据本地→云端推送（离线模式已知限制，ADR-018 §4.1）；token scope 细分/RBAC。
- 多用户协作/分享（单用户产品，ADR-005）。

## 3. 角色（G3）

| 角色 | 鉴权 | 职责 |
|------|------|------|
| 创作者（网站） | 会话体系 register/login + X-Auth-Token（30 天滑动，现状不变） | 四功能组全部管理操作 + token 签发/吊销 |
| 创作者的 coding agent（MCP 远程） | 个人 API token（X-Api-Token，独立 ApiTokenGuard） | 28 tools 语义不变：deck/outline/version/asset/brandkit/prompt/export/preview；内容唯一写入口 version_create→agent-create |
| 创作者（MCP 本地离线） | 无（固定属主 local，SQLite） | ADR-017 原样；与云端版本对账经 agent-create + sync/pull |

无审批角色（个人产品自确认语义）。

## 4. 领域对象与关系（G4/G5）

沿用 domain-model.md v1.3（本增量注记版）：
- 核心域聚合根 **Deck / DeckVersion** 不变（1:N，指针 INV-1/2，版本不可变 INV-11）。
- 支撑域 **Asset / BrandKit / PromptTemplate** 不变（引用计数 INV-18、停用不删 ADR-004）。
- **GenerationTask / UsageRecord** 转历史只读审计（不再有新写入）；**ChannelPreference / ChannelModel** 移除（表删除）。
- **新增聚合根 ApiToken**（账号域 P-02，通用薄建模）：1 Account → N ApiToken；独立生命周期（签发→活跃→过期/吊销），dl_api_token 表。
- 子流程 **ExportTask** 不变（QUEUED→SUCCEEDED/FAILED/CANCELLED；触发方=MCP）。
- 过程数据：token 明文（签发回执一次性）、远程错误透传载荷、版本对比差异（P7）、放映翻页态（P3）。

## 5. 业务字段（T1）

**ApiToken（新）**：

| 字段 | 说明 | 约束 |
|------|------|------|
| tokenName | 用途名（如「ZCode 桌面」） | 必填 ≤50 |
| token | 凭证明文 `dlpat_`+43 字符 base64url | 仅签发 VO 返回一次；库内 SHA-256 哈希 |
| tokenPrefix | 展示前缀（前 12 字符） | 列表回显用 |
| expiresDays / permanent | 有效期 1~365 天（缺省 90）；permanent=true 永久 | 签发入参 |
| expiresAt | 过期时刻（永久=null） | 派生 |
| lastUsedAt | 最近使用（节流 ≤1 次/分钟更新） | 派生 |
| status | ACTIVE/EXPIRED/REVOKED | 派生展示（revoked_at/expires_at 计算，不落状态列） |

**agent 直写入参（version_create 工具 schema 平移）**：deckId✅、content✅（pages[]→blocks[]，blockType TEXT/IMAGE/PLACEHOLDER；≤2MB、pages 1~200）、instruction✅（≤2000）、parentVersionId?（缺省=当前指针）、branchName?（≤50，缺省=活动分支）、scope?（{pageId, blockId?}，提供即定向）。

**大纲保存（迁 deck 域）**：deckId✅、outline✅（节点 1~50、title≤50，DRAFT 态守卫）——AO/VO 与原 /gen/outline/save 一致。

其余对象字段沿用各 PRD（prd-deck/assets/version/delivery v1.x），零变更。

## 6. 被引用关系（T1a）

- ApiToken 被 MCP 远程全量端点消费（AuthGuard 双凭证回落）；agent-create 仅认 token。
- Deck/DeckVersion/Asset/BrandKit/PromptTemplate/ExportTask 被网站四功能组与 MCP 28 tools 共同消费（同一 PG 单源）。
- dl_generation_task 历史行被 deck detail withStats/withLatestTask 只读消费。

## 7. 状态流转（T2）

- **Deck 状态机不变**（domain-model §4.1）：DRAFT→ITERATING 由 agent 首版直写触发（onFirstVersionCreated 幂等）；定稿/解锁/归档/恢复守卫不变（「无进行中任务」守卫随任务表停写自然恒真，保留校验逻辑兼容历史行）。
- **ApiToken 生命周期**：签发→ACTIVE；expires_at 到期→EXPIRED（派生）；revoke→REVOKED（即时生效，幂等）。无状态列、无审批。
- **ExportTask 状态机不变**（ADR-015 口径）；触发方由 Tauri 客户端改为 MCP（远程经 HTTP submit/upload/fail）。
- GenerationTask 状态机转历史（不再有状态推进）。

## 8. 业务规则

**四功能组**：
1. 素材：上传 INV-19（jpg/png/svg/webp ≤10MB）/INV-20 hash 查重；被引用（refCount>0）仅停用不可删（INV-18/ADR-004）；品牌规范默认唯一（INV-17 事务切换）、logo 启用态（INV-16）、被 deck 引用/默认不可删；话术占位符 INV-21。
2. Deck：编辑仅 DRAFT/ITERATING；删除仅 ARCHIVED 软删；定稿须 currentVersionId 非空；大纲仅 DRAFT 可编辑（首版后只读）。
3. 版本树：回退须 ITERATING（FINALIZED 先解锁）；分叉 branchName 同 deck 唯一（INV-12）；对比同版本拒绝；**网站无版本内容写入口**（回退/分叉仅移指针，历史不动 ADR-009）。
4. 预览放映：任意版本可预览（version/detail + 素材签名 URL）；全屏放映不要求定稿（浏览器侧渲染，文档表面永远白纸 07 §1）；导出下载须 SUCCEEDED + HMAC 凭证 30min（现状不变）。

**agent 直写**：
5. 唯一写入口 VersionArchiveService（单事务：seq FOR UPDATE→insert-only→movePointer→adjustRefCounts），禁绕过。
6. Deck 须 DRAFT/ITERATING（INV-3 延续）；定向调整强制 scope 存在性（INV-9）+ 非目标不变性（越界 BIZ_VERSION_TARGET_INVARIANCE，不产版本）；基线 content 固化进 instruction_snapshot。
7. taskId 合成 agent-<snowflake>，不建任务行；sourceType 自动判定（首版 FULL_GENERATE/有基线 FULL_ADJUST/带 scope TARGETED_ADJUST）。

**token**：
8. 明文仅签发回执一次；哈希存储恒时比较；吊销即时生效；token 等价账号全量属主权限（无 scope）；泄露处置=网站吊销。
9. 网站会话与 token 双凭证互不干扰：会话优先（X-Auth-Token），无会话头时回落 X-Api-Token；agent-create 仅 token。

**网关移除**：
10. 23 端点删除 + outline/save 迁移（路径变更契约不变）；历史任务/用量只读留存；渠道两表删除（迁移脚本）；枚举池值域不动。
11. 网站鉴权沿用会话体系（register/login 不变）；同步模块仅服务 MCP 本地离线（扫描去 PREFERENCE、TASK 历史只读）。

## 9. 非功能与异常（N1/N2）

- **资源红线**：1.6G 服务器（ADR-016）——服务端零渲染依赖（ADR-015），网关移除后内存只降不升；web 静态站 Nginx 直出不占 Node 内存；agent content ≤2MB（env AGENT_CONTENT_MAX_MB）；产物上传 ≤50MB（现状）。
- **性能**：个人量级（deck 数百/版本数千）；列表分页默认 20；工作台版本树轻轮询 10s（页面隐藏暂停）+ 手动刷新，不建 SSE。
- **异常**：BIZ_* 错误码经 Result 信封透传（MCP 远程不翻译不吞码）；token 无效统一 BIZ_AUTH_TOKEN_INVALID（防枚举）；网络失败 DECK_LOOP_REMOTE_UNREACHABLE 提示（不含 token）；会话过期全局拦截回登录页（现状）。
- **离线**：网站离线不可用（单源直读，无本地缓存副本——与旧客户端离线缓存口径不同，明示）；MCP 本地模式离线可用（SQLite），版本对账在线经 agent-create。
- **安全**：NR 查询白名单/属主隔离/错误码规约沿用（06 §4 + api-persistence-migration NR-02/03/05/08）；token 不进日志；素材文件 HMAC 签名 URL + SVG CSP（现状）。

## 10. 历史与审计（N4）

- Deck 状态流转/定稿/解锁/归档操作日志（dl_deck_log）不变。
- 版本留档审计：instruction_snapshot 含指令与基线（agent 直写同口径）。
- dl_generation_task / dl_usage_record 历史行只读留存（网关时代审计追溯）。
- ApiToken：签发/吊销时间审计六件套；last_used_at 使用追溯；吊销不物理删除。

## 11. 四功能组功能点明细（FL v1.3 追溯）

| 功能组 | 功能点 | 消费端点（契约见 api-web-agent / 既有 api-*） |
|--------|--------|----------------------------------------------|
| 素材管理 | 素材列表/上传/编辑/停用/恢复/删除 | asset/asset/*（6）+ select/asset-list + dict |
| | 品牌规范列表/保存/删除/设默认 | asset/brandkit/*（4）+ select/brandkit-list |
| | 话术列表/保存/删除 | asset/prompt/*（3）+ select/prompt-list |
| Deck 管理 | 列表/新建/编辑/详情/归档/恢复/删除/定稿/解锁 | deck/deck/*（9）+ select/deck-list + dict |
| | 大纲编辑（DRAFT） | deck/deck/outline-save（迁移） |
| 版本树操作 | 树浏览/版本预览/对比/回退/分叉 | ver/version/tree·detail·compare·rollback·fork + dict |
| 预览放映+导出下载 | 任意版本预览/定稿全屏放映 | ver/version/detail + asset/asset/file-url（浏览器侧渲染） |
| | 导出记录/产物下载 | deliver/export/list·download-ticket + GET download |
| 平台入口 | 登录/注册/退出/资料 | auth/account/*（4） |
| | API token 签发/吊销/列表 | auth/token/issue·revoke·list（新） |
| agent 侧（非菜单） | 内容直写 | ver/version/agent-create（新，仅 token） |

## 附录A：PRD 完备性检查（D2-1，本增量自检）

功能类型：混合（业务流程+主数据+平台）。

| 层 | 检查项 | 结果 | 证据 |
|----|--------|------|------|
| G1 | 业务目标 | ✅ | §1 |
| G2 | 功能范围 | ✅ | §2 做/不做 |
| G3 | 角色定义 | ✅ | §3 三角色+鉴权 |
| G4 | 领域对象 | ✅ | §4（含新 ApiToken） |
| G5 | 对象关系 | ✅ | §4 + domain-model v1.3 |
| T1 | 业务字段 | ✅ | §5（新对象字段；沿用对象零变更声明） |
| T1a | 被引用关系 | ✅ | §6 |
| T2 | 状态流转 | ✅ | §7（Deck/Token/Export） |
| T3 | 审批规则 | ⬚ 不适用 | 个人产品无审批（自确认） |
| T4 | 查询筛选 | ✅ | §11 + 既有 api-* ListAO 沿用 |
| T6/T7/T8 | 对接/映射/幂等 | ✅ | MCP 远程=既有端点映射（api-web-agent §5）；upload/fail 幂等键=exportId+前置状态（沿用）；agent-create 无幂等键（每次新版本，语义同 version_create） |
| N1 | 非功能 | ✅ | §9 |
| N2 | 异常 | ✅ | §9 |
| N3 | 规则细节 | ✅ | §8（11 条） |
| N4 | 历史审计 | ✅ | §10 |

**结论：通过**（16/16 适用项），可进入 D3。本次变更影响范围：新增 ApiToken 聚合+4 端点、移除 23 端点、迁移 1 端点、GenerationTask/UsageRecord 转历史、ChannelPreference/ChannelModel 移除。

## 12. 更新记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（D0 四项裁决 + ADR-018 D1 六裁决输入；四功能组 + 网关移除影响 + 非功能；完备性自检通过） |