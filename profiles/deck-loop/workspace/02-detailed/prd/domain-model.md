# Deck-Loop 领域模型（DDD）

| 属性 | 值 |
|------|-----|
| 模块 | deck-loop 全量 |
| 版本 | v1.3 |
| 日期 | 2026-11-25 |
| 输入 | D0 澄清报告 v1.0 / BA·AA·FL v1.0；v1.3 增量：D0-web-management-2026-11-25 / ADR-018 / prd-web-management v1.0 |

> **增量注记（ADR-018，2026-11-25，web-mgmt-20261125）**：本版本为增量注记，不重写
> 历史正文。变更四点：① **新增聚合根 ApiToken**（账号域，通用薄建模，dl_api_token
> 第 10 张物理表：11−2+1，W1 计数修正）——MCP 远程鉴权凭证，独立生命周期（签发/过期/吊销）；② **AI 网关域
> 与渠道偏好域退役**：GenerationTask/UsageRecord 转历史只读审计（dl_generation_task/
> dl_usage_record 保留，不再有新写入），ChannelPreference/ChannelModel 移除
> （dl_channel/dl_channel_preference 表删除）；③ **生成/调整子流程 I/O 由 agent 直写
> 承接**（§5 注记）：VersionArchiveService 唯一写入口不变，taskId 合成 agent-<snowflake>
> 不建任务行；④ 核心域 Deck/DeckVersion 与支撑域 Asset/BrandKit/PromptTemplate
> **聚合根/字段/不变量零变更**（INV-11 不可变、单事务归档、INV-18 引用计数保留）。
> 存储口径：PostgreSQL（ADR-016，§1 原 Mongo 注记已被 ADR-016 修订）。

## Step 0：范围判定

战略设计（业务域识别/分层/关系映射）已在 D1 应用架构完成（DDD 四层归类，经用户确认）。本文档按模块执行战术设计，对象级判定（非字段级）。

## 1. 业务域清单与分层

| 上下文 | 领域分层 | 聚合根 | 核心职责 | 关联上下文 |
|--------|---------|--------|---------|-----------|
| 创作迭代域（核心） | 核心域 | 创作物 Deck、内容版本 DeckVersion | 生成-调整-版本闭环（v1.3：生成/调整由外部 coding agent 经 MCP 直写承接） | 素材品牌域、话术域、账号域（~~渠道偏好域、AI 网关域~~ 退役 v1.3） |
| 素材品牌域 | 支撑域 | 素材 Asset、品牌规范 BrandKit | 一致性资产供给 | 创作迭代域（被引用） |
| 话术域 | 支撑域 | 话术模板 PromptTemplate | 调整话术沉淀复用 | 创作迭代域（被引用） |
| ~~渠道偏好域~~（退役 v1.3） | 基础数据域 | ~~渠道偏好 ChannelPreference~~ | ~~用户级生成资源配置~~（ADR-018 移除） | — |
| ~~AI 网关域~~（退役 v1.3） | 通用域（平台） | ~~生成任务 GenerationTask~~（转历史只读审计） | ~~provider 适配/路由/任务调度/计量~~（ADR-018 移除） | — |
| 账号域 | 通用域（平台） | 账号 Account、**个人 API token ApiToken（新增 v1.3）** | 注册登录/会话/多端同步（仅 MCP 本地离线）/**MCP 远程鉴权凭证** | 全部域（提供 user 上下文） |

存储映射（v3，ADR-012）：领域对象 → MongoDB collection，沿用核心前缀 `dl_`（slots.table_prefixes.core 语义保留），字段语义不变；嵌入/引用策略在 D3 文档（01-solution 各 api 文档）确定。版本快照 DeckVersion.content 保持不可变 JSON 文档。

## 2. 创作迭代域（核心域）领域对象清单

| 对象 | 分类 | 与上级关系 | 核心业务字段 | 关键枚举字段 | 备注 |
|------|------|-----------|------------|------------|------|
| 创作物 Deck | 聚合根 | — | 名称、类型、主题、需求描述、默认品牌规范ID、状态、当前版本ID、活动分支、定稿版本ID | deckType、deckStatus | 状态机见 §4 |
| 内容版本 DeckVersion | 聚合根（独立聚合） | 隶属 Deck（deckId 外联） | 版本号(谱系内)、分支名、父版本ID、内容快照(页面树 JSON)、来源指令文本、指令作用域、快照的品牌规范/素材引用、来源任务ID | versionSource | 不可变；树边=parentVersionId |
| 页面/内容块 | 值对象（版本内） | DeckVersion.content JSON | 页面(布局/顺序)、块(类型 text/image/占位、内容) | blockType | 快照数据，无独立标识生命周期 |
| 大纲 Outline | 值对象（Deck 内字段） | Deck.draftOutline JSON | 章节节点树、每页主题与要点 | — | 确认后触发整稿生成；首个版本生成后归档只读 |
| 生成任务 GenerationTask | 子流程（同域独立聚合）**（历史只读 v1.3）** | 服务于 Deck/DeckVersion | 任务类型、指令快照、目标版本ID、渠道/模型快照、状态、错误信息、用量计量 | taskType、taskStatus | I/O 契约见 §5.1；v1.3（ADR-018）：不再有新写入，dl_generation_task 留存历史审计；版本产出由 agent 直写承接（§5 注记） |
| 导出任务 ExportTask | 子流程 | 服务于 Deck 定稿交付 | 格式、来源版本ID、状态、产物文件、错误信息 | exportFormat、exportStatus | I/O 契约见 §5.2 |

**聚合根判定记录**：
- **Deck**：A1✓（当前版本指针/状态机一致性）、A2✓（被导出·演示·任务引用）、A3✓（版本树初始化入口）、A4✓（状态驱动可执行操作）→ 4/4 聚合根
- **DeckVersion**：A1✓（不可变性自身即一致性约束）、A2✓（被对比/回退/分叉/导出/演示引用）、A3✗（由任务回调创建）、A4✓（当前指针的落点）→ 3/4 聚合根。**独立于 Deck 聚合的理由**：内容快照体积大且不可变；树边跨版本；对比/分叉操作以版本为中心——放入 Deck 聚合会造成巨型聚合根（见「常见错误」）。Deck.currentVersionId 与版本集合的跨聚合一致性由「回退/分叉走 Deck 应用服务」保证。

**G1 灰色地带裁决（分区实体 vs 聚合根）**：DeckVersion 外部引用需求（对比/分叉/导出）明确 → 聚合根而非 Deck 分区实体。

**G2 灰色地带裁决（当前 vs 历史）**：当前内容=Deck.currentVersionId 指针（Deck 聚合根字段）；历史=DeckVersion 聚合——指针可移、历史不可变。

## 3. 支撑域/基础数据域/平台域领域对象清单

| 对象 | 分类 | 所属域 | 核心业务字段 | 关键枚举字段 | 备注 |
|------|------|--------|------------|------------|------|
| 素材 Asset | 聚合根 | 素材品牌域 | 文件名、分类、存储key、类型、尺寸、状态 | assetType、assetStatus | 被版本引用后仅可停用（assetStatus=DISABLED），不可物理删除 |
| 品牌规范 BrandKit | 聚合根 | 素材品牌域 | 规范名、色板(JSON)、字体组(JSON)、标志素材ID | — | 可多套；删除守卫同素材 |
| 话术模板 PromptTemplate | 聚合根（薄建模） | 话术域 | 标题、话术正文、分类、使用场景 | templateScene | 参数占位 {占位名} 简单替换 |
| ~~渠道偏好 ChannelPreference~~（移除 v1.3） | 聚合根（薄） | 渠道偏好域 | 用户ID、默认渠道/模型、分任务类型档位(JSON) | — | ADR-018：表删除（配置数据无审计价值） |
| ~~渠道/模型 ChannelModel~~（移除 v1.3） | 关联领域对象 | AI 网关域（归属） | 渠道编码、模型编码、能力标签、状态 | — | ADR-018：dl_channel 表删除；task/usage 行内编码为快照字符串无解引用 |
| 生成任务 GenerationTask（网关视角）（退役 v1.3） | 聚合根（网关视角的调度实体） | AI 网关域 | 见 §2（同一实体的网关侧建模） | — | 网关移除；历史行只读 |
| 用量记录 UsageRecord（历史只读 v1.3） | 实体（网关域，日志型） | AI 网关域 | 用户、渠道/模型、任务ID、token 用量、时间 | — | 只追加留存历史审计；usage 查询端点已删除 |
| 账号 Account | 聚合根（通用） | 账号域 | 登录名/邮箱、凭据、昵称、状态 | accountStatus | 通用 IAM 建模，从简 |
| **个人 API token ApiToken（新增 v1.3）** | 聚合根（通用，薄） | 账号域 | 用途名、token 哈希（SHA-256）、展示前缀、过期时刻、最近使用、吊销时刻 | —（status 为派生展示值） | 1 Account→N ApiToken；dl_api_token；明文仅签发回执一次；独立守卫校验（ADR-018 §4.3） |

**ApiToken 聚合根判定记录（v1.3）**：A1✓（哈希/过期/吊销一致性自守）、A2✓（被 MCP 远程全量端点与 agent-create 守卫引用）、A3✓（签发/吊销唯一入口）、A4✓（吊销驱动鉴权拒绝）→ 4/4 聚合根。薄建模（通用域）：无状态机列（ACTIVE/EXPIRED/REVOKED 由 revoked_at/expires_at 派生），无业务规则渗入核心域。

## 4. 状态模型（业务流程类对象）

### 4.1 创作物 Deck 状态机

```
DRAFT(草稿) ──首个版本生成成功──▶ ITERATING(迭代中) ──定稿──▶ FINALIZED(已定稿)
   ▲                                ▲    │                    │解锁
   │            恢复(无版本)          │    │归档                 │归档
   │                                │    ▼                    ▼
   └────────────────────────────── ARCHIVED(已归档) ◀──────────┘
                                    │恢复(有版本→ITERATING)
```

| 流转 | 触发 | 守卫 |
|------|------|------|
| DRAFT→ITERATING | 首个整稿生成任务成功 | 自动 |
| ITERATING→FINALIZED | 定稿 | 无进行中的生成任务 |
| FINALIZED→ITERATING | 解锁 | 确认操作 |
| DRAFT/ITERATING/FINALIZED→ARCHIVED | 归档 | 无进行中任务 |
| ARCHIVED→ITERATING/DRAFT | 恢复 | 有版本→ITERATING；无→DRAFT |

**核心不变量**：① FINALIZED 态禁止发起生成/调整任务；② currentVersionId 必须指向本 Deck 版本树内版本；③ 定稿版本 finalVersionId 在 FINALIZED 态必有值。

### 4.2 生成任务 GenerationTask 状态机（子流程）（历史 v1.3：不再有新流转，ADR-018）

```
QUEUED(排队) → RUNNING(执行中) → SUCCEEDED(成功) | FAILED(失败)
     │              │
     └─取消→ CANCELLED(已取消)
失败可重试（新任务实例，同指令）
```

### 4.3 导出任务 ExportTask 状态机（子流程）

```
QUEUED → RENDERING(渲染中) → SUCCEEDED | FAILED
QUEUED/RENDERING → CANCELLED(已取消)
```

## 5. 子流程 I/O 契约

| 子流程 | 触发条件 | 输入（来自父聚合根/业务） | 输出 | 输出写入 |
|--------|---------|------------------------|------|---------|
| GenerationTask（整稿生成 taskType=FULL_GENERATE） | 用户确认大纲发起 | deckId、大纲快照、品牌规范ID、素材ID集、渠道/模型偏好 | 版本内容快照（页面树 JSON） | 新 DeckVersion（source=FULL_GENERATE，无父版本或接续当前指针） |
| GenerationTask（整稿调整 taskType=FULL_ADJUST） | 整稿调整指令 | deckId、基线版本ID、指令文本、品牌规范ID | 新版本内容快照 | 新 DeckVersion（parent=基线版本） |
| GenerationTask（定向调整 taskType=TARGETED_ADJUST） | 定向调整指令 | deckId、基线版本ID、目标定位（页/块ID 路径）、指令文本、品牌约束开关 | 仅目标作用域变更的完整新快照 | 新 DeckVersion（parent=基线版本，记录 scope） |
| GenerationTask（大纲生成 taskType=OUTLINE） | 需求解析 | deckId、主题/需求、素材/品牌引用 | 大纲 JSON | Deck.draftOutline（编辑中态） |
| ExportTask | 定稿后导出（v1.3：触发方=MCP export_deck，本地 headless 渲染） | deckId、finalVersionId、格式 | 产物文件（对象存储 key） | ExportTask 记录 + 下载凭证 |

> **v1.3 注记（ADR-018）——agent 直写承接生成/调整子流程**：上表四类 GenerationTask
> 子流程的「推理产出」改由外部 coding agent 承担，平台侧 I/O 收敛为单一编排点
> `POST /ver/version/agent-create`（MCP version_create 落点）：输入 deckId/content/
> instruction/parentVersionId?/branchName?/scope?，输出新 DeckVersion + Deck 指针/
> 首版流转 + 引用计数（VersionArchiveService 单事务，**唯一写入口不变**）。
> sourceType 自动判定（FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST）；taskId 合成
> agent-<snowflake>（不建任务行）；OUTLINE 子流程收敛为 deck 域 outline-save
> （DRAFT 态中间产物，非版本）。定向不变性校验（INV-9 + 非目标 canonical 不变）
> 迁该端点守卫。本地 MCP 模式经同一服务直写 SQLite（ADR-017）。

## 6. 关联领域对象（跨域引用，只存 ID/编码）

| 关联领域对象 | 所属业务域 | 当前域关联字段 | 需获取信息 | 触发关系 | 映射模式 |
|------------|--------|---------|----------|---------|---------|
| BrandKit | 素材品牌域 | Deck.defaultBrandKitId、指令快照.brandKitId | 色板/字体/标志（生成注入时） | 生成/调整时引用 | OHS（素材域提供规范读取服务）+ ACL（业务侧以 brandKitId 引用，不复制内容） |
| Asset | 素材品牌域 | 指令快照.assetIds、BrandKit.logoAssetId | 文件访问（渲染/导出时） | 上传→引用→渲染 | OHS + ACL |
| PromptTemplate | 话术域 | 指令输入引用（记录 usedTemplateIds） | 话术正文（输入时前端取用） | 指令输入时引用 | OHS |
| ~~ChannelModel~~（移除 v1.3，ADR-018） | ~~AI 网关域~~（退役） | ~~ChannelPreference 默认/档位~~、任务快照.channelCode/modelCode（历史快照字符串，无解引用） | ~~渠道能力/状态（选择时）~~ | ~~偏好设置/任务路由时~~ | ~~遵奉者~~（dl_channel 表删除；W4 退役标记） |
| Account | 账号域 | 全域 user_id（隔离字段，ADR-005） | 昵称/状态 | 登录态注入 | 遵奉者 |

## 7. 业务域关系映射（集成）

| 上游 | 下游 | 模式 | 说明 |
|------|------|------|------|
| ~~创作迭代域（核心）~~ | ~~AI 网关域（通用）~~ | ~~遵奉者~~ | 退役 v1.3（ADR-018）：网关移除 |
| 创作迭代域（核心） | 素材品牌域（支撑） | ACL + OHS | 以 ID 引用素材/规范；注入时经防腐层取内容，素材概念不渗入核心模型 |
| 话术域（支撑） | 创作迭代域 | OHS | 提供话术读取服务 |
| ~~渠道偏好域（基础）~~ | ~~AI 网关域~~ | ~~遵奉者~~ | 退役 v1.3（ADR-018） |
| 全域 | 账号域（通用） | 遵奉者 | 会话上下文与 user_id 隔离 |
| **外部 coding agent（MCP 远程）** | 创作迭代域/支撑域（云端 PG） | **OHS + PL（新增 v1.3）** | HTTP 调用既有端点 + agent-create；发布语言=Result/PageResult 信封 + BIZ_* 错误码透传 + content JSON 契约（api-version §4.1）；鉴权=个人 API token（独立守卫）；28 tools 语义不变（api-web-agent §5 映射） |
| **MCP 本地离线** | 账号域（同步） | OHS（v1.3 收窄） | /auth/sync/pull 游标拉取（云→本地）；版本对账经 agent-create（本地→云） |

## 8. 过程数据分类

| 数据项 | 类别 | 处理方式 |
|--------|------|---------|
| 定向目标选中态（页/块高亮） | P3 UI 交互状态 | 前端状态，指令提交时序列化为 scope |
| 生成进度百分比/阶段文案 | P2 展示数据 | 任务状态接口派生 |
| 版本对比差异结果 | P7 计算中间值 | 比较接口实时计算返回，不持久化 |
| 大纲编辑中间态 | P3 UI 交互状态 | 保存至 Deck.draftOutline（持久化为草稿大纲，版本生成后转只读） |
| 列表筛选/分页参数 | P1 查询条件 | 请求参数 |
| 演示放映翻页状态 | P3 UI 交互状态 | 前端本地 |
| AI 流式输出片段 | P5 集成载荷 | ~~任务流式通道转发~~（退役 v1.3：SSE 删除；agent 会话内自跟踪） |
| 操作日志 | P6 平台托管 | 框架审计，挂业务单据 |
| API token 明文（新增 v1.3） | P4 请求/响应结构 | 仅签发 VO 一次性返回，不落库不记日志（库内 SHA-256 哈希） |
| MCP 远程错误透传载荷（新增 v1.3） | P5 集成载荷 | Result{status,code,msg} 原样转 MCP 错误回执，不翻译不吞码 |
| token status（ACTIVE/EXPIRED/REVOKED）（新增 v1.3） | P2 展示数据 | 由 revoked_at/expires_at 派生，不落状态列 |

## 9. 设计决策记录（与 knowledge/design-decisions/index.md 对齐）

> 2026-10-08 v3 技术栈重定向（D0-v3）后口径；同日复议修订（D0-v3 §5）后重新对齐。

| 编号 | 决策 | 影响 | 日期 |
|------|------|------|------|
| ADR-001 | 双栈路线：vue3-engine 桌面端（Tauri 壳）+ Node/TypeScript（NestJS）云端；v3 重定向弃 Java（2026-10-08） | 账号/AI 网关走云端，桌面端专注创作管理；轻栈低内存 | 2026-10-08 |
| ADR-002 | Deck 与 DeckVersion 拆两个聚合根；版本内容为不可变 JSON 快照 | 避免巨型聚合；对比/分叉/回退以版本为中心 | 2026-10-07 |
| ADR-003 | 生成任务为子流程，成功回调写新版本；失败不产版本 | 任务态与版本态解耦；重试=新任务实例 | 2026-10-07 |
| ADR-004 | 素材/品牌规范被引用后仅可停用不可删除 | 版本快照可回溯 | 2026-10-07 |
| ADR-005 | 主表隔离字段用 user_id（替代规约 company_id 三字段组） | 个人单用户产品对栈规约的显式偏差，API 文档设计决策节引用 | 2026-10-07 |
| ADR-006 | 云端单服务 deck-loop-core 起步，域边界模块隔离；v3 技术栈：NestJS 单服务（原 Java 实现作废，契约保留） | 同契约 TS 重实现；Docker Compose 部署（经用户确认） | 2026-10-08 |
| ADR-007 | 多形态抽象（创作物+类型），首期仅演示文稿落地 | 模型不返工，交付风险低（经用户确认） | 2026-10-07 |
| ADR-008 | 调整只经语言指令驱动（整稿级+定向级），不做手动像素编辑 | 产品定位核心约束；迭代工作台为 hybrid 页 | 2026-10-07 |
| ADR-009 | 版本树+分叉（可回退/分叉/对比）；回退=移指针历史不动 | 核心体验决策（经用户确认） | 2026-10-07 |
| ADR-010 | 密钥仅网关域可读（v3：服务端 env/config，OpenAI 兼容适配器+Mock）；路由顺序=任务显式>偏好档位>默认>平台兜底 | 安全红线+路由可追溯 | 2026-10-08 |
| ADR-011 | 部署=宝塔「Node 项目」（PM2 守护+内存限额），MongoDB 用服务器既有实例；边缘沿用宝塔 Nginx；Docker Compose 为备选 | 免容器化复杂度；复用既有设施 | 2026-10-08 |
| ADR-012 | 存储=MongoDB 文档模型（版本快照天然 JSON 文档）；v1 API 契约全量冻结复用 | 前端零感知复用；DDL→collection 建模见各 api 文档 | 2026-10-08 |
| ADR-013 | 多端同步保留（v3 复议恢复）：/auth/sync/pull 游标拉取 + SyncChangeScanner 八聚合扫描；游标=Mongo Date 毫秒+(id) 复合推进 | 用户确认保留；前端 v1 全量复用（v1.3 注：ADR-018 收窄为仅服务 MCP 本地离线，扫描去 PREFERENCE、TASK 历史只读） | 2026-10-08 |
| ADR-018 | 云端 PG 单源 + Web 管理站 + MCP 远程（网关彻底移除）：新增 ApiToken 聚合；GenerationTask/UsageRecord 转历史、ChannelPreference/ChannelModel 移除；agent 直写承接生成/调整子流程（VersionArchiveService 唯一写入口不变） | 详版 workspace/00-architecture/ADR-018-web-single-source.md；核心域聚合根零变更 | 2026-11-25 |

## 更新记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.3 | 2026-11-25 | ADR-018 增量注记（web-mgmt-20261125）：新增 ApiToken 聚合根（账号域，A1-A4 4/4，dl_api_token）；AI 网关域/渠道偏好域退役（GenerationTask/UsageRecord 历史只读、ChannelPreference/ChannelModel 移除）；§5 agent 直写承接生成/调整子流程 I/O 注记；§7 增 MCP 远程 OHS+PL 集成行与本地同步收窄行；§8 增 token 明文/错误透传/status 派生过程数据；§9 增 ADR-018。**核心域 Deck/DeckVersion 与支撑域三聚合根零变更** |
| v1.2 | 2026-10-08 | 复议修订（D0-v3 §5）：§9 ADR 表与 knowledge/design-decisions/index.md 重新逐行对齐（ADR-011 改宝塔 Node 项目部署+服务器既有 MongoDB、Docker Compose 备选；ADR-013 改多端同步保留，游标=Mongo Date 毫秒+(id) 复合推进）；§1 账号域职责恢复「注册登录/会话/多端同步」。对象清单与存储映射不变。 |
| v1.1 | 2026-10-08 | v3 技术栈重定向（D0-v3）：§9 ADR 表与 knowledge/design-decisions/index.md 对齐（ADR-001/006/010 改写为 v3 口径，ADR-007~009 补齐，ADR-011/012/013 新增）；账号域职责收缩（当版曾裁撤多端同步，ADR-013，未含同步相关对象与过程数据）；存储映射注记改 MongoDB collection 口径（dl_ 前缀保留，嵌入策略 D3 定，ADR-012）；对象清单（Account/UsageRecord 等）不变。 |
| v1.0 | 2026-10-07 | 初版。 |
