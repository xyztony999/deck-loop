# Web 管理站 — 路由结构与全局规格（PageSpec 索引）

| 属性 | 值 |
|------|-----|
| 模块 | deck-loop-full（增量 web-mgmt-20261125） |
| 用户类型 | creator（创作者，网站会话） |
| App | web/（779f3d6 client/ 历史恢复剥 Tauri，纯 Web） |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-web-agent.md v1.0 / api-index.md v1.3 / prd-web-management.md v1.0 / ADR-018 / 07-ui-design-language v2.0 |

## 1. 技术基座（恢复与剥离）

- **恢复源**：commit 779f3d6 的 `client/`（Vue3 + AntdV4 + DlListPage/DlCardPage/DlDetailPage 引擎 + 暗色主题 theme.ts/global.less）→ `web/`。
- **剥离**：src-tauri/、@tauri-apps/* 依赖、原生命令（export_renderer.rs 等）、隐藏渲染窗路由 /export-render、窗口控制组件；API 基址改同源 `/api`（Nginx 反代 deck-loop-core）或 env `VITE_API_BASE_URL` 注入。
- **保留**：会话 store（X-Auth-Token，localStorage）、全局路由守卫、引擎组件 v2 形态、暗色三层色板与 07 v2.0 单表面语言（ADR-014 铁律沿用，领导已评审不复议）。
- **新增**：`web/src/render/` 经 TS 路径别名消费 `mcp-server/src/render/render-template.ts`（parseSlides/slidesHtml/renderDocument/previewDocument，纯 TS 零 node 依赖，**单一源零复制**）——浏览器侧预览/放映渲染。
- **移除视图**：gen/（生成向导）、adjust/ 指令面板（迭代工作台）、任务面板、渠道/用量设置 Tab；adjust/ 的 VersionTreePanel/VersionCompareDrawer/DeckPreviewCanvas 组件**保留迁移**至 deck 工作台与版本对比页。

## 2. 路由结构

| 路由 | 页面 | PageSpec | 菜单入口 | 守卫 |
|------|------|----------|---------|------|
| /auth | 登录/注册 | web/auth/auth.md | 未登录唯一可达 | public；已登录→/deck |
| /deck | 创作物列表（首页） | web/deck/deck.md §4 | 主导航「创作物」 | 会话 |
| /deck/new | 新建向导（?deckId= 编辑） | web/deck/deck.md §5 | 列表页头 primary | 会话 |
| /deck/:deckId | 详情工作台（版本树+预览+大纲+agent 引导） | web/deck/deck.md §6 | 列表链接 | 会话 |
| /deck/:deckId/compare | 版本对比（?left=&right=） | web/version/version.md §5 | 工作台「对比」 | 会话 |
| /deck/:deckId/present | 全屏放映（?versionId=） | web/preview/preview.md §5 | 工作台/预览「放映」 | 会话；bare 脱壳 |
| /assets | 资产中心（?tab=asset\|brandkit\|prompt） | web/assets/assets.md | 主导航「素材库」 | 会话 |
| /deliver | 导出记录（?deckId= 预选） | web/delivery/delivery.md | 主导航「导出交付」 | 会话 |
| /settings | 设置（Tab：账户/API token/外观） | web/settings/settings.md | 顶栏用户菜单 | 会话 |
| / | → /deck | — | — | — |
| /:pathMatch(.*)* | → /deck | — | — | — |

**退役路由**（恢复时删除，访问重定向 /deck）：/gen、/deck/:deckId/generate、/adjust、/deck/:deckId/iterate、/export-render、/login（保留→/auth 别名）。

## 3. 全局壳与一致性

- **布局**：暗侧栏（#141414 页面底，主导航三项+设置入口）+ 内容表面（#1f1f1f 贴壳满幅单表面，07 §3.1）+ 顶栏（表面色，底部分隔线）；浮层 #262626。主色 #6b8ab5 仅 accent。
- **文档表面**：预览画布/放映舞台内框永远白纸（--dl-doc-bg，07 §1），不随主题；画布外围控件属 chrome。
- **鉴权**：无 token 一律重定向 /auth（?redirect=）；BIZ_AUTH_SESSION_EXPIRED 全局拦截清态回登录页；会话 30 天滑动静默续期（profile refreshedToken，现状）。
- **刷新策略**：工作台版本树轻轮询 10s（document.hidden 暂停）+ 手动刷新按钮；**无 SSE**（ADR-018 §4.6）。列表页变更即查（07 §8），无查询/重置按钮组。
- **确认弹窗**：破坏性操作（删除/吊销/回退）统一 danger 样式二次确认；文案直白用户视角（ER-04，禁 emoji/系统腔）。
- **错误透传**：BIZ_* msg 直显（服务端文案即用户文案）；token 管理页 BIZ_AUTH_TOKEN_INVALID 引导重新签发。
- **滚动条/表格**：07 §7 全站规范（thin 滚动条、禁横向 max-content、表头透明）。

## 4. 功能组 ↔ PageSpec 追溯（FL v1.3）

| 功能组（D0 裁决 3） | PageSpec |
|--------------------|----------|
| 素材管理（含品牌规范/话术） | web/assets/assets.md |
| Deck 管理 | web/deck/deck.md |
| 版本树操作 | web/version/version.md |
| 预览放映 + 导出产物下载 | web/preview/preview.md + web/delivery/delivery.md |
| 平台入口（登录/账户/token） | web/auth/auth.md + web/settings/settings.md |

## 5. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（ADR-018 增量；路由结构+全局壳+恢复/剥离口径） |