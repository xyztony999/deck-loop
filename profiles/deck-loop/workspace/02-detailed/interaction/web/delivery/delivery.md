# PageSpec — 导出交付（产物下载列表）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-06（deliver） |
| 用户类型 | creator |
| 业务类型 | business_doc（子流程终态记录） |
| 页面类型 | config（列表） |
| 路由 | /deliver（?deckId= 预选） |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-delivery.md v1.3（9 端点冻结）/ api-web-agent.md v1.0 / ADR-018 |

## 1. 模块元信息

- App：web/ 主导航「导出交付」；恢复 client/src/views/deliver/index.vue，**移除 ExportCreateDialog（导出发起弹层）**。
- **网站仅下载已导出产物**：新导出由 MCP export_deck 触发（本地 headless 渲染→upload 回传）；网站无 submit 入口、无渲染器（ADR-015/018 红线）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| export_list | POST | /deliver/export/list | 分页/筛选 |
| download_ticket | POST | /deliver/export/download-ticket | HMAC 30min 凭证 |
| export_download | GET | /deliver/export/download | 文件流（@Public+凭证） |
| deck_select | POST | /deck/select/deck-list | deckId 筛选选择池 |
| dict_batch | POST | /deliver/dict/batch | ExportFormat/ExportStatus |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| deliver.ExportFormat | ExportFormat | tag（PDF/IMAGES/PPTX beta） |
| deliver.ExportStatus | ExportStatus | colorTag（QUEUED gray/SUCCEEDED green/FAILED red/CANCELLED gray；RENDERING 历史兼容 blue） |

## 4. 列表页（/deliver）

### 4.1 查询区（内嵌页头）

| 字段 | 组件 | 查询方式 |
|------|------|---------|
| deckId | modalSelect（deck.select.deckList） | eq |
| exportFormat | select | eq |
| exportStatus | select | eq |
| timeRange | dateRange | between |

### 4.2 页头

无 primary 发起按钮；提示文案（次要色 12px）：「新导出请在 coding agent 中经 deck-loop MCP 发起（export_deck），完成后此处可下载。」

### 4.3 表格列

| 列 | 类型 | 配置 |
|----|------|------|
| exportCode | text | EX 编码 |
| deckName | link | →/deck/:deckId |
| versionSeq | text | v{seq} |
| exportFormat | tag | |
| exportStatus | colorTag | |
| fileSize | text | 人类可读（KB/MB） |
| createdTime | text | |
| __action__ | action | operList 驱动 |

### 4.4 operList 映射（网站裁剪）

| key | 按钮 | 行为 |
|-----|------|------|
| download | 下载（SUCCEEDED） | download_ticket → window.open(url)（附件名 DL-{deck_code}-v{seq}.{ext}） |
| cancel | —（网站隐藏） | QUEUED 任务由 MCP 侧处置 |
| retry | —（网站隐藏） | 重试=本地重新渲染，仅 MCP |

凭证过期（30min）重新换取；BIZ_EXPORT_NOT_DOWNLOADABLE 文案透传。

## 5. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /deliver | 导出记录列表 | 主导航「导出交付」；详情工作台「导出记录」（?deckId=） |

## 6. 全局一致性

- QUEUED 行提示「等待 agent 渲染回传」（无进度条——无 SSE/轮询任务态）。
- 空态引导文案指向 MCP 工作流（ER-04 直白文案）。

## 7. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（恢复 creator/delivery v1.1 改纯 Web：移除导出发起/取消/重试入口与隐藏渲染窗；仅记录+下载；渲染口径 MCP 本地 headless） |