# Deck-Loop — agent 驱动演示文稿创作 + Web 管理站

用自然语言驱动 AI 生成演示文稿类内容（多形态抽象，首期演示文稿），并以**语言指令**持续微调：整稿级与定向级（选中某页/文本块/图片元素）调整、版本树自动留档（可对比/回退/分叉）、品牌规范与话术沉淀、定稿导出（PDF/图片，PPTX beta）与演示放映。

**形态**（ADR-018）：**coding agent 创作 + Web 管理站，云端 PG 单源**。AI 产出交 coding agent（ZCode 等，消耗 coding plan）经 MCP 直写；`web/` 管理素材与产出内容（Vue3 + AntdV，浏览器侧预览放映 + 产物下载）；`mcp-server/` 双模式（`DECK_LOOP_MODE=local|remote`，远程与网站同库实时读写，本地 SQLite 离线可选）；`plugin/` ZCode 薄包装。云端单服务（NestJS 10 + PostgreSQL/TypeORM，56 端点）为唯一数据源，**零 AI 网关、零服务端渲染**。Tauri 桌面客户端已移除（git 历史可恢复）。

## 仓库状态

**v3 已交付**（2026-10-09，Gate 2 PASS 并通过测试环境验收）：

| 内容 | 路径 |
|------|------|
| Web 管理站（Vue3 + AntdV 4 暗色，素材/Deck/版本树/预览/下载/token；ADR-018） | `web/` |
| MCP server（28 tools，local/remote 双模式，headless 三格式导出；ADR-017/018） | `mcp-server/` |
| ZCode 插件薄包装（MCP 配置 + deck-loop skill + /new-deck） | `plugin/` |
| 云端服务（NestJS + TypeORM/PostgreSQL，5 域 56 端点，PG 单源；ADR-018） | `server-node/` |
| 部署产物（Node 部署手册 / Nginx web 静态站 + 反代 / 环境样例 / 迁移脚本） | `deploy/` |
| 品牌 kit（logo/icon/favicon 等，logoloom 产出） | `assets/brand/` |
| 设计文档（架构 / PRD / API / PageSpec / Gate 报告） | `profiles/deck-loop/workspace/` |

测试：后端 16 套件 / 105 用例（pg-mem）+ MCP 3 套件 / 32 用例（local 含真实 Edge headless 三格式 + remote 真实 HTTP）+ web 行为测试 5/5 与 typecheck/build 三绿。部署见 `deploy/README-node.md`（Nginx web 静态站 + /api 反代；迁移脚本 migrate-web-agent）。

### 沿革

| 代际 | 状态 | 说明 |
|------|------|------|
| v1（Spring Boot + MySQL 微服务） | 已废弃移除 | 小内存服务器部署 OOM，架构打回 |
| v3（Node 24 / NestJS + MongoDB） | 已被 ADR-016 修订 | 契约冻结复用 v1 全部端点，前端代码近乎 100% 复用 |
| v3.1（PostgreSQL/TypeORM，ADR-016） | **当前·云端** | 对外 API 契约零变化、客户端零变化 |
| v3.2（本地优先 MCP + 薄插件，ADR-017） | 已被 ADR-018 演进 | agent 直写绕开网关，coding plan 原生；Tauri 客户端移除 |
| v3.3（Web 管理站 + PG 单源 + MCP 远程 + 网关移除，ADR-018） | **当前** | 网站管理 / agent 创作同库实时；56 端点；个人 API token |

## 安装插件（ZCode / Claude Code / Cursor / Codex）

主仓即市场。**ZCode**：设置 → 插件管理 → **发现** Tab → 点 **`+`** → 输入
`xyztony999/deck-loop` → deck-loop 卡片点 **获取**（默认启用；更新同页重取）。
**Claude Code**：`/plugin marketplace add xyztony999/deck-loop` → `/plugin install deck-loop@deck-loop`。

Cursor / Codex 等：下载 [Release](https://github.com/xyztony999/deck-loop/releases) 的
`deck-loop-plugin-<v>.zip` 解压，MCP 配置指向包内 `server.cjs`（Node ≥ 20）。
详见 [plugin/README.md](plugin/README.md)。

插件双模式：**本地**开箱即用（sql.js，零服务端）；**远程**用 `remote_connect`
登录你自己的 deck-loop 账号（与网站同库实时，密码不落盘）。CI tag 自动构建发布
（`release-plugin.yml`：bundle→zip→Release→marketplace.json sha256 回写）。

## 本地开发

```bash
# 后端（读 .env，缺省 8080；PG 单源，DATABASE_URL）
cd server-node && pnpm i && pnpm build && pnpm run start:dev

# Web 管理站（dev 5173，vite 代理 /api → 后端）
cd web && pnpm i && pnpm dev

# MCP（Node >= 20，pnpm 10）
cd mcp-server && pnpm i && pnpm build
pnpm start                                          # local 模式（缺省）：~/.deck-loop/ SQLite
DECK_LOOP_MODE=remote DECK_LOOP_API_URL=https://api.<域名>/api \
  DECK_LOOP_API_TOKEN=dlpat_... pnpm start          # remote：与网站同库（设置页签发 token）
```

生产部署见 `deploy/README-node.md`（宝塔 Node 项目 + PostgreSQL + Nginx web 静态站 + /api 反代；上线先跑 `migrate-web-agent --dry-run`）。

## 引擎绑定

- 业务 profile：`deck-loop`（`profiles/deck-loop/profile.yaml`）
- 技术栈：`node-nestjs-psql`（ADR-016；profile depends 更名待收尾）；`vue3-engine` 随客户端移除解绑（ADR-017），v1 的 java-microservice 绑定早已废止
- 激活/摘除：`node <引擎仓>/engine/cli/bin/engine-cli.js use deck-loop --root <本仓>` / `off`

## 许可证

[AGPL-3.0-only](LICENSE) © 2026 Xinyi Zhang —— 衍生与网络服务部署同样须开源修改。
