# ADR-019 · 双模式市场包 + 主仓即市场（2026-11-27）

- 状态：Accepted（用户裁决：插件做本地+远程双模式，远程登录用户自己的 deck-loop 账号）
- 关联：ADR-017（MCP+插件）、ADR-018（PG 单源+Web+远程）

## 背景

ADR-018 后插件分发提上日程。用户裁决：市场版插件保留**本地+远程双模式**，
远程不是手动贴 token，而是**登录用户自己的 deck-loop 账号**（自动签发 token）。
本地模式让插件开箱即用（零服务端），远程模式与网站同库实时。

## 决策

1. **双模式动态缝**：`SwitchableBackend implements ToolBackend`，按
   `~/.deck-loop/config.json` 持 local（懒加载）或 remote 委托，运行时可切；
   28 业务 tools 无感知。新增 3 连接 tools：`remote_connect`（登录→自动签发
   个人 token→落盘→切 remote，**密码永不落盘**）/ `remote_disconnect` /
   `connection_status`。共 31 tools。
2. **本地引擎换 sql.js（wasm）**：TypeORM sqljs 驱动接收已初始化 SQL 对象
   （宿主 initSqlJs({locateFile})），wasm 随包，全平台通用单 zip；
   better-sqlite3 降为仓库开发/测试可选（DECK_LOOP_LOCAL_ENGINE）。
3. **主仓即市场**：根 marketplace.json + .claude-plugin/marketplace.json，
   source={type:zip, url:Release 资产, sha256}。CI `release-plugin.yml`：
   tag v* → esbuild 单文件 bundle（external playwright-core/better-sqlite3/
   Nest 可选模块）+ sql-wasm.wasm + playwright-core 随包 → zip → Release →
   sha256 回写清单提交 main。ZCode/Claude `/plugin marketplace add`；
   Cursor/Codex 下载 zip 配 server.cjs。
4. 仓库 local/remote 固定入口（env 驱动）保留向后兼容；市场包入口
   plugin-main.ts（config 驱动，默认 sqljs）。

## 验证

- mcp 4 suites/38 cases（dual-mode 6：sqljs parity/登录切换/密码不落盘/配置持久化）
- bundle 冷启动 31 tools + 本地 sqljs 建 deck 落盘 ✓
- server-node 105 用例零回归

## 影响

- AGPL-3.0-only；插件同许可证。
- GitHub Releases 重新启用（插件 zip，非客户端安装包——旧客户端 releases 早已随仓库重建清空）。