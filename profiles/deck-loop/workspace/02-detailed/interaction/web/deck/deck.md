# PageSpec — 创作物管理（列表/新建/详情工作台）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-01/C-05（deck） |
| 用户类型 | creator |
| 业务类型 | business_doc |
| 页面类型 | config（列表）+ hybrid（新建向导、详情工作台） |
| 路由 | /deck · /deck/new · /deck/:deckId |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-deck.md v1.2 + api-web-agent.md v1.0（§4.3 outline-save） |

## 1. 模块元信息

- App：web/；列表页为启动首页。
- 组件基座：列表 = DlListPage（卡片视图 tile，07 §3.5）；新建 = DlCardPage（layout: 'steps'）；详情 = hybrid（左版本树面板 + 右预览画布 + 小节流）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| deck_list | POST | /deck/deck/list | 分页查询 |
| deck_save | POST | /deck/deck/save | 新建/编辑 |
| deck_detail | POST | /deck/deck/detail | withStats=true；withLatestTask=false（网站不展示任务） |
| deck_archive | POST | /deck/deck/archive | 归档 |
| deck_restore | POST | /deck/deck/restore | 恢复 |
| deck_delete | POST | /deck/deck/delete | 软删除（仅归档） |
| deck_finalize | POST | /deck/deck/finalize | 定稿 |
| deck_unfinalize | POST | /deck/deck/unfinalize | 解锁 |
| outline_save | POST | /deck/deck/outline-save | 大纲保存（迁移端点，DRAFT 态） |
| dict_batch | POST | /deck/dict/batch | DeckType/DeckStatus |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| deck.DeckType | DeckType | tag |
| deck.DeckStatus | DeckStatus | colorTag（DRAFT gray/ITERATING blue/FINALIZED green/ARCHIVED gray） |

## 4. 列表页（/deck）

### 4.1 查询区（内嵌页头，变更即查，07 §3.2）

| 字段 | 组件 | 查询方式 |
|------|------|---------|
| keyword | input（回车/清空即查） | like（名称） |
| deckStatus | select | eq |
| timeRange | dateRange | between（createdTime） |
| archivedScope | switch（页头 #header-extra） | 0/1（开=归档区） |

### 4.2 页头操作

新建创作物（primary → /deck/new）。

### 4.3 卡片列（tile 视图）

| 列 | 类型 | 配置 |
|----|------|------|
| deckName | link | 点击→详情；tile 标题 13/600 |
| deckStatus | colorTag | |
| topic | text | ellipsis |
| currentVersionSeq | text | v{seq} |
| versionCount/adjustCount | text | 统计（历史调整次数含网关时代） |
| updatedTime | text | 12px 次要色 |
| __action__ | action | operList 驱动 |

### 4.4 operList 映射

| key | 按钮 | 前置确认 |
|-----|------|---------|
| edit | 编辑 | —（→/deck/new?deckId=） |
| finalize | 定稿 | 二次确认（锁定提示） |
| unfinalize | 解锁 | 二次确认 |
| archive | 归档 | — |
| restore | 恢复 | — |
| delete | 删除 | 强确认（软删除不可自恢复） |

## 5. 新建/编辑向导（/deck/new，两步）

步骤：①基本信息（deckName✅≤100 / deckType（DECK 可选，DOC/POSTER 置灰「即将支持」）/ topic✅≤200 / requirement textarea）→ ②品牌规范（modalSelect，asset.select.brandkitList，可跳过）。
按钮：上一步/保存/取消（dirty 检测）。**保存成功→ /deck/:deckId 详情工作台**（不再跳生成向导——生成在 agent 侧，ADR-018）。
编辑态（?deckId=）：仅 DRAFT/ITERATING 可进入（operList edit 驱动）。

## 6. 详情工作台（/deck/:deckId，hybrid）

布局：页头行（名称+状态 tag+操作）→ 分隔线 → 左版本树面板（web/version/version.md §4）+ 右预览画布（web/preview/preview.md §4）；下方小节流。

| 小节 | 内容 | 数据源 |
|------|------|--------|
| 基本信息 | 名称/类型/主题/需求/默认规范/创建时间 | deck_detail |
| 迭代状态 | 当前版本 v{seq}·活动分支·版本数·调整次数 | detail.withStats |
| 大纲（仅 DRAFT） | 节点树编辑器（增删改/排序/要点/建议页数）+ 保存按钮 | outline_save；首版后本小节转只读展示 |
| 交 agent 调整（引导） | 说明文案「内容修改请在 coding agent 中经 deck-loop MCP 完成」+ 上下文复制按钮（deckId/当前版本/分支）+ 话术库链接（/assets?tab=prompt） | 前端静态 + detail |

操作按钮区（状态驱动）：编辑/定稿或解锁/归档/对比（→compare）/放映（→present）/导出记录（→/deliver?deckId=）。
**无指令输入面板、无内容编辑交互**（ADR-008；网站无内容写入口，ADR-018 §4.6）。
大纲校验失败透传 BIZ_DECK_OUTLINE_INVALID 文案（节点 1~50/title≤50 前端预校验）。

## 7. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /deck | 列表 | 主导航「创作物」 |
| /deck/new | 新建/编辑向导 | 列表页头/operList edit |
| /deck/:deckId | 详情工作台 | 列表链接 |

## 8. 全局一致性

- 空态引导「新建第一个创作物」；归档区视觉弱化。
- 版本树轻轮询 10s（页面隐藏暂停）+ 手动刷新（web/index.md §3）。
- 单表面原则：工作台分区用分隔线+小节标题，禁卡中卡（07 §3/§9）。

## 9. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（恢复 creator/deck v1.0 改纯 Web：新建两步去生成跳转；详情改工作台=版本树+预览+大纲编辑+agent 引导；+outline_save 迁移端点；去任务面板/迭代工作台入口） |