# 业务概念索引

> 状态：D1-D4 完成后回填（2026-10-07）。详版见 workspace/00-architecture/business-arch.md 附录B。

## 业务对象

| 对象 | 英文 | 定义 | 备注 |
|------|------|------|------|
| 创作物 | Deck | 一次内容创作的项目单元（类型：演示文稿首期，预留文档/海报） | 聚合根 dl_deck |
| 内容版本 | DeckVersion | 一次生成/调整产出的不可变内容快照（页面树 JSON），组成版本树 | 聚合根 dl_deck_version |
| 生成任务 | GenerationTask | 异步子流程：大纲/整稿/整稿调整/定向调整四类 | dl_generation_task |
| 导出任务 | ExportTask | 定稿版本的渲染交付子流程（PDF/图片/PPTX） | dl_export_task |
| 素材 | Asset | 上传的图片/logo 资产，被引用后仅可停用 | dl_asset |
| 品牌规范 | BrandKit | 色板+字体+标志组合，生成/调整时注入约束 | dl_brand_kit |
| 话术模板 | PromptTemplate | 沉淀复用的调整话术（{占位符}） | dl_prompt_template |
| 渠道偏好 | ChannelPreference | 用户级默认渠道/模型 + 分任务档位 | dl_channel_preference |
| 账号 | Account | 注册登录/会话/多端同步主体 | dl_account |
| 用量记录 | UsageRecord | 网关计量日志（只追加） | dl_usage_record |

## 单据状态机

| 对象 | 状态流 | 守卫要点 |
|------|--------|---------|
| 创作物 | DRAFT→ITERATING→FINALIZED→ARCHIVED（解锁回 ITERATING；归档恢复） | FINALIZED/ARCHIVED 禁建任务；定稿/归档需无进行中任务 |
| 生成任务 | QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELLED | 同 deck 同时最多 1 个非终态任务；失败重试=新实例 |
| 导出任务 | QUEUED→RENDERING→SUCCEEDED/FAILED/CANCELLED | 仅 FINALIZED 可导出 |

## 角色

| 角色 | 职责 | 备注 |
|------|------|------|
| 创作者 | 唯一用户类型：发起生成/语言调整/版本管理/定稿导出 | 个人单用户，无审批链 |

## 术语表

见 business-arch.md 附录B（大纲/定向目标/版本树/定稿/话术模板等 12 条）。
