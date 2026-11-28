# deck-loop 插件 · agent 驱动幻灯片创作

coding agent 出推理（消耗你的 coding plan），deck-loop 出确定性状态机：不可变版本树、
定向调整不变性、headless PDF/PNG/PPTX 导出。**零 API key、零 LLM 调用**。

## 双模式与配置

- **本地（默认）**：开箱即用，sql.js 本地库 `~/.deck-loop/`，零服务端、全平台通用。
- **远程**：与你的 deck-loop 系统（网站）同库实时。三种配置方式，优先级
  **env > config.json > 默认 local**：

**① 浏览器授权（推荐，所有工具通用）**：跟 agent 说「连接我的 deck-loop 系统」或用
`/deck-connect` 命令，只提供 API 基址 → 插件自动打开网站授权页 → 你在**自己系统上**
登录确认（passkey 可用）→ token 自动回传本机。**凭据完全不进对话**。
存 `~/.deck-loop/config.json`，此后每次启动自动远程。`remote_disconnect` 回本地，
`connection_status` 查状态。

**② MCP 配置 env 预置（Cursor / Codex / ZCode 高级）**：在工具的 MCP 配置 env
字段填 `DECK_LOOP_API_URL`（如 `https://host/api`）+ `DECK_LOOP_API_TOKEN`
（网站设置页签发的 `dlpat_`）。env 优先于 config.json，适合集中管理/多机部署。

**③ 手动 config.json**：`~/.deck-loop/config.json` 写
`{"mode":"remote","apiUrl":"https://host/api","token":"dlpat_..."}`。

```jsonc
// Cursor / Codex MCP 配置示例（方式②）
{
  "mcpServers": {
    "deck-loop": {
      "command": "node",
      "args": ["/路径/deck-loop-plugin/server.cjs"],
      "env": {
        "DECK_LOOP_API_URL": "https://api.<你的域名>/api",
        "DECK_LOOP_API_TOKEN": "dlpat_..."
      }
    }
  }
}
```

不填任何配置 = 本地模式。ZCode/Claude 市场安装后 MCP 自动接线，方式①最省事。

## 安装

### ZCode（界面市场，推荐）

设置 → 插件管理 → **发现** Tab → 点 **`+`** → 输入 `xyztony999/deck-loop` →
deck-loop 卡片点 **获取**（默认启用；更新在发现页重取）。加 GitHub 源克隆失败时
设置 `ZCODE_HTTP_PROXY=http://127.0.0.1:10808`（ZCode 只认这个变量）。

### Claude Code（命令）

```
/plugin marketplace add xyztony999/deck-loop
/plugin install deck-loop@deck-loop
```

市场清单指向 GitHub Release 的自包含 zip（CI tag 自动构建发布，sha256 校验）。

### Cursor / Codex / 其它 MCP 客户端

MCP 配置直接用 npm 包（无需下载 zip）：

```json
{
  "mcpServers": {
    "deck-loop": {
      "command": "npx",
      "args": ["-y", "deck-loop-mcp"]
    }
  }
}
```

- **Windows 的 Cursor/Codex 若启动失败**：`npx` 是 `.cmd` 脚本，部分客户端在
  Windows 上无法直接 spawn，改为 `"command": "cmd", "args": ["/c", "npx", "-y", "deck-loop-mcp"]`。
- **Codex CLI**（config.toml）：
  ```toml
  [mcp_servers.deck-loop]
  command = "npx"
  args = ["-y", "deck-loop-mcp"]
  ```
  （Windows 同上，command 用 `cmd`，args 前加 `/c`。）
- 技能文件（可选）：把包内 `skills/deck-loop` 拷到 `~/.codex/skills/` 或
  `.cursor/skills/`，agent 工作流引导更顺。
- 需 Node ≥ 20。导出 PDF/PNG 用系统浏览器（Edge/Chrome 自动探测）。
- 装好后对话里说「连接我的 deck-loop 系统」完成浏览器授权，或直接本地创作。

### 仓库内开发

`cd mcp-server && pnpm i && pnpm build`，plugin.json 的 mcpServers 指向
`../mcp-server/dist/main.js`（env `DECK_LOOP_MODE=local|remote` 驱动，与市场包
config 驱动并存）。市场包构建：`node scripts/build-marketplace.mjs`。

## 数据与许可

本地库/素材/产物/预览：`~/.deck-loop/`（`DECK_LOOP_HOME` 覆盖）。
许可证 AGPL-3.0-only（与主仓一致）。