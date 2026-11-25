# deck-loop 后端部署 — Node/NestJS 版

> v3 技术栈。v1 的 Java 部署说明已随 v1 归档作废；Nginx 配置（deploy/nginx-deck-loop.conf）
> 自 ADR-018 起含 **web 静态站 + /api 反代**两段（SSE 段已随 AI 网关退役删除）。
> web 管理站部署见下文「Web 管理站部署（ADR-018）」节。

## 运行时

- **Node 24（LTS）** 为部署目标（宝塔 Node 版本管理器安装）；工程 `engines.node >= 20`，开发机 22 与服务器 24 同源验证

## 拓扑

```
浏览器 ──HTTPS 443──> 宝塔 Nginx ┬─ /（web 静态站，SPA 兜底）──> /www/wwwroot/deck-loop-web（dist 静态文件）
                               └─ /api 反代 ──> deck-loop-core(Node, 18080) ──> PostgreSQL（deck_loop 库；与 UniGate 共实例不同 database）
coding agent ──MCP 远程模式（X-Api-Token）──> /api（同一反代；ADR-018 §4.2）
```

> **ADR-016（2026-11-24）**：持久层已由 MongoDB 迁至 PostgreSQL（TypeORM）。服务器只跑**一个数据库进程**；
> MongoDB 已于 2026-11-24 完成迁移并从服务器**卸载**（下文「PostgreSQL 切换 runbook」保留为流程存档）。

## 1. 服务器准备（宝塔）

1. 宝塔 → 软件商店 → **Node 版本管理器**：安装 **Node 24**（当前 LTS，部署目标版本；工程 engines 下限 >=20，本机 22 开发同源）
2. PostgreSQL：宝塔软件商店安装 **PostgreSQL**（或 `apt install postgresql`），建库建用户：
   ```bash
   sudo -u postgres psql -c "CREATE USER deck_loop WITH PASSWORD '<密码>';"
   sudo -u postgres psql -c "CREATE DATABASE deck_loop OWNER deck_loop;"
   # UniGate 同理另建库：CREATE DATABASE unigate OWNER unigate;（共实例，省一个数据库进程的内存）
   ```
   表/索引**不随应用启动自动建**（运行时 `synchronize=false` 红线）：首次由 `node dist/scripts/init-schema.js`
   一次性建表（见 runbook）；此后 schema 变更走显式脚本。密码建议用 hex（避免 URL 编码问题）

## 2. 上传工程

```bash
# 本机打包（不含 node_modules）
cd server-node && npm run build   # 确认 dist/ 最新
tar --exclude node_modules --exclude .git -czf ../deck-node.tgz .
# 【自动部署】main push 且三门禁全绿时，CI 自动完成：上传 → 备份（/www/backup/deck-loop，
# 留 5 份）→ 解包 → pnpm install --prod → 重启（杀进程由宝塔守护拉起，兜底手动 nohup）
# → 健康检查（18080 /auth/login 探活）→ 失败自动回滚最近备份。手工介入仅在排查时需要。
#
# 【手工获取包】GitHub 仓库 → Actions → 最新 CI 运行 → Artifacts
# 下载 deck-loop-backend-deploy（deck-node-<sha>.tgz），上传到 /www/wwwroot/deck-loop/ 解压
cd /www/wwwroot/deck-loop && npm ci --omit=dev
```

## 3. 环境变量（/www/wwwroot/deck-loop/.env，宝塔 Node 项目界面或 PM2 ecosystem 填）

```ini
PORT=18080
HOST=127.0.0.1
# PostgreSQL（ADR-016；密码仅存本文件，不入仓库）
DATABASE_URL=postgresql://deck_loop:<密码>@127.0.0.1:5432/deck_loop
AUTH_TOKEN_SECRET=<随机长串>
EXPORT_SIGN_SECRET=<随机长串>
ASSET_URL_SECRET=<随机长串>
ASSET_STORAGE_DIR=/www/wwwroot/deck-loop/data/assets
# ADR-018：AI 网关/渠道域退役——CONFIG_ENC_KEY / GATEWAY_CHANNELS / GLM_API_KEY
# 不再消费（旧 .env 中残留可删）；AI 产出唯一路径 = coding agent 经 MCP 直写。
# 可选：AGENT_CONTENT_MAX_MB（agent-create content 上限，缺省 2）
```

生成随机串：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 4. 起服务（宝塔「Node 项目」二选一）

- **宝塔方式**：网站 → Node 项目 → 添加：项目目录 /www/wwwroot/deck-loop、启动选项 `dist/main.js`（或 `npm run start:prod`）、Node 版本 24、端口 8080、开启外网映射=否（走 Nginx）、环境变量按上节填入
- **PM2 方式**（宝塔 Node 管理器内置）：
  ```bash
  pm2 start dist/main.js --name deck-loop-core --max-memory-restart 300M
  pm2 save && pm2 startup
  ```

内存参考：Node 进程 ~120-200MB（`--max-memory-restart 300M` 兜底）——对比 v1 JVM 数百 MB，1GB 小机无压力。

## 5. Nginx（复用既有配置）

`deploy/nginx-deck-loop.conf` 的 `location /api/ {...}` 反代规则**沿用**（18080 不变）。
ADR-018 变更：SSE 嵌套段（`/api/gw/task/stream`）已删除——旧站点配置里若仍有该段请移除；
推荐改用 conf 内 A 段「web 静态站」单站同源拓扑（web + /api 同一域名）。

## 6. 验证

```bash
curl -s https://api.<你的域名>/api/auth/account/profile
# 预期 {"status":false,"code":"BIZ_AUTH_SESSION_EXPIRED",...} JSON（HTTP 200）
```

本地 MCP 开测（ADR-017，推荐形态）：`cd mcp-server && pnpm i && pnpm build && pnpm start`，
经 ZCode 插件（`plugin/`）或任意 MCP 客户端接入；数据落本机 `~/.deck-loop/`，不依赖本服务端。
云端服务保留为可选 BYO-key 网关 + 后续可选同步（Phase 4）底座。

> Tauri 桌面客户端已于 ADR-017 移除（git 历史可恢复）；原「安装版 API 基址注入」
> 注意事项随之作废。

## Web 管理站部署（ADR-018，web-mgmt-20261125）

web/ 为纯 Web 管理站（Vue3 + AntdV4，779f3d6 client/ 恢复剥 Tauri）：四功能组
（素材/Deck/版本树/预览放映+导出下载）直读直写云端 PG；**服务端零渲染**——预览/放映
在浏览器侧经共享 render-template 渲染，导出由 MCP 本地 headless 完成后回传。

### 构建

```bash
cd web
pnpm install          # pnpm 10
pnpm typecheck && pnpm test && pnpm build   # 三绿后产物在 web/dist/
```

- **同源部署（推荐）**：无需任何 env——API 基址缺省相对 `/api`，由 Nginx 反代。
- **跨源部署**：构建前写 `web/.env.production`（gitignore）：
  `VITE_API_BASE_URL=https://api.<你的域名>/api`，再 `pnpm build`。
- 渲染模板经 TS 路径别名 `@render` 共享 `mcp-server/src/render/render-template.ts`
  （纯 TS 零 node 依赖）——构建机需保留仓库相对目录结构（web/ 与 mcp-server/ 同级）。

### 上传与 Nginx

```bash
# 产物上传（静态文件，无 node_modules/进程）
tar -czf deck-web.tgz -C web/dist .
# 服务器：mkdir -p /www/wwwroot/deck-loop-web && tar -xzf deck-web.tgz -C /www/wwwroot/deck-loop-web
```

宝塔添加**纯静态站点**（根目录 /www/wwwroot/deck-loop-web），配置文件采用
`deploy/nginx-deck-loop.conf` A 段：SPA history 兜底（`try_files ... /index.html`）
+ `/assets/` 长缓存 + `location /api/` 反代 18080（`client_max_body_size 60m` 覆盖
素材上传/产物回传）。SSL 由宝塔签发。

### 验证

1. 浏览器打开站点 → 未登录跳 `/auth`；注册/登录 → `/deck` 列表。
2. 设置 → API token → 签发（明文仅显示一次）→ 配置到 MCP 远程模式
   （`DECK_LOOP_MODE=remote` + `DECK_LOOP_API_URL=https://<域名>/api` + `DECK_LOOP_API_TOKEN`）。
3. 深链刷新（如 `/deck/<id>`、`/assets?tab=prompt`）不回 404（SPA 兜底生效）。

## 运维要点

- **更新版本**：本地 `npm run build` → 打包 `dist/ + package.json + pnpm-lock?`（或整包）上传 → `npm ci --omit=dev` → `pm2 restart deck-loop-core`
- **备份**：`pg_dump -U deck_loop -h 127.0.0.1 deck_loop | gzip > deck_loop-$(date +%F).sql.gz` + `/www/wwwroot/deck-loop/data/assets/` 目录（素材文件不在库里）
- **日志**：`pm2 logs deck-loop-core`（宝塔 Node 项目界面可看）
- **单实例假设**：会话撤销表/登录失败计数在内存——只跑一个实例；多实例前需引 Redis（代码已注释演进点）。个人 API token 校验每次查库（吊销即时生效，无内存撤销表，ADR-018）
- **web 更新**：本地 `pnpm build` → dist/ 打包上传覆盖 /www/wwwroot/deck-loop-web（纯静态，无需重启任何进程）

## PostgreSQL 切换 runbook（ADR-016，一次性；破坏性步骤均需人工确认）

目标：线上**零停机准备 + 一次重启切换**；Mongo 数据全程只读不动。

```bash
# A. 准备（应用仍跑在 Mongo 上，无影响）
#   1. 装 PostgreSQL + 建库建用户（见 §1）
#   2. /www/wwwroot/deck-loop/.env 追加 DATABASE_URL（MONGODB_URI 暂留，供迁移脚本读源）
printf '\nDATABASE_URL=postgresql://deck_loop:<密码>@127.0.0.1:5432/deck_loop\n' >> /www/wwwroot/deck-loop/.env
#   3. 新构建的部署包解到【暂存目录】（不动线上目录）
mkdir -p /www/wwwroot/deck-loop-staging && tar -xzf /tmp/deck-loop-deploy/<新包>.tgz -C /www/wwwroot/deck-loop-staging

# B. 建表 + 干跑（只读 Mongo，不写 PG）
cd /www/wwwroot/deck-loop && node server-node/dist/scripts/init-schema.js          # 目标库非空会拒绝
node server-node/dist/scripts/migrate-mongo-to-pg.js --dry-run                      # 逐表行数/样本/丢弃键

# C. 迁移 + 校验（幂等，可重跑追平切换窗口内的新写入）
node server-node/dist/scripts/migrate-mongo-to-pg.js                               # 聚合不一致退出码 1

# D. 切换（一次重启，秒级中断）——需确认后执行
#   暂存包替换线上目录（同 deploy.sh 解包：--no-same-owner + chown www）
#   → su -s /bin/bash www -c 'cd /www/wwwroot/deck-loop && nohup node server-node/dist/main.js >> /www/wwwlogs/deck-loop-cd.log 2>&1 &'
curl -s -X POST https://api.deckloop.tonyxyz.cn/api/auth/account/login \
  -H 'Content-Type: application/json' -d '{"email":"health@check","password":"x"}'
#   期望 BIZ_AUTH_CREDENTIALS（证明 PG 往返）；再用真实账号登录核对创作物/版本/渠道俱在

# E. 收尾（观察 1-2 天后，单独授权）
#   合并分支到 main（CD 接管）→ .env 移除 MONGODB_URI → 面板停 mongod → 回收 mongodb 依赖
```

**回滚**：D 步失败 → 线上目录换回旧包（旧包只认 `MONGODB_URI`）→ 重启即回 Mongo；Mongo 数据未动。
（切换后新应用写入 PG 的数据不会回灌 Mongo——测试环境可接受，切换后请尽快验证。）

## 导出渲染（ADR-015 服务端零渲染依赖；ADR-017 起本地 headless）

导出（PDF/图片/PPTX）渲染在**用户本地**执行（ADR-017：MCP 进程内 playwright-core
系统 Edge + pptxgenjs；原 Tauri WebView2 路径已随客户端移除），服务器**零渲染依赖**
——无需 Chromium、无需安装 CJK 字体、无需 swap 扩容，1GB 小内存服务器彻底解套。

服务端仅接收产物回传（`POST /deliver/export/upload`，multipart）：

- **EXPORT_ARTIFACT_MAX_MB**：产物大小上限（默认 50MB；multer limits 与 Service
  双重校验，超限拒绝 BIZ_EXPORT_UPLOAD_INVALID）。
- 产物落盘 `EXPORT_ARTIFACT_DIR`（默认 `./data/exports`），魔数白名单校验
  （PDF=`%PDF-`、PPTX/图片包 ZIP=`PK`）。
- 网站侧**无导出发起入口**（ADR-018）：导出记录页仅下载已回传产物；预览/放映
  为浏览器侧渲染（web/src/render 共享 render-template），不请求任何渲染端点。
