# UI 推倒重来 — 引擎与逐页处方（一次性全量）

| 属性 | 值 |
|------|-----|
| 日期 | 2026-10-22 |
| 依据 | 07-ui-design-language.md **v2.0**（单表面形态语言） |
| 决策 | 三分叉用户拍板：①引擎组件形态重做（路由/功能/config 协议零变化）②Linear/Notion 紧凑工具型 ③一次性全量 |
| 诊断 | 「卡片长出来一点儿」三根因：表格 `scroll x:'max-content'`（DlListPage.vue:395）产生原生亮白横向滚动条（全站零滚动条样式）；Antd 固定列分界阴影；三卡堆叠老式形态本身 |

---

## 1. 引擎改造规格

### 1.1 DlListPage v2（单表面列表）
模板结构（替换现查询卡+工具栏卡两卡结构）：
```
.dl-page（贴壳表面，无自身背景/内边距）
├─ .dl-page-header（padding 16px 24px，flex，底 1px 分隔线）
│   ├─ 左：标题（config.title，15px/600）+ slot #header-extra（页面级控件：归档开关/远程选择等）
│   └─ 右：内联筛选（auto-search，§07-3.2）+ 激活筛选重置图标 + 次操作按钮 + create(primary)
├─ .dl-selection-bar（rowSelection 且 selectedKeys.length>0：已选 N 项 | slot #selection-actions | 清除）
├─ 表格（a-table：去 scroll.x、去 fixed 强制、表头透明、单元格 13px/12-16、操作列 link+更多）
│   └─ 卡片视图（viewMode）→ 描边 tile 网格（§07-3.5）
└─ .dl-page-footer（顶 1px 分隔线，padding 12px 24px：左 共 N 条 / 右 分页 small）
```
行为变更：
- 筛选**变更即查**：select/dateRange/date change → `list.search()`；input `press-enter`/allow-clear 清空 → `list.search()`。废除查询/重置按钮组与折叠（defaultRowCount/expanded 逻辑删除）。
- 激活筛选（任一查询字段非空）→ 页头出现重置 ghost 图标按钮（调 `list.reset()`）。
- toolbar：key==='create' → 页头 primary；其余 → 页头 default。rowSelection 批量操作经 `#selection-actions` 槽。
- column 映射：忽略 config 的 fixed（不再传入）；action 列不再强制 fixed/center 改左对齐? —— 保持 center（链接组视觉居中收尾），仅去 fixed。
- 空表：a-empty 坐表面，无滚动条（scroll.x 已去）。

config 协议：**零变更**（queryFields/columns/toolbar/rowActions/rowSelection 原样；title 已存在；defaultRowCount 字段保留但失效，标 deprecated）。

### 1.2 DlCardPage v2（单表面向导）
- sticky 向导栏 = 表面首行（无圆角浮卡）：标题 + **内联文字步骤条**（自绘：18px 描边圆序号 + 13px 步骤名；当前主色/完成✓/未到次要色，步骤间 ›）+ 右侧动作组（取消 | 上一步 | 暂存(仅 saveDraftAction) | 下一步/提交 primary）。废除独立 a-steps 卡。
- 步骤卡 → 小节：`.dl-section`（小节标题 13px/600 纯文字，无竖条/底边框；小节间距 24）。form/detail/list/alert/flow 卡类型与全部插槽（#card-{key}/#field-{field}）**原样保留**。
- 表单网格 3 列 → **2 列**（内容 max-width 860 居中，padding 24）；textarea/upload 仍独占行。
- 悬浮锚点（≥3 卡）保留，面板按浮层色/radius 10 对齐。
- beforeNext 异常防护（2026-10-20 教训）保持不动。

### 1.3 DlDetailPage v2
同小节语言（小节标题纯文字、2 列描述网格、内容 860 居中）；loadAction/detailIdKey 协议不变。

### 1.4 global.less / theme.ts / 壳
- global.less：
  - 新 token：`--dl-scrollbar`（暗 #3f4450 / 亮 #c4c9d2）；滚动条规范全局落（html 及全部滚动容器，§07-7）。
  - `.dl-page` → 表面化（padding 0 / 背景透明，表面色由 `.dl-content` 承担）；`.dl-page-card`、`.dl-sticky-bar`、`.dl-card-title`（蓝竖条）**删除**；新增 `.dl-section`/`.dl-section-title`/`.dl-page-header`/`.dl-page-footer`/`.dl-selection-bar`/`.dl-tile` 原语。
  - 表格覆写：表头透明/12px 次要色、单元格 13px + padding 12px 16px、行 hover、fixed 列阴影线禁用、首末列 24px 特例改统一 16px。
- theme.ts：Table token（headerBg 透明、headerColor 次要色、headerSplitColor 透明、rowHoverBg）、Pagination itemSize 24。
- App.vue（壳微调，导航结构不动）：`.dl-content` 背景 → `--dl-card-bg`（表面）；`.dl-sider` 背景 → `--dl-bg-page`（页面底，经 `--dl-sider-bg`）；`.dl-header` 高度 48、背景属表面、阴影 → 底 1px 分隔线；**顶栏路由标题移除**（页面标题已随 07 §3 移入各页表面页头行，避免双重标题；顶栏只留账号与设置入口）。

### 1.5 实施补充（与 §1.1-1.3 的差异记录）
- DlListPage 新增槽位：`#header-extra`（页头行、标题右侧）、`#selection-actions`（选择条）、`#empty`（表格空态，默认 a-empty）；expose 新增 `clearSelection()`。
- DlDetailPage 新增槽位：`#header-actions`（页头行、关闭按钮左侧）。
- DlListPage 重置仅清 config.queryFields 自有字段（不动页面写入的额外键，如 archivedScope/deckId），避免页面侧控件与查询状态失步。
- gen/adjust 任务记录 config 补 `title`（adjust Tab3 内嵌列表**不设** title，避免与页签名重复；引擎对无 title 不渲染 h1）。

## 2. 逐页处方（一次性全量）

| # | 页面/文件 | 处方 |
|---|----------|------|
| 1 | deck/index.vue | 归档开关+批量恢复 → `#header-extra` + `#selection-actions` 槽；卡片视图 → tile；空态引导对齐表面 |
| 2 | deck/new.vue | 引擎向导自动受益；外层包装清理（若有 dl-page-card） |
| 3 | deck/detail.vue / DeckDetail.config | 引擎详情自动受益；检查外层包装 |
| 4 | gen/index.vue + components/ | 向导+任务列表引擎受益；槽件（OutlineEditor/任务卡/素材与品牌规范选择/汇总卡）做密度与 token 对齐（小节标题、间距、按钮） |
| 5 | deliver/index.vue | deckId 远程搜索 → `#header-extra` 槽；其余引擎受益 |
| 6 | deliver/present.vue | 演示全屏：v1.0 已 token 化，仅滚动条规范对齐（备注区滚动） |
| 7 | export/render-view.vue | 检查：画布=文档表面（白）、外围控件=chrome token；滚动条规范对齐 |
| 8 | assets/index.vue + 4 Tab + 4 Dialog | Tab 下划线式坐表面；素材/品牌 tile 化（§07-3.5）；对话框坐浮层 token 校验 |
| 9 | settings/index.vue + 4 Tab | 小节标题去竖条（global 变更联动）；间距对齐 v2 锚点 |
| 10 | adjust/index.vue + compare.vue | 工作台**结构保留**（非引擎页），做 token/间距/分隔线/按钮密度对齐（不推倒） |
| 11 | _shared/PagePlaceholder.vue | 表面化对齐 |
| 12 | auth/（登录） | token 与滚动条对齐（裸页坐页面底） |

## 3. 验收门
1. `pnpm -C client typecheck` / `lint` / `build` 全绿。
2. 巡检（按 07 §10）：chrome hex 直写、radius、间距标尺、`max-content`、`dl-page-card`/`dl-sticky-bar` 残留、滚动条规范。
3. 视觉冒烟：列表页（创作物/导出记录/任务记录/资产各 Tab）无横向滚动条、无固定列亮线、页头筛选即查可用；向导三步走通；暗/亮双主题。
4. 真机验证清单随交付附上（用户工作约定）。
