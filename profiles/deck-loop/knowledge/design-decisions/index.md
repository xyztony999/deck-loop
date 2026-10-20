# 设计决策（ADR）

> D0-D4 关键决策（2026-10-07）。详版见 workspace/02-detailed/prd/domain-model.md §9。

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
| ADR-015 | **导出渲染下沉客户端**（2026-10-20 重定向，D0-export-render-redirect）：云端渲染→客户端渲染（Tauri 插件 render_pdf/capture_page + pptxgenjs 文本层，渲染源=演示渲染组件多页模式=所见即所得）；云端保留台账+产物回传（upload 端点，多端可下载）；服务端渲染器（Playwright/Chromium）彻底移除。状态机 QUEUED→SUCCEEDED/FAILED/CANCELLED（RENDERING 留枚举兼容） | 1GB 服务器资源错配（Chromium 峰值 150-250MB×2 并发必 OOM）；SCM 企业模板「云端渲染」假设不适用于个人单用户产品；演示放映本就客户端渲染 | 2026-10-20 |
| ADR-014 | UI 设计铁律（领导评审三轮定案）：①暗色三层色板同源——页面底 #141414 → 内容表面 #1f1f1f → 浮层 #262626，AntdV token（colorBgLayout/colorBgContainer/colorBgElevated）必须锚定 global.less `--dl-*` 变量板同值；②禁卡中卡——同一页面仅一层表面（.dl-page-card），分组用无底色分区（.dl-tab-section + .dl-card-title 蓝竖条标题）；③主色 #6b8ab5 只作 accent（选中态/主按钮/小竖条），禁大面积底色 | 全部客户端页面/组件的验收标准；实现锚点 client/src/styles/theme.ts 暗色分支 + global.less | 2026-10-09 |
