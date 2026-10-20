# PageSpec — 导出与演示（交付中心）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-06（deliver）+ S-03 |
| 用户类型 | creator |
| 业务类型 | business_doc（导出记录台账）+ code（演示模式） |
| 页面类型 | config（记录列表）+ code（全屏演示） |
| 路由 | /deliver（导出记录中心） · /deck/:deckId/present（演示） |
| 版本 | v1.1（2026-10-20） |
| 输入 | api-delivery.md v1.3 |

## 1. 模块元信息

- App：主导航「导出记录」页 + 迭代工作台/详情的 [导出] [演示] 入口。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| export_submit | POST | /deliver/export/submit | 创建导出意图（PPTX needConfirm 流程），渲染本地执行 |
| export_list | POST | /deliver/export/list | 记录分页 |
| export_artifact_upload | POST | /deliver/export/upload | multipart 产物回传（QUEUED→SUCCEEDED） |
| export_fail | POST | /deliver/export/fail | 渲染失败上报（QUEUED→FAILED） |
| export_cancel | POST | /deliver/export/cancel | 取消（QUEUED） |
| download_ticket | POST | /deliver/export/download-ticket | 换取限时效价 |
| export_download | GET | /deliver/export/download?exportId=&token= | 文件流 |
| present_data | POST | /deliver/present/data | 演示数据 |
| deck_select | POST | /deck/select/deck-list | 记录筛选创作物 |
| dict_batch | POST | /deliver/dict/batch | ExportFormat/ExportStatus |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| deliver.ExportFormat | ExportFormat | tag（PPTX 带 beta 标） |
| deliver.ExportStatus | ExportStatus | colorTag（QUEUED gray/SUCCEEDED green/FAILED red/CANCELLED gray；RENDERING blue 仅历史行兼容，v1.1 新链路不流转） |

## 4. 导出记录列表页（/deliver，ScmListPage）

### 4.1 查询区

| 字段 | 组件 | 查询方式 |
|------|------|---------|
| deckId | modalSelect（deck.select.deckList） | eq |
| exportFormat | select(dict) | eq |
| exportStatus | select(dict) | eq |
| timeRange | dateRange | between |

### 4.2 工具栏

新建导出（弹窗：deckId modalSelect 限 FINALIZED + exportFormat radio + PPTX beta 确认）→ export_submit（创建意图）→ **本地渲染**（见 §5）→ export_artifact_upload → SUCCEEDED。

### 4.3 表格列

| 列 | 类型 | width | 配置 |
|----|------|-------|------|
| index | index | 60 | |
| exportCode | link | 180 fixed left | 点击→下载（SUCCEEDED） |
| deckName | text | 200 | 冗余 |
| versionSeq | text | 100 | v{seq} |
| exportFormat | dict | 110 | |
| exportStatus | dict+colorTag | 110 | |
| fileSize | text | 100 | KB/MB 格式化 |
| createdTime | text | 170 | |
| __action__ | action | 160 fixed right | operList |

### 4.4 operList 映射

| key | 按钮 | 条件 |
|-----|------|------|
| download | 下载 | SUCCEEDED（ticket→下载） |
| cancel | 取消 | QUEUED（RENDERING 仅历史行兼容） |
| retry | 重试 | FAILED（本地重新渲染提交，新任务） |

## 5. 本地渲染编排（v1.1，客户端）

- 数据：present_data 拉取（渲染源=演示渲染组件**多页模式**，与放映所见即所得）；图片经素材限时 URL 直取。
- 渲染：隐藏 Tauri 窗口装载多页视图——PDF=插件 render_pdf（WebView2 PrintToPdf，页尺寸=幻灯片）；PNG=插件 capture_page 逐页截图→前端 ZIP；PPTX=pptxgenjs（DOM 测量字号，可编辑文本）。
- 进度/失败：本地进度条（阶段：数据→渲染→上传）；失败可本地重试或 export_fail 上报（errorMsg≤512）；用户关闭渲染弹窗=本地中止（任务留 QUEUED，可 cancel）。
- 上传：export_artifact_upload（multipart，≤50MB；服务端校验魔数/扩展名/属主/QUEUED）。

## 6. 演示模式（/deck/:deckId/present，code 全屏）

- 进入守卫：FINALIZED（否则 toast 引导定稿）。
- 数据：present_data 一次拉取（pages[] 含 note 备注）。
- 交互：←/→/空格翻页 · Home/End 首末页 · F 全屏 · Esc 退出 · S 演讲者备注开关（右侧小窗，仅演示者可见）。
- 渲染：页面流式布局渲染，图片经限时 URL；无任何编辑入口。

## 7. 路由定义

| 路由 | 页面 | 入口 |
|------|------|------|
| /deliver | 导出记录 | 主导航 |
| /deck/:deckId/present | 演示 | 详情/工作台 [演示] |

## 8. 全局一致性

- 下载失败（凭证过期）自动重新换 ticket 一次，再失败提示重新下载。
- 演示模式独占窗口焦点，屏蔽全局快捷键。

## 9. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 初始生成 |
| v1.1 | 2026-10-20 | 渲染架构重定向（ADR-015，api-delivery v1.3）：新增本地渲染编排（§5，隐藏窗口+Tauri 插件+pptxgenjs）；Action +export_artifact_upload/+export_fail；cancel 条件收窄 QUEUED；RENDERING 转历史兼容 |
