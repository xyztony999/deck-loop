# Deck-Loop API 设计索引

| 属性 | 值 |
|------|-----|
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 服务 | deck-loop-core（单服务：Node.js + TypeScript + NestJS + MongoDB，ADR-006/008；v1 API 契约**全量 66 端点冻结，无删除**见 06 规约 §1） |

## 模块 ↔ 文档映射

| 模块编码 | 模块 | 文档 | 接口域 | 聚合根/核心对象 |
|---------|------|------|--------|----------------|
| C-01/C-05 | 创作物管理·定稿 | api-deck.md | deck | Deck |
| C-02 | 初稿生成 | api-generation.md | gen | GenerationTask（子流程） |
| C-03 | 语言调整 | api-adjustment.md | adjust | 调整指令（值对象） |
| C-04 | 版本管理 | api-version.md | ver | DeckVersion |
| C-06/S-03 | 导出交付·演示 | api-delivery.md | deliver | ExportTask（子流程） |
| S-01/S-02 | 素材品牌·话术 | api-assets.md | asset | Asset / BrandKit / PromptTemplate |
| D-01 | 渠道偏好 | api-channel.md | channel | ChannelPreference |
| P-01/P-02 | 网关·账号同步 | api-platform.md | auth / gw | Account / UsageRecord |

## Collection 清单（前缀 dl_，共 10 个）

| Collection | 归属文档 | 说明 |
|-----------|---------|------|
| dl_deck | api-deck | 创作物主集合（draft_outline 嵌入） |
| dl_generation_task | api-generation | 生成任务（四类 taskType 共用；instruction_snapshot 嵌入） |
| dl_deck_version | api-version | 内容版本（不可变只插入；content 整体嵌入） |
| dl_export_task | api-delivery | 导出任务/记录 |
| dl_asset / dl_brand_kit / dl_prompt_template | api-assets | 素材/规范/话术 |
| dl_channel_preference | api-channel | 渠道偏好（1:1 用户） |
| dl_account / dl_usage_record | api-platform | 账号/用量（usage 只追加） |

> 建模规约（嵌入/引用判定、业务 id 唯一索引、索引声明）见 06-node-api-conventions §3；渠道注册不建 collection（服务端 env/config）。

## 跨模块共享契约

| 契约 | 定义处 | 消费处 |
|------|--------|--------|
| 任务子流程 I/O 与状态机 | api-generation §4 | api-adjustment / api-platform |
| Deck↔DeckVersion 不变量与编排 | api-deck §2 | api-version / api-generation 回调 |
| 引用计数（INV-18） | api-assets §2.2 | 版本留档回调 |
| 路由解析 | api-channel §5.1 | 任务创建（gen/adjust） |

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
| v1.2 | 2026-10-08 | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：P-02 复名「网关·账号同步」，api-platform 恢复 /auth/sync/pull，端点口径 65→**66**（v1 契约全量冻结，无删除）；collection 清单与各文档契约不变 |
