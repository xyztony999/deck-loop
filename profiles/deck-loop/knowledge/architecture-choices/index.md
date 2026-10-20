# 架构选型

> D1-D3 完成后回填（2026-10-07）。

## 领域划分

| 应用域（DDD 四层） | 模块 | 聚合根 |
|------------------|------|--------|
| 核心业务域 | C-01 创作物管理 · C-02 初稿生成 · C-03 语言调整 · C-04 版本管理 · C-05 定稿管理 · C-06 导出交付 | Deck / DeckVersion（+GenerationTask 子流程） |
| 支撑业务域 | S-01 素材与品牌资产 · S-02 迭代话术库 · S-03 演示放映 | Asset / BrandKit / PromptTemplate |
| 基础数据域 | D-01 AI 渠道与偏好 | ChannelPreference |
| 平台支撑域 | P-01 AI 生成网关 · P-02 账号与设备同步 | Account（+UsageRecord） |

表前缀：dl_（全部 10 表见 api-index.md）。

## 技术栈版本

| 层 | 技术 | 版本 |
|----|------|------|
| 前端 | Vue 3 / TypeScript / Ant Design Vue / Vite | 按 vue3-engine 栈 profile |
| 桌面壳 | Tauri 2 / WebView2 + export-renderer 插件（render_pdf/capture_page，ADR-015 客户端导出渲染） | v3 已定版 |
| 后端 | Node 24 / NestJS 10 / Mongoose 8 / TypeScript strict（无渲染依赖——导出渲染在客户端，ADR-015） | 按 node-nestjs-mongo 栈规约（.claude/skills/node-specs） |
| 服务形态 | 单服务 deck-loop-core（ADR-006；宝塔 Node 项目 + PM2 部署） | 单实例假设 NR-13 |
| 存储 | MongoDB 副本集（dl_ 全部 collection；版本/大纲/指令快照为嵌入 JSON 文档）+ 本地目录（素材/导出产物，HMAC 限时 URL） | |
| 异步 | 进程内任务调度（网关 2 槽/渲染 2 槽）+ EventEmitter2 域事件 + SSE 推送 | 无外部 MQ（v3 减重决策） |

## 关键架构文档导航

| 文档 | 路径 |
|------|------|
| 业务/应用架构/功能清单 | workspace/00-architecture/ |
| 领域模型 + 8 份 PRD | workspace/02-detailed/prd/ |
| 8 份 API 设计 + index | workspace/02-detailed/api/ |
| 7 份 PageSpec | workspace/02-detailed/interaction/creator/ |
| 阶段报告 + Gate 1 | workspace/05-reports/ |
