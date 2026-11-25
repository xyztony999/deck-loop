# Deck-Loop — AI 内容创作语言迭代客户端

用自然语言驱动 AI 生成演示文稿类内容（多形态抽象，首期演示文稿），并以**语言指令**持续微调：整稿级与定向级（选中某页/文本块/图片元素）调整、版本树自动留档（可对比/回退/分叉）、品牌规范与话术沉淀、定稿导出（PDF/图片，PPTX beta）与内置演示。

**形态**（ADR-017）：**本地优先 MCP**——`mcp-server/` + `plugin/`，coding agent 出推理（消耗 coding plan），deck-loop 本地出确定性状态机（SQLite + 不可变版本树 + 定向不变性 + headless 三格式导出），零 API key、零服务端依赖。云端单服务（NestJS 10 `deck-loop-core` + PostgreSQL/TypeORM）保留为可选 BYO-key 网关 + 后续可选同步底座。Tauri 桌面客户端已移除（git 历史可恢复）。

## 仓库状态

**v3 已交付**（2026-10-09，Gate 2 PASS 并通过测试环境验收）：

| 内容 | 路径 |
|------|------|
| 本地 MCP server（headless Nest + SQLite，复用四域模块；ADR-017） | `mcp-server/` |
| ZCode 插件薄包装（MCP 配置 + deck-loop skill + /new-deck） | `plugin/` |
| 云端服务（NestJS + TypeORM/PostgreSQL，8 领域模块，66 HTTP 端点 + SSE） | `server-node/` |
| 部署产物（Node 部署手册 / Nginx 反代 / systemd / 环境样例） | `deploy/` |
| 品牌 kit（logo/icon/favicon 等，logoloom 产出） | `assets/brand/` |
| 设计文档（架构 / 8 PRD / 8 API / 7 PageSpec / Gate 报告） | `profiles/deck-loop/workspace/` |

测试：后端 16 套件 / 107 用例（pg-mem）+ MCP 2 套件 / 19 用例（SQLite in-memory + 真实 Edge headless 三格式冒烟）。支持反代部署（Nginx 前缀剥离 + SSE 透传，见 `deploy/README-node.md`）。

### 沿革

| 代际 | 状态 | 说明 |
|------|------|------|
| v1（Spring Boot + MySQL 微服务） | 已废弃移除 | 小内存服务器部署 OOM，架构打回 |
| v3（Node 24 / NestJS + MongoDB） | 已被 ADR-016 修订 | 契约冻结复用 v1 全部端点，前端代码近乎 100% 复用 |
| v3.1（PostgreSQL/TypeORM，ADR-016） | **当前·云端** | 对外 API 契约零变化、客户端零变化 |
| v3.2（本地优先 MCP + 薄插件，ADR-017） | **当前** | agent 直写绕开网关，coding plan 原生；Tauri 客户端移除 |

## 本地开发

```bash
# 本地 MCP（推荐；Node >= 20，pnpm 10）
cd server-node && pnpm i && pnpm build   # MCP 复用 core 产物
cd ../mcp-server && pnpm i && pnpm build && pnpm start   # stdio；数据 ~/.deck-loop/

# 后端（读 .env，缺省 8080；可选 BYO-key 网关 + 同步底座）
cd server-node && pnpm run start:dev
```

生产部署见 `deploy/README-node.md`（宝塔 Node 项目 + PostgreSQL + Nginx 前缀剥离与 SSE 透传）。

## 引擎绑定

- 业务 profile：`deck-loop`（`profiles/deck-loop/profile.yaml`）
- 技术栈：`node-nestjs-psql`（ADR-016；profile depends 更名待收尾）；`vue3-engine` 随客户端移除解绑（ADR-017），v1 的 java-microservice 绑定早已废止
- 激活/摘除：`node <引擎仓>/engine/cli/bin/engine-cli.js use deck-loop --root <本仓>` / `off`

## 许可证

[AGPL-3.0-only](LICENSE) © 2026 Xinyi Zhang —— 衍生与网络服务部署同样须开源修改。
