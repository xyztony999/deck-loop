# PageSpec — 资产中心（素材/品牌规范/话术库）

| 属性 | 值 |
|------|-----|
| 模块编码 | S-01/S-02（asset） |
| 用户类型 | creator |
| 业务类型 | master_data |
| 页面类型 | hybrid（三 Tab，DlCardPage layout: 'tab'） |
| 路由 | /assets（?tab=asset\|brandkit\|prompt&highlight=） |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-assets.md v1.2（20 端点契约冻结）/ api-web-agent.md v1.0 |

## 1. 模块元信息

- App：web/ 主导航「素材库」；恢复 client/src/views/assets/（AssetTab/BrandkitTab/PromptTab + 各编辑弹层），剥 Tauri 文件对话框改浏览器 upload。
- Tab 坐表面顶部（下划线式，07 §3.4）；Tab 内为列表页解剖（07 §3.2）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| asset_list | POST | /asset/asset/list | 素材分页 |
| asset_upload | POST | /asset/asset/upload | multipart（浏览器 File） |
| asset_save | POST | /asset/asset/save | 名称/分类编辑 |
| asset_disable | POST | /asset/asset/disable | 停用 |
| asset_enable | POST | /asset/asset/enable | 恢复 |
| asset_delete | POST | /asset/asset/delete | 仅 refCount=0 |
| brandkit_list | POST | /asset/brandkit/list | 规范分页 |
| brandkit_save | POST | /asset/brandkit/save | 新建/编辑 |
| brandkit_delete | POST | /asset/brandkit/delete | 非默认且未被引用 |
| brandkit_set_default | POST | /asset/brandkit/set-default | 事务切换默认 |
| prompt_list | POST | /asset/prompt/list | 话术分页 |
| prompt_save | POST | /asset/prompt/save | 占位符校验 |
| prompt_delete | POST | /asset/prompt/delete | 删除 |
| dict_batch | POST | /asset/dict/batch | AssetType/AssetStatus/TemplateScene |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| asset.AssetType | AssetType | tag（IMAGE/LOGO） |
| asset.AssetStatus | AssetStatus | colorTag（ACTIVE green/DISABLED gray） |
| asset.TemplateScene | TemplateScene | tag（WHOLE/TARGETED） |

## 4. 素材 Tab（?tab=asset，默认）

查询区（内嵌页头）：keyword input（like）· assetType select · assetStatus select。
页头操作：上传素材（primary，upload 弹层：拖拽/选择文件，jpg/jpeg/png/svg/webp ≤10MB 前端预校验 INV-19；assetName/category/assetType 表单；hash 命中回显「已存在，复用原素材」duplicated）。
表格列：缩略图（thumbnailUrl）· assetName(link 编辑) · assetType tag · category · fileSize · assetStatus colorTag · refCount（引用数）· updatedTime · __action__。
operList：edit（弹层名称/分类）/ disable（ACTIVE）/ enable（DISABLED）/ delete（refCount=0；被引用行按钮隐藏，hover 提示「被版本引用，仅可停用」INV-18/ADR-004）。
删除强确认；停用二次确认（提示引用方仍可读历史快照）。

## 5. 品牌规范 Tab（?tab=brandkit）

查询区：keyword input。页头操作：新建规范（primary）。
表格列：kitName(link 编辑) · 色板预览（colors.primary+assistants 色块行，文档表面域外 chrome 用 token 边框）· fonts.title/body · logo 缩略 · isDefault tag · updatedTime · __action__。
operList：edit / set-default（非默认行；二次确认「切换默认规范」）/ delete（非默认且未被 deck 引用；BIZ_BRANDKIT_IS_DEFAULT 文案透传）。
编辑弹层（浮层 640px）：kitName✅≤50 · colors.primary（6 位 hex 取色器）+ assistants≤16 · fonts.title/body · logoAssetId（modalSelect asset.select.assetList，仅 ACTIVE，INV-16）。

## 6. 话术库 Tab（?tab=prompt）

查询区：keyword input · templateScene select。页头操作：新建话术（primary）。
表格列：title(link 编辑) · content（ellipsis，{占位符} 高亮为 accent 文本）· templateScene tag · category · useCount · updatedTime · __action__。
operList：edit / delete（强确认）。
编辑弹层：title✅≤50 · content✅≤2000 textarea（占位符 {名称}≤10 处前端预校验 INV-21）· category · templateScene select。
**复用说明**：话术在 agent 会话内选用（MCP prompt_list）；网站提供管理入口与「复制话术」行操作（便利 clipboard，非指令下发）。

## 7. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /assets | 三 Tab 资产中心 | 主导航「素材库」；?tab=&highlight= 直达（工作台引用选择器） |

## 8. 全局一致性

- 三 Tab 共用列表页解剖与 operList 驱动；弹层坐浮层层（#262626）。
- 上传进度条用主色 accent；失败透传 BIZ_ASSET_* 文案。

## 9. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（恢复 creator/assets v1.0 改纯 Web：浏览器 upload 替代 Tauri 文件对话框；话术增复制便利操作；契约零变更） |