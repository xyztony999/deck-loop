# PageSpec — 预览放映（浏览器侧渲染）

| 属性 | 值 |
|------|-----|
| 模块编码 | S-03（演示放映）+ C-04 预览消费 |
| 用户类型 | creator |
| 业务类型 | 只读渲染（过程数据） |
| 页面类型 | code（画布组件 + 全屏放映裸页） |
| 路由 | /deck/:deckId（画布内嵌）· /deck/:deckId/present（?versionId=） |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-version.md v1.2（detail）/ api-assets.md v1.2（file-url）/ api-web-agent.md v1.0 / ADR-018 §4.6 |

## 1. 模块元信息

- **渲染源**：`mcp-server/src/render/render-template.ts`（parseSlides/slidesHtml/renderDocument/previewDocument，纯 TS）经路径别名共享消费——与 MCP headless 导出**同一排版模板**（所见即所得，ADR-015 精神延续）。
- 组件恢复：DeckPreviewCanvas.vue（迁 web/src/views/deck/components/）；放映页恢复 deliver/present.vue 改浏览器渲染（去 Tauri 窗口）。
- **服务端零渲染**：网站不请求任何渲染端点；present/data 端点保留兼容但网站不消费（预览统一 version/detail，任意版本可用，不受 FINALIZED 守卫限制）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| version_detail | POST | /ver/version/detail | content 完整 JSON |
| asset_file_url | POST | /asset/asset/file-url | assetIds → 限时签名 URL（受保护） |
| deck_detail | POST | /deck/deck/detail | 缺省版本=当前指针 |

## 3. 渲染管线（前端）

1. version_detail → content（pages[]→blocks[]）。
2. extractAssetIds(content) → asset_file_url → GET /files/{userId}/{name}?expires=&sign=（HMAC 签名，浏览器直取）。
3. parseSlides(content) → slidesHtml(slides, imageUrls) → 画布内框（**文档表面永远白纸** --dl-doc-bg，07 §1；1280×720 逻辑尺寸缩放适配）。
4. 图片加载失败占位（PLACEHOLDER 块灰底标注）；SVG 素材经服务端 CSP 约束直显。

## 4. 预览画布（详情工作台右侧）

- 当前选中版本（树节点点击驱动；缺省=当前指针版本）。
- 画布外围控件（chrome）：页码器（上一页/下一页/页码输入）· 缩放（适配/100%）· 版本徽标 v{seq} · 「放映」按钮（→present?versionId=）。
- 演讲者备注：画布下方折叠小节（note 字段，纯文本）。
- 只读：无选取/编辑交互（定向目标由 agent 侧定位，ADR-008/018）。

## 5. 全屏放映（/deck/:deckId/present，bare 裸页）

- 入参：?versionId=（缺省=当前指针）；任意版本可放映（不要求定稿——浏览器侧渲染便利口径，与 MCP preview_deck 一致）。
- 布局：舞台内框白纸文档表面居中（letterbox 黑边=页面底 #141414）；键盘 ←→/空格翻页、F 全屏、Esc 退出；底部悬浮控制条（chrome 浮层，自动隐藏）。
- 备注：演讲者备注开关（侧栏浮层，默认关）。
- 退出 → 返回详情工作台。

## 6. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /deck/:deckId | 画布（内嵌） | 详情工作台 |
| /deck/:deckId/present | 全屏放映 | 画布/树面板「放映」 |

## 7. 全局一致性

- 文档表面不随主题（亮色主题下画布仍白纸）；chrome 控件暗色三层。
- 放映翻页态为 P3 前端状态，不持久化。

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（ADR-018：浏览器侧 render-template 渲染替代 Tauri 放映/隐藏渲染窗；任意版本预览；present/data 不消费） |