# Deck-Loop API 设计索引

| 属性 | 值 |
|------|-----|
| 版本 | v1.3 |
| 日期 | 2026-11-25 |
| 服务 | deck-loop-core（单服务：Node.js + TypeScript + NestJS + **PostgreSQL**，ADR-006/008/016；**ADR-018 契约修订：端点口径 75→56**（移除 23/迁移 1/新增 4），增量事实源 **api-web-agent.md**；未修订端点继续冻结，06 规约 §1 v1.3） |

> **ADR-018 修订注记（2026-11-25）**：generation/adjustment/channel/gateway 模块退役
> （下表标 ~~删除线~~）；deck +outline-save（迁移）、version +agent-create、
> auth +token issue/revoke/list。逐条移除清单与 56 端点对账见 api-web-agent.md §5.4；
> MCP 28 tools 远程映射见 §5.5。Collection/表清单：+dl_api_token，−dl_channel/
> dl_channel_preference，dl_generation_task/dl_usage_record 转历史只读。

## 模块 ↔ 文档映射

| 模块编码 | 模块 | 文档 | 接口域 | 聚合根/核心对象 |
|---------|------|------|--------|----------------|
| C-01/C-05 | 创作物管理·定稿（+outline-save 迁入） | api-deck.md + api-web-agent §4.3 | deck | Deck |
| ~~C-02~~ | ~~初稿生成~~（退役 ADR-018） | api-generation.md（历史） | ~~gen~~ | GenerationTask（历史只读） |
| ~~C-03~~ | ~~语言调整~~（退役 ADR-018） | api-adjustment.md（历史） | ~~adjust~~ | 调整指令（值对象，契约沿用） |
| C-04 | 版本管理（+agent-create） | api-version.md + api-web-agent §4.2 | ver | DeckVersion |
| C-06/S-03 | 导出交付·演示 | api-delivery.md | deliver | ExportTask（子流程） |
| S-01/S-02 | 素材品牌·话术 | api-assets.md | asset | Asset / BrandKit / PromptTemplate |
| ~~D-01~~ | ~~渠道偏好~~（退役 ADR-018） | api-channel.md（历史） | ~~channel~~ | ~~ChannelPreference~~（表删除） |
| P-02 | 账号同步·API token（~~P-01 网关~~退役） | api-platform.md + api-web-agent §4.1 | auth | Account / ApiToken（新）/ UsageRecord（历史） |
| 增量 | Web 管理站·agent 直写·网关移除 | **api-web-agent.md（ADR-018 事实源）** | ver/deck/auth | 移除清单 §5.4 / MCP 协议 §5.5 |

## Collection 清单（前缀 dl_；ADR-018 后物理表 10 张：11−2+1）

| Collection | 归属文档 | 说明 |
|-----------|---------|------|
| dl_deck | api-deck | 创作物主集合（draft_outline 嵌入） |
| dl_generation_task | api-generation（历史） | 生成任务——**历史只读**（ADR-018 停写；TASK 同步扫描/withStats 审计读保留） |
| dl_deck_version | api-version | 内容版本（不可变只插入；content 整体嵌入） |
| dl_export_task | api-delivery | 导出任务/记录 |
| dl_asset / dl_brand_kit / dl_prompt_template | api-assets | 素材/规范/话术 |
| ~~dl_channel_preference~~ | ~~api-channel~~ | ~~渠道偏好（1:1 用户）~~（**表删除** ADR-018；同步扫描 PREFERENCE 移除） |
| ~~dl_channel~~ | ~~api-channel / channel-admin~~ | ~~渠道配置~~（**表删除** ADR-018；配置数据无审计价值） |
| dl_api_token | api-web-agent §4.1 | **个人 API token（新增 ADR-018）**——SHA-256 哈希存储（INV-27/28），独立守卫 |
| dl_account / dl_usage_record | api-platform | 账号/用量（usage **历史只读**，ADR-018 停写；只追加日志型） |

> 建模规约（嵌入/引用判定、业务 id 唯一索引、索引声明）见 06-node-api-conventions §7（PG）；
> ~~渠道注册不建 collection（服务端 env/config）~~——渠道域整体退役（ADR-018）。
> dl_deck_log 为设计层平台框架日志集合，**未落地**（不计物理表）。

## 跨模块共享契约

| 契约 | 定义处 | 消费处 |
|------|--------|--------|
| ~~任务子流程 I/O 与状态机~~（退役 ADR-018） | api-generation §4（历史） | agent 直写承接（api-web-agent §4.2） |
| Deck↔DeckVersion 不变量与编排 | api-deck §2 | api-version / agent-create 编排 |
| 引用计数（INV-18） | api-assets §2.2 | 版本留档（VersionArchiveService 单事务） |
| ~~路由解析~~（退役 ADR-018） | ~~api-channel §5.1~~ | ~~任务创建（gen/adjust）~~ |

## 公共规约引用

- 枚举池：workspace/01-solution/common-spec/04-business-enum.md
- 公共枚举：workspace/01-solution/common-spec/03-common-enums.md
- 选择服务池：workspace/01-solution/common-spec/05-select-service-pool.md
- Node/Mongo 规约（v3，替代 v1 java-microservice 20-api-conventions）：workspace/01-solution/common-spec/06-node-api-conventions.md（契约冻结声明 §1、Mongo 建模 §3、查询安全 §4、进程内事件 §5）

## 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 首次生成（8 模块文档） |
| v1.1 | 2026-10-08 | v3 技术栈重定向（D0）：服务形态 Node/TS/NestJS+MongoDB；表清单→collection 清单（10 个）；栈规约引用改 06-node-api-conventions；api-platform 删除 /auth/sync/pull（ADR-013），端点 66→65；跨模块共享契约与各文档接口契约冻结不变 |
| v1.3 | 2026-11-25 | ADR-018 契约修订（web-mgmt-20261125）：66 冻结解除；generation/adjustment/channel/gateway 退役（移除 23 端点），outline/save 迁 deck 域，新增 agent-create + token issue/revoke/list（4），端点口径 75→**56**；+api-web-agent.md 增量事实源；表 +dl_api_token/−dl_channel/−dl_channel_preference，task/usage 转历史只读；存储口径 PostgreSQL（ADR-016）。未修订端点契约继续冻结 |
| v1.2 | 2026-10-08 | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：P-02 复名「网关·账号同步」，api-platform 恢复 /auth/sync/pull，端点口径 65→**66**（v1 契约全量冻结，无删除）；collection 清单与各文档契约不变 |
