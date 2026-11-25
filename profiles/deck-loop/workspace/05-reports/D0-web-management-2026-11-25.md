# D0 需求澄清 · Web 管理站 + PG 单源 + MCP 远程 + 网关移除（2026-11-25）

增量 id：web-mgmt-20261125（模块 deck-loop-full，ADR-018 待 D1 产出）

## 需求原文

> 客户端的一部分功能可以上网站，例如还可以管理素材、管理产出的内容。但 AI 产出的部分
> 直接交类似 ZCode 的 coding agent 执行，这样就不需要什么 AI 网关一类的东西了。

## 澄清决策（主会话 AskUserQuestion，用户裁决）

| # | 分叉 | 决策 |
|---|------|------|
| 1 | 网站与 MCP 的数据关系 | **云端 PG 单源 + MCP 远程模式**：server-node/PG 唯一数据源，网站与 agent 实时读写同一份；MCP 增远程模式（HTTP 客户端 + 个人 API token 鉴权 + 服务端 agent 直写端点）；本地 SQLite 保留为离线可选模式。ADR-017 本地优先部分反转（用户明示演进） |
| 2 | AI 网关移除范围 | **彻底移除**：gateway/channel/generation/adjustment 模块与端点删除（AI 产出唯一路径=agent 直写）；契约破坏性变更入 ADR-018；dl_generation_task 表保留作历史审计 |
| 3 | Web 功能范围 | **四项全选**：素材管理（含品牌规范/话术）、Deck 管理、版本树操作（浏览/对比/回退/分叉）、预览放映（浏览器侧渲染）+ 已导出产物下载。新导出仍由 agent/MCP 触发（服务端零渲染红线不变，ADR-015） |
| 4 | Web 前端技术栈 | **git 历史恢复 Vue3+AntdV+引擎改纯 Web**：被删客户端（commit 779f3d6 含 client/）恢复至 web/，剥 Tauri、改浏览器渲染；ADR-014 设计铁律与暗色设计语言沿用（领导已评审） |

## 派生约束（D1-D4 输入）

- 大纲保存端点现居 generation 域（/gen/outline/save），网关移除后须迁 deck 域。
- MCP 远程模式：28 tools 语义不变，底层由本地域服务直调切换为 HTTP 调用；
  导出渲染仍在 MCP 本地进程（headless），产物经 upload 回传服务端落账。
- 网站鉴权沿用现有会话体系（register/login + X-Auth-Token）；MCP 用个人 API token（新）。
- 同步模块（ADR-013）去留由 D1 裁决（离线本地模式仍需要；网站直读 PG 不经同步）。
- 执行方式：多代理模式；全链 D1→D2→D3→D4→Gate1→B→F→Gate2；WARN 继续并记录。