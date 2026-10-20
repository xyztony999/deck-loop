# Deck-Loop — AI 内容创作语言迭代客户端

用自然语言驱动 AI 生成演示文稿类内容（多形态抽象，首期演示文稿），并以**语言指令**持续微调：整稿级与定向级（选中某页/文本块/图片元素）调整、版本树自动留档（可对比/回退/分叉）、品牌规范与话术沉淀、定稿导出（PDF/图片，PPTX beta）与内置演示。

**形态**：桌面客户端（Vue3 + Ant Design Vue + Tauri 2）+ 云端单服务（NestJS 10 `deck-loop-core` + MongoDB，AI 多 provider 网关统一收口），多端同步保留。

## 仓库状态

**v3 已交付**（2026-10-09，Gate 2 PASS 并通过测试环境验收）：

| 内容 | 路径 |
|------|------|
| 云端服务（NestJS + Mongoose，8 领域模块，65 HTTP 端点 + SSE） | `server-node/` |
| 桌面客户端（Vue3 + AntdV 4 暗色主题 + Tauri 2） | `client/` |
| 部署产物（Node 部署手册 / Nginx 反代 / systemd / 环境样例） | `deploy/` |
| 品牌 kit（logo/icon/favicon 等，logoloom 产出） | `assets/brand/` |
| 设计文档（架构 / 8 PRD / 8 API / 7 PageSpec / Gate 报告） | `profiles/deck-loop/workspace/` |

后端测试：10 套件 / 70 用例（Mongo Memory ReplSet）。支持反代部署（Nginx 前缀剥离 + SSE 透传，见 `deploy/README-node.md`）。

### 沿革

| 代际 | 状态 | 说明 |
|------|------|------|
| v1（Spring Boot + MySQL 微服务） | 已废弃移除 | 小内存服务器部署 OOM，架构打回 |
| v3（Node 24 / NestJS + MongoDB） | **当前** | 契约冻结复用 v1 全部 65 端点，前端代码近乎 100% 复用 |

## 本地开发

```bash
# 后端（Node >= 20，读 .env，缺省 8080）
cd server-node && npm i && npm run build && npm run start:dev

# 客户端（Vite dev 5173，DECK_API_TARGET 指向后端）
cd client && npm i && npm run tauri dev
```

生产部署见 `deploy/README-node.md`（宝塔 Node 项目 + 既有 MongoDB 副本集 + Nginx 前缀剥离与 SSE 透传）。

## 引擎绑定

- 业务 profile：`deck-loop`（`profiles/deck-loop/profile.yaml`）
- 技术栈：`node-nestjs-mongo` + `vue3-engine`（v3.1 设计重定向，v1 的 java-microservice 绑定已废止）
- 激活/摘除：`node <引擎仓>/engine/cli/bin/engine-cli.js use deck-loop --root <本仓>` / `off`

## 许可证

[AGPL-3.0-only](LICENSE) © 2026 Xinyi Zhang —— 衍生与网络服务部署同样须开源修改。
