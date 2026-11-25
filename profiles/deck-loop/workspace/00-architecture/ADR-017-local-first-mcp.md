# ADR-017 · 本地优先 MCP + 薄 ZCode 插件（coding plan 原生形态）

- 状态：Accepted（2026-11-25，用户裁决三分叉）
- 关联：ADR-005（单用户）、ADR-008（语言指令驱动）、ADR-015（客户端渲染）、ADR-016（PostgreSQL）

## 背景

用户订阅为 coding plan / token plan：订阅 token 限定官方 coding 客户端内使用，
不是通用 API key。原形态（独立 Tauri 客户端 + 服务端 AI 网关裸 Bearer key）与订阅
错配——`url-guard.ts` SSRF 防线亦拒绝环回代理桥接（桥接本身违反订阅条款）。
而 ADR-008「仅自然语言改稿、禁手动像素编辑」天然就是 coding agent 工作流。

## 决策

**让 coding agent 出推理（消耗 coding plan），deck-loop 出确定性状态机。**

1. **本地优先**：deck 状态落本地 SQLite（`~/.deck-loop/`，env `DECK_LOOP_HOME`
   覆盖），与线上 PG 11 表同构；零服务端依赖、零鉴权（固定属主 `local`）。
   可选同步留作 Phase 4（本期仅预留）：届时新增服务端
   `POST /ver/version/agent-create`（个人 API token）+ 复用 ADR-013 游标拉取。
2. **Tauri 客户端移除，headless 导出**：`render-template.ts` 平移至 mcp-server，
   playwright-core + 系统 Edge（channel msedge）出 PDF/逐页 PNG，pptxgenjs 出
   PPTX（fit:shrink 替代 DOM 测量）。ADR-015 删 headless 的理由是 VPS 1GB OOM；
   MCP 跑在本地桌面，不冲突，且换来跨平台。Tauri 三格式手工冒烟被新路径自动冒烟取代。
   **客户端移除（2026-11-25 用户追加裁决）**：能力逐项对账后无本质必要（生成/调整
   =agent 直写、放映=HTML 预览、导出=headless、素材/品牌/话术=MCP tools），
   保留成本实在（CI client 门禁 + Rust WebView2 维护面 + 双形态概念负担）；
   `client/` 删除（git 历史可恢复），CI 改 backend+mcp 双门禁，profile 解绑
   vue3-engine。品牌规范/话术补 brandkit_*/prompt_* tools（服务原挂 AssetModule）。
3. **通用 MCP + 薄 ZCode 插件**：`mcp-server/`（stdio，portable 核心）+
   `plugin/`（`.zcode-plugin/plugin.json` + deck-loop skill + /new-deck 命令）。

## 实现口径（复用最大化，线上零回归）

- **本地运行时在 core 内**（`server-node/src/local/`，纯新增）：Nest application
  context 直挂 deck/version/asset/deliver 四域真实模块（controller 不实例化）。
  避免 typeorm/Nest/reflect-metadata 跨包双实例（元数据同一性断裂）。
- **entity 列类型常量**（`common/db-column-types.ts`）：`DECK_LOOP_DB=sqlite`
  时 jsonb→simple-json、timestamptz→datetime；缺省 PG 类型不变。11 schema 机械替换。
- **SQL 方言翻译**（`local/sqlite-dialect.ts`）：QueryRunner.prototype.query
  唯一漏斗（QB + 原生 query 全覆盖）翻译 $n→?（位次重排）/::int 剥离/
  ILIKE→LIKE+ESCAPE/FOR UPDATE 剥离/GREATEST→MAX/now()→UTC 参数。
  **仓储查询代码零改动**。
- **better-sqlite3 经 options.driver 注入**（TypeORM 原生支持）：core 依赖树
  不引 native 驱动；mcp-server 声明 better-sqlite3。
- **agent 直写路径**：`version_create` → VersionArchiveCommand →
  VersionArchiveService.createVersionFromTask（单事务归档 + 移指针 + 引用计数），
  完全绕开网关。taskId 合成 `agent-<snowflake>`；首版后 onFirstVersionCreated
  流转 DRAFT→ITERATING；定向调整强制 assertTargetedInvariance（基线固化进快照）。
- **导出复用 ExportService 全状态机**：submit（FINALIZED 守卫 + INV-14）→
  本地渲染 → uploadArtifact（魔数/大小 + SUCCEEDED 落账）/ reportFailure。
- **网关保留**为可选 BYO-key（MOCK 缺省），线上服务/CD/部署不动。
- core 开启 declaration emit（被 mcp 作为库消费；纯新增构建产物）。
- mcp-server 对 core 用 `link:`（`file:` 会按 pack 语义排除 gitignore 的 dist）。

## 验证

- server-node：16 suites / 107 cases（pg-mem）+ build 全绿（微创未伤 PG 路径）。
- mcp-server：2 suites / 19 cases——SQLite in-memory 全流程（状态机/不变性
  pass+越界/版本树/引用计数）+ 真实 Edge headless 三格式冒烟（魔数/中文/图片/落账）。

## 影响

- AGPL-3.0-only 不变，插件同许可证。
- `client/` 移除（含 export_renderer.rs；git 历史可恢复）；README 陈旧 MongoDB 表述已修正。
- 产品定位不变（ADR-008）——MCP 是其最纯实现，非方向背叛。