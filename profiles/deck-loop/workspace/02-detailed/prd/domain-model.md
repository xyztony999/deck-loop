# Deck-Loop 领域模型（DDD）

| 属性 | 值 |
|------|-----|
| 模块 | deck-loop 全量 |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | D0 澄清报告 v1.0 / BA·AA·FL v1.0 |

## Step 0：范围判定

战略设计（业务域识别/分层/关系映射）已在 D1 应用架构完成（DDD 四层归类，经用户确认）。本文档按模块执行战术设计，对象级判定（非字段级）。

## 1. 业务域清单与分层

| 上下文 | 领域分层 | 聚合根 | 核心职责 | 关联上下文 |
|--------|---------|--------|---------|-----------|
| 创作迭代域（核心） | 核心域 | 创作物 Deck、内容版本 DeckVersion | 生成-调整-版本闭环 | 素材品牌域、话术域、渠道偏好域、AI 网关域 |
| 素材品牌域 | 支撑域 | 素材 Asset、品牌规范 BrandKit | 一致性资产供给 | 创作迭代域（被引用） |
| 话术域 | 支撑域 | 话术模板 PromptTemplate | 调整话术沉淀复用 | 创作迭代域（被引用） |
| 渠道偏好域 | 基础数据域 | 渠道偏好 ChannelPreference | 用户级生成资源配置 | AI 网关域（被下发渠道清单） |
| AI 网关域 | 通用域（平台） | 生成任务 GenerationTask | provider 适配/路由/任务调度/计量 | 全部业务域（被调用） |
| 账号域 | 通用域（平台） | 账号 Account | 注册登录/会话/多端同步 | 全部域（提供 user 上下文） |

存储映射（v3，ADR-012）：领域对象 → MongoDB collection，沿用核心前缀 `dl_`（slots.table_prefixes.core 语义保留），字段语义不变；嵌入/引用策略在 D3 文档（01-solution 各 api 文档）确定。版本快照 DeckVersion.content 保持不可变 JSON 文档。

## 2. 创作迭代域（核心域）领域对象清单

| 对象 | 分类 | 与上级关系 | 核心业务字段 | 关键枚举字段 | 备注 |
|------|------|-----------|------------|------------|------|
| 创作物 Deck | 聚合根 | — | 名称、类型、主题、需求描述、默认品牌规范ID、状态、当前版本ID、活动分支、定稿版本ID | deckType、deckStatus | 状态机见 §4 |
| 内容版本 DeckVersion | 聚合根（独立聚合） | 隶属 Deck（deckId 外联） | 版本号(谱系内)、分支名、父版本ID、内容快照(页面树 JSON)、来源指令文本、指令作用域、快照的品牌规范/素材引用、来源任务ID | versionSource | 不可变；树边=parentVersionId |
| 页面/内容块 | 值对象（版本内） | DeckVersion.content JSON | 页面(布局/顺序)、块(类型 text/image/占位、内容) | blockType | 快照数据，无独立标识生命周期 |
| 大纲 Outline | 值对象（Deck 内字段） | Deck.draftOutline JSON | 章节节点树、每页主题与要点 | — | 确认后触发整稿生成；首个版本生成后归档只读 |
| 生成任务 GenerationTask | 子流程（同域独立聚合） | 服务于 Deck/DeckVersion | 任务类型、指令快照、目标版本ID、渠道/模型快照、状态、错误信息、用量计量 | taskType、taskStatus | I/O 契约见 §5.1 |
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
| 渠道偏好 ChannelPreference | 聚合根（薄） | 渠道偏好域 | 用户ID、默认渠道/模型、分任务类型档位(JSON) | — | 与用户 1:1 |
| 渠道/模型 ChannelModel | 关联领域对象（对渠道偏好域/业务侧） | AI 网关域（归属） | 渠道编码、模型编码、能力标签、状态 | — | 业务侧只读引用；密钥仅网关域可见 |
| 生成任务 GenerationTask | 聚合根（网关视角的调度实体） | AI 网关域 | 见 §2（同一实体的网关侧建模） | — | 网关域负责任务执行；业务语义（指令/版本）在创作迭代域 |
| 用量记录 UsageRecord | 实体（网关域，日志型） | AI 网关域 | 用户、渠道/模型、任务ID、token 用量、时间 | — | 只追加；供用量统计 |
| 账号 Account | 聚合根（通用） | 账号域 | 登录名/邮箱、凭据、昵称、状态 | accountStatus | 通用 IAM 建模，从简 |

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

### 4.2 生成任务 GenerationTask 状态机（子流程）

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
| ExportTask | 定稿后导出 | deckId、finalVersionId、格式 | 产物文件（对象存储 key） | ExportTask 记录 + 下载凭证 |

## 6. 关联领域对象（跨域引用，只存 ID/编码）

| 关联领域对象 | 所属业务域 | 当前域关联字段 | 需获取信息 | 触发关系 | 映射模式 |
|------------|--------|---------|----------|---------|---------|
| BrandKit | 素材品牌域 | Deck.defaultBrandKitId、指令快照.brandKitId | 色板/字体/标志（生成注入时） | 生成/调整时引用 | OHS（素材域提供规范读取服务）+ ACL（业务侧以 brandKitId 引用，不复制内容） |
| Asset | 素材品牌域 | 指令快照.assetIds、BrandKit.logoAssetId | 文件访问（渲染/导出时） | 上传→引用→渲染 | OHS + ACL |
| PromptTemplate | 话术域 | 指令输入引用（记录 usedTemplateIds） | 话术正文（输入时前端取用） | 指令输入时引用 | OHS |
| ChannelModel | AI 网关域 | ChannelPreference 默认/档位、任务快照.channelCode/modelCode | 渠道能力/状态（选择时） | 偏好设置/任务路由时 | 遵奉者（直接消费网关标准清单接口） |
| Account | 账号域 | 全域 user_id（隔离字段，ADR-005） | 昵称/状态 | 登录态注入 | 遵奉者 |

## 7. 业务域关系映射（集成）

| 上游 | 下游 | 模式 | 说明 |
|------|------|------|------|
| 创作迭代域（核心） | AI 网关域（通用） | 遵奉者 | 直接使用网关任务接口与回调协议，不自建翻译层 |
| 创作迭代域（核心） | 素材品牌域（支撑） | ACL + OHS | 以 ID 引用素材/规范；注入时经防腐层取内容，素材概念不渗入核心模型 |
| 话术域（支撑） | 创作迭代域 | OHS | 提供话术读取服务 |
| 渠道偏好域（基础） | AI 网关域 | 遵奉者 | 消费网关渠道/模型清单 |
| 全域 | 账号域（通用） | 遵奉者 | 会话上下文与 user_id 隔离 |

## 8. 过程数据分类

| 数据项 | 类别 | 处理方式 |
|--------|------|---------|
| 定向目标选中态（页/块高亮） | P3 UI 交互状态 | 前端状态，指令提交时序列化为 scope |
| 生成进度百分比/阶段文案 | P2 展示数据 | 任务状态接口派生 |
| 版本对比差异结果 | P7 计算中间值 | 比较接口实时计算返回，不持久化 |
| 大纲编辑中间态 | P3 UI 交互状态 | 保存至 Deck.draftOutline（持久化为草稿大纲，版本生成后转只读） |
| 列表筛选/分页参数 | P1 查询条件 | 请求参数 |
| 演示放映翻页状态 | P3 UI 交互状态 | 前端本地 |
| AI 流式输出片段 | P5 集成载荷 | 任务流式通道转发，落库仅最终结果 |
| 操作日志 | P6 平台托管 | 框架审计，挂业务单据 |

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
| ADR-013 | 多端同步保留（v3 复议恢复）：/auth/sync/pull 游标拉取 + SyncChangeScanner 八聚合扫描；游标=Mongo Date 毫秒+(id) 复合推进 | 用户确认保留；前端 v1 全量复用 | 2026-10-08 |

## 更新记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.2 | 2026-10-08 | 复议修订（D0-v3 §5）：§9 ADR 表与 knowledge/design-decisions/index.md 重新逐行对齐（ADR-011 改宝塔 Node 项目部署+服务器既有 MongoDB、Docker Compose 备选；ADR-013 改多端同步保留，游标=Mongo Date 毫秒+(id) 复合推进）；§1 账号域职责恢复「注册登录/会话/多端同步」。对象清单与存储映射不变。 |
| v1.1 | 2026-10-08 | v3 技术栈重定向（D0-v3）：§9 ADR 表与 knowledge/design-decisions/index.md 对齐（ADR-001/006/010 改写为 v3 口径，ADR-007~009 补齐，ADR-011/012/013 新增）；账号域职责收缩（当版曾裁撤多端同步，ADR-013，未含同步相关对象与过程数据）；存储映射注记改 MongoDB collection 口径（dl_ 前缀保留，嵌入策略 D3 定，ADR-012）；对象清单（Account/UsageRecord 等）不变。 |
| v1.0 | 2026-10-07 | 初版。 |
