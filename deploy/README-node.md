# deck-loop 后端部署 — Node/NestJS 版

> v3 技术栈。v1 的 Java 部署说明已随 v1 归档作废；Nginx 反代配置（deploy/nginx-deck-loop.conf）**继续可用**（同为 8080 端口，SSE 段已调优）。

## 运行时

- **Node 24（LTS）** 为部署目标（宝塔 Node 版本管理器安装）；工程 `engines.node >= 20`，开发机 22 与服务器 24 同源验证

## 拓扑

```
客户端 ──HTTPS 443──> 宝塔 Nginx(/api 反代) ──> deck-loop-core(Node, 8080) ──> 服务器既有 MongoDB
```

## 1. 服务器准备（宝塔）

1. 宝塔 → 软件商店 → **Node 版本管理器**：安装 **Node 24**（当前 LTS，部署目标版本；工程 engines 下限 >=20，本机 22 开发同源）
2. MongoDB：**用服务器既有实例**，为其建库（你的既有实例若带认证，用管理员建）：
   ```bash
   mongosh -u <管理员> -p --authenticationDatabase admin --eval 'db.getSiblingDB("deck_loop").createUser({user:"deck",pwd:"<密码>",roles:[{role:"readWrite",db:"deck_loop"}]})'
   ```
   索引随服务启动自动建（schema 声明式），无需手工导 DDL

## 2. 上传工程

```bash
# 本机打包（不含 node_modules）
cd server-node && npm run build   # 确认 dist/ 最新
tar --exclude node_modules --exclude .git -czf ../deck-node.tgz .
# 上传 deck-node.tgz 到服务器 /opt/deck-loop-node/ 后解压
cd /opt/deck-loop-node && npm ci --omit=dev
```

## 3. 环境变量（/opt/deck-loop-node/.env，宝塔 Node 项目界面或 PM2 ecosystem 填）

```ini
PORT=8080
MONGODB_URI=mongodb://deck:<密码>@127.0.0.1:27017/deck_loop?authSource=deck_loop
AUTH_TOKEN_SECRET=<随机长串>
EXPORT_SIGN_SECRET=<随机长串>
ASSET_URL_SECRET=<随机长串>
ASSET_STORAGE_DIR=/opt/deck-loop-node/data/assets
# AI 渠道（可选；不配则只有内置 MOCK 渠道）
# GATEWAY_CHANNELS=[{"channelCode":"zhipu","channelName":"智谱","priority":10,"baseUrl":"https://open.bigmodel.cn/api/paas/v4","apiKeyEnv":"ZHIPU_API_KEY","models":[{"modelCode":"glm-4.6","modelName":"GLM-4.6","capabilityTags":["OUTLINE","FULL_GENERATE","FULL_ADJUST","TARGETED_ADJUST"],"enabled":true}]}]
# ZHIPU_API_KEY=sk-xxx
```

生成随机串：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 4. 起服务（宝塔「Node 项目」二选一）

- **宝塔方式**：网站 → Node 项目 → 添加：项目目录 /opt/deck-loop-node、启动选项 `dist/main.js`（或 `npm run start:prod`）、Node 版本 24、端口 8080、开启外网映射=否（走 Nginx）、环境变量按上节填入
- **PM2 方式**（宝塔 Node 管理器内置）：
  ```bash
  pm2 start dist/main.js --name deck-loop-core --max-memory-restart 300M
  pm2 save && pm2 startup
  ```

内存参考：Node 进程 ~120-200MB（`--max-memory-restart 300M` 兜底）——对比 v1 JVM 数百 MB，1GB 小机无压力。

## 5. Nginx（复用既有配置）

此前配置的 `api.<你的域名>` 站点 + `deploy/nginx-deck-loop.conf` 的 `location /api/ {...}` **原样沿用**（8080 不变、SSE 段已含 `proxy_buffering off`）。若当时未配：站点 → 配置文件粘贴该文件内容。

## 6. 验证

```bash
curl -s https://api.<你的域名>/api/auth/account/profile
# 预期 {"status":false,"code":"BIZ_AUTH_SESSION_EXPIRED",...} JSON（HTTP 200）
```

客户端本机 `cd client && pnpm dev`（代理已指向该域名）→ 注册开测。

## 运维要点

- **更新版本**：本地 `npm run build` → 打包 `dist/ + package.json + pnpm-lock?`（或整包）上传 → `npm ci --omit=dev` → `pm2 restart deck-loop-core`
- **备份**：`mongodump --db deck_loop` + `/opt/deck-loop-node/data/assets/` 目录（素材文件不在库里）
- **日志**：`pm2 logs deck-loop-core`（宝塔 Node 项目界面可看）
- **单实例假设**：会话撤销表/网关排队/登录失败计数在内存——只跑一个实例；多实例前需引 Redis（代码已注释演进点）

## 导出渲染（ADR-015：客户端渲染，2026-10-20 起）

导出（PDF/图片/PPTX）渲染在**客户端**执行（Tauri WebView2 原生打印/截图 +
pptxgenjs），服务器**零渲染依赖**——无需 Chromium、无需安装 CJK 字体、无需 swap
扩容，1GB 小内存服务器彻底解套。

服务端仅接收产物回传（`POST /deliver/export/upload`，multipart）：

- **EXPORT_ARTIFACT_MAX_MB**：产物大小上限（默认 50MB；multer limits 与 Service
  双重校验，超限拒绝 BIZ_EXPORT_UPLOAD_INVALID）。
- 产物落盘 `EXPORT_ARTIFACT_DIR`（默认 `./data/exports`），魔数白名单校验
  （PDF=`%PDF-`、PPTX/图片包 ZIP=`PK`）。
- 桌面端为 Windows 先行（WebView2 PrintToPdf/CapturePreview），其余平台渲染
  命令返回「暂不支持」（后续增量）。
