# deck-loop 插件 · agent 驱动幻灯片创作

coding agent 出推理（消耗你的 coding plan），deck-loop 出确定性状态机：不可变版本树、
定向调整不变性、headless PDF/PNG/PPTX 导出。**零 API key、零 LLM 调用**。

## 双模式

- **本地（默认）**：开箱即用，sql.js 本地库 `~/.deck-loop/`，零服务端、全平台通用。
- **远程**：`remote_connect` 登录你自己的 deck-loop 账号（apiUrl + 邮箱 + 密码）→
  自动签发个人 token → 与网站同库实时。密码仅内存使用，绝不落盘；token 存
  `~/.deck-loop/config.json`。`remote_disconnect` 回本地，`connection_status` 查状态。

## 安装

### ZCode / Claude Code（市场，推荐）

```
/plugin marketplace add xyztony999/deck-loop
/plugin install deck-loop@deck-loop
```

更新：`/plugin marketplace update deck-loop` 后重装。市场清单指向 GitHub Release
的自包含 zip（CI tag 自动构建发布，sha256 校验）。

### Cursor / Codex / 其它 MCP 客户端

下载 Release 的 `deck-loop-plugin-<v>.zip` 解压，MCP 配置指向包内 `server.cjs`：

```json
{
  "mcpServers": {
    "deck-loop": {
      "command": "node",
      "args": ["/绝对路径/deck-loop-plugin/server.cjs"]
    }
  }
}
```

需 Node ≥ 20。导出 PDF/PNG 用系统浏览器（Edge/Chrome，playwright-core 自动探测）。

### 仓库内开发

`cd mcp-server && pnpm i && pnpm build`，plugin.json 的 mcpServers 指向
`../mcp-server/dist/main.js`（env `DECK_LOOP_MODE=local|remote` 驱动，与市场包
config 驱动并存）。市场包构建：`node scripts/build-marketplace.mjs`。

## 数据与许可

本地库/素材/产物/预览：`~/.deck-loop/`（`DECK_LOOP_HOME` 覆盖）。
许可证 AGPL-3.0-only（与主仓一致）。