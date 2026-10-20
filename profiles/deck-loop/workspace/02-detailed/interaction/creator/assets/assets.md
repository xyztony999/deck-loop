# PageSpec — 素材库 · 品牌规范 · 话术库（资产中心）

| 属性 | 值 |
|------|-----|
| 模块编码 | S-01 / S-02（asset） |
| 用户类型 | creator |
| 业务类型 | master_data |
| 页面类型 | config（三 Tab 列表） |
| 路由 | /assets（Tab: 素材/品牌规范/话术库） |
| 版本 | v1.0（2026-10-07） |
| 输入 | api-assets.md v1.0 |

## 1. 模块元信息

- App：主导航「素材库」；ScmCardPage（layout: 'tab'）。
- 素材 Tab 为网格卡片视图（映射列语义），规范/话术为标准表格。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| asset_list | POST | /asset/asset/list | 素材分页 |
| asset_upload | POST(multipart) | /asset/asset/upload | 上传 |
| asset_save | POST | /asset/asset/save | 元信息编辑 |
| asset_disable / asset_enable | POST | /asset/asset/disable · /enable | 停用/恢复 |
| asset_delete | POST | /asset/asset/delete | 删除（refCount=0） |
| brandkit_list / save / delete / set_default | POST | /asset/brandkit/* | 规范 |
| prompt_list / save / delete / touch | POST | /asset/prompt/* | 话术 |
| dict_batch | POST | /asset/dict/batch | AssetType/AssetStatus/TemplateScene |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| asset.AssetType | AssetType | tag |
| asset.AssetStatus | AssetStatus | colorTag（ACTIVE green/DISABLED gray） |
| asset.TemplateScene | TemplateScene | tag |

## 4. Tab1 素材库（网格卡片）

### 4.1 查询区

keyword(like 名称) · category(eq，本地目录树) · assetType(select) · assetStatus(select)

### 4.2 工具栏

上传（拖拽区+文件选择，≤10MB，jpg/png/svg/webp；hash 重复→提示「已存在相同文件，是否复用」）· 批量停用

### 4.3 卡片/列

| 列 | 类型 | 配置 |
|----|------|------|
| 缩略图+assetName | link | 点击预览大图 |
| category | text | |
| assetType | dict | |
| assetStatus | dict+colorTag | |
| refCount | text | 引用 {n}（>0 锁定删除） |
| fileSize | text | 格式化 |
| updatedTime | text | |
| __action__ | action | operList |

### 4.4 operList 映射

edit（重命名/改分类）· disable(ACTIVE) · enable(DISABLED) · delete(refCount=0；否则按钮禁用+tooltip「被版本引用，仅可停用」）

## 5. Tab2 品牌规范（表格）

列：kitName(link) · 色板（色块组预览） · fonts（title/body 名） · logo（缩略） · isDefault(默认 tag) · updatedTime · 操作。
表单（Dialog，<5 字段组）：kitName✅≤50 · colors{primary(colorPicker 必填)/assistants[](≤5)} · fonts{title/body(预置字体下拉)} · logoAssetId(modalSelect asset.select.assetList 限 LOGO 类型启用态)。
operList：edit · set_default(非默认) · delete(非默认且未被引用；is_default 禁用+tooltip)。

## 6. Tab3 话术库（表格）

列：title(link) · content(ellipsis，占位符高亮{xxx}) · category · templateScene(dict) · useCount · updatedTime · 操作。
表单（Dialog）：title✅≤50 · content✅textarea≤2000（占位符 {名称} 语法校验，实时高亮未闭合） · category · templateScene✅(radio WHOLE/TARGETED)。
operList：edit · delete(confirm)。
联动：迭代工作台选用模板提交后 prompt_touch（use_count+1）。

## 7. 路由定义

| 路由 | 页面 | 入口 |
|------|------|------|
| /assets | 资产中心（三 Tab） | 主导航「素材库」 |

## 8. 全局一致性

- 三 Tab 查询状态独立保持；上传入口在工作台引用选择器内亦可直达（跳转带 query 高亮）。
- 被引用保护类操作统一「禁用+tooltip 解释」模式。

## 9. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 初始生成 |
