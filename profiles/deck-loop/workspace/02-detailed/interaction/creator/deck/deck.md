# PageSpec — 创作物工作台（列表/新建/详情）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-01（deck） |
| 用户类型 | creator（创作者） |
| 业务类型 | business_doc |
| 页面类型 | config（列表）+ hybrid（新建向导抽屉） |
| 路由 | /deck（列表） · /deck/new（新建，抽屉式向导） · /deck/:deckId（详情） |
| 版本 | v1.0（2026-10-07） |
| 输入 | api-deck.md v1.0 |

## 1. 模块元信息

- App：deck-loop 客户端主窗口；列表页为启动首页。
- 组件基座：列表 = ScmListPage；新建向导 = ScmCardPage（layout: 'steps'）；详情 = ScmDetailPage 组合。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| deck_list | POST | /deck/deck/list | 分页查询 |
| deck_save | POST | /deck/deck/save | 新建/编辑 |
| deck_detail | POST | /deck/deck/detail | 详情（withStats/withLatestTask=true） |
| deck_archive | POST | /deck/deck/archive | 归档 |
| deck_restore | POST | /deck/deck/restore | 恢复 |
| deck_delete | POST | /deck/deck/delete | 删除（仅归档） |
| deck_finalize | POST | /deck/deck/finalize | 定稿 |
| deck_unfinalize | POST | /deck/deck/unfinalize | 解锁 |
| dict_batch | POST | /deck/dict/batch | DeckType/DeckStatus |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| deck.DeckType | DeckType | tag |
| deck.DeckStatus | DeckStatus | dict + colorTag（DRAFT gray/ITERATING blue/FINALIZED green/ARCHIVED gray） |

## 4. 列表页（/deck）

### 4.1 查询区

| 字段 | 组件 | 查询方式 | 备注 |
|------|------|---------|------|
| keyword | input | like（名称） | |
| deckType | select | eq | options=dict |
| deckStatus | select | eq | options=dict |
| timeRange | dateRange | between（createdTime） | |
| archivedScope | switch | eq（0/1） | 开=查看归档区 |

### 4.2 工具栏

新增（→新建向导）·（归档区）批量恢复

### 4.3 表格/卡片列（卡片视图，映射列语义）

| 列 | 类型 | width | 配置 |
|----|------|-------|------|
| index | index | 60 | |
| deckName | link | 200 fixed left | 点击→详情 |
| deckType | dict | 120 | |
| topic | text | 240 ellipsis | |
| deckStatus | dict+colorTag | 110 | |
| currentVersionSeq | text | 100 | 当前版本 v{seq} |
| versionCount/adjustCount | text | 120 | 统计 |
| updatedTime | text | 170 | |
| __action__ | action | 180 fixed right | operList 驱动 |

### 4.4 operList 映射（后端返回驱动可见性）

| key | 按钮 | 前置确认 |
|-----|------|---------|
| edit | 编辑 | — |
| finalize | 定稿 | 二次确认（锁定提示） |
| unfinalize | 解锁 | 二次确认 |
| archive | 归档 | — |
| restore | 恢复 | — |
| delete | 删除 | 强确认（软删除不可自恢复） |

详情跳转：deckName 链接 → /deck/:deckId。

## 5. 新建向导（/deck/new，三步抽屉）

步骤：①基本信息（deckName✅/deckType（DECK 可选，DOC/POSTER 置灰「即将支持」）/topic✅/requirement textarea）→ ②品牌规范（modalSelect，服务标识 asset.select.brandkitList，可跳过）→ ③创建（保存→跳转生成向导 generation）。
按钮：上一步/下一步/保存并开始生成/取消（dirty 检测）。表单校验：deckName ≤100 必填；topic ≤200 必填。

## 6. 详情页（/deck/:deckId）

| Card | 内容 | 数据源 |
|------|------|--------|
| 基本信息 | 名称/类型/状态(tag)/主题/需求/默认规范/创建时间 | deck_detail |
| 迭代状态 | 当前版本 v{seq}·活动分支·版本数·调整次数·最近任务（状态 tag） | detail.withStats/withLatestTask |
| 操作日志 | 操作人/动作/时间 | 平台日志接口 |

操作按钮区（状态驱动，同 operList 语义）：编辑/定稿或解锁/归档/进入迭代工作台（→/deck/:deckId/iterate）/导出（FINALIZED）。

## 7. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /deck | 列表 | 主导航「创作物」 |
| /deck/new | 新建向导 | 列表工具栏 |
| /deck/:deckId | 详情 | 列表链接 |

## 8. 全局一致性

- 列表空态引导「新建第一个创作物」；归档区视觉弱化。
- 所有确认弹窗统一 danger 样式规范（05-ui-ux-specs）。

## 9. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 初始生成 |
