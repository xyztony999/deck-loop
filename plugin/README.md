# deck-loop ZCode 插件（薄包装）

通用 stdio MCP server（`../mcp-server`）+ deck-loop skill + `/new-deck` 命令。
AI 推理在 coding agent 侧（消耗 coding plan），deck-loop 本地出确定性状态机：
不可变版本树、定向调整不变性、headless 三格式导出。零 API key、零服务端依赖。

## 本地安装（仓库内开发）

插件经 `${ZCODE_PLUGIN_ROOT}/../mcp-server/dist/main.js` 引用同仓 MCP server，
须先构建：

```bash
cd mcp-server && pnpm install && pnpm build
```

然后在 ZCode 插件设置里从本目录（`plugin/`）加载，或将本目录加入插件搜索路径。

## 分发打包（后续）

marketplace 分发需把 mcp-server 运行时 bundled 进插件目录（dist + node_modules
或单文件打包），并把 plugin.json 的 args 改为 `${ZCODE_PLUGIN_ROOT}/dist/main.js`。
本期仅仓库内形态。

## 数据

`~/.deck-loop/`（env `DECK_LOOP_HOME` 覆盖）：SQLite 库 + 素材 + 导出产物 + HTML 预览。
与线上服务端同构的实体——可选同步（ADR-017 Phase 4）预留，本期不实施。

许可证：AGPL-3.0-only（与主仓一致）。