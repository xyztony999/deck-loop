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
| ADR-012 | 存储=MongoDB 文档模型（版本快照天然 JSON 文档）；v1 API 契约全量冻结复用（**存储选型已被 ADR-016 修订为 PostgreSQL/TypeORM；契约冻结口径不变**） | 前端零感知复用；DDL→collection 建模见各 api 文档 | 2026-10-08 |
| ADR-013 | 多端同步保留（v3 复议恢复）：/auth/sync/pull 游标拉取 + SyncChangeScanner 八聚合扫描；游标=Mongo Date 毫秒+(id) 复合推进 | 用户确认保留；前端 v1 全量复用 | 2026-10-08 |
| ADR-015 | **导出渲染下沉客户端**（2026-10-20 重定向，D0-export-render-redirect）：云端渲染→客户端渲染（Tauri 插件 render_pdf/capture_page + pptxgenjs 文本层，渲染源=演示渲染组件多页模式=所见即所得）；云端保留台账+产物回传（upload 端点，多端可下载）；服务端渲染器（Playwright/Chromium）彻底移除。状态机 QUEUED→SUCCEEDED/FAILED/CANCELLED（RENDERING 留枚举兼容） | 1GB 服务器资源错配（Chromium 峰值 150-250MB×2 并发必 OOM）；SCM 企业模板「云端渲染」假设不适用于个人单用户产品；演示放映本就客户端渲染 | 2026-10-20 |
| ADR-014 | UI 设计铁律（领导评审三轮定案）：①暗色三层色板同源——页面底 #141414 → 内容表面 #1f1f1f → 浮层 #262626，AntdV token（colorBgLayout/colorBgContainer/colorBgElevated）必须锚定 global.less `--dl-*` 变量板同值；②禁卡中卡——同一页面仅一层表面（.dl-page-card），分组用无底色分区（.dl-tab-section + .dl-card-title 蓝竖条标题）；③主色 #6b8ab5 只作 accent（选中态/主按钮/小竖条），禁大面积底色 | 全部客户端页面/组件的验收标准；实现锚点 client/src/styles/theme.ts 暗色分支 + global.less | 2026-10-09 |
| ADR-016 | **持久层 MongoDB→PostgreSQL（TypeORM）**：mongoose 全换 @nestjs/typeorm+pg；与 UniGate 共 PG 实例不同 database（1.6G 服务器只跑一个 DB，目标省 200–300MB）；业务主键升表主键、Mixed 嵌入→jsonb、aggregate→SQL、多文档事务→PG 原生事务（版本留档恢复单事务）；Mongo 最终下线（须用户授权）。**对外 API 契约零变化、客户端零变化**；后端栈实质 node-nestjs-mongo→node-nestjs-psql | 详版 workspace/00-architecture/ADR-016-persistence-mongo-to-psql.md；D3 字段映射/仓储规约/聚合对照/迁移脚本规约 | 2026-11-24 |
| ADR-019 | **双模式市场包 + 主仓即市场**：插件保留本地+远程双模式，远程=登录用户自己的 deck-loop 账号（remote_connect 登录→自动签发个人 token→落盘切 remote，密码永不落盘）；SwitchableBackend 动态缝（config.json 驱动，28 业务 tools 无感知）+3 连接 tools=31；本地引擎换 sql.js（wasm 随包，全平台通用单 zip，better-sqlite3 降开发可选）；主仓根 marketplace.json+.claude-plugin 兼容，source=Release zip+sha256；CI release-plugin.yml tag→esbuild bundle→zip→Release→清单回写；ZCode/Claude marketplace add，Cursor/Codex 下载 zip 配 server.cjs | 详版 workspace/00-architecture/ADR-019-dual-mode-marketplace.md；用户裁决（双模式+账号登录）；mcp 4 suites/38 cases + bundle 冷启动验证 | 2026-11-27 |
| ADR-018 | **云端 PG 单源 + Web 管理站 + MCP 远程模式（AI 网关彻底移除）**：server-node/PG 唯一数据源（网站+远程 agent 直读写）；MCP 双模式（DECK_LOOP_MODE=local/remote，28 tools 语义不变，remote=HTTP+个人 API token）；网关/channel/generation/adjustment 模块与 23 端点删除（outline/save 迁 deck 域），dl_generation_task/dl_usage_record 保留历史审计，dl_channel/dl_channel_preference 删除；新 dl_api_token 表+独立 ApiTokenGuard（会话体系不变，AuthGuard 双凭证回落）；agent 直写 POST /ver/version/agent-create 经 VersionArchiveService 唯一写入口（单事务+定向不变性+首版流转）；同步模块保留仅服务 MCP 本地离线（扫描去 PREFERENCE）；web/ 自 779f3d6 恢复剥 Tauri（四功能组：素材/Deck/版本树/预览放映+导出下载），浏览器侧 render-template 渲染，新导出仅 MCP（ADR-015 零渲染不变）；端点 75→56，66 冻结解除；ADR-017 本地优先部分反转 | 详版 workspace/00-architecture/ADR-018-web-single-source.md；D0 四项用户裁决+D1 六项设计裁决；BA v1.1/AA v1.4/FL v1.3 增量注记 | 2026-11-25 |
| ADR-017 | **本地优先 MCP + 薄 ZCode 插件（coding plan 原生）**：订阅 token 非通用 API key，独立客户端形态错配→agent 出推理（coding plan）、deck-loop 出确定性状态机。本地 SQLite（与 PG 同构，可选同步预留 Phase 4）；**Tauri 客户端移除**（同日追加裁决：能力对账无本质必要，git 历史可恢复），headless 三格式导出（本地桌面跑浏览器不违 ADR-015 的 VPS OOM 理由）；通用 stdio MCP（mcp-server/）+ 薄插件（plugin/）；品牌/话术补 MCP tools。core 内新增 src/local/（四域真实模块 + SQL 方言翻译 QueryRunner 漏斗 + 列类型常量），仓储查询零改动、线上 PG 零回归；agent 经 version_create 直写绕开网关，网关保留 BYO-key | 详版 workspace/00-architecture/ADR-017-local-first-mcp.md；用户裁决三分叉（本地优先+可选同步 / 冻结 Tauri headless / 通用 MCP+薄插件） | 2026-11-25 |
