# 业务枚举池（deck-loop）

> D1/D3 阶段读写的业务枚举池。命名沿用 v1 冻结契约（06-node-api-conventions §6，v3）：存储由 VARCHAR(32) 改为 Mongo string，值域/成员不变；代码常量全大写下划线，API 传输字符串。
> 状态：D3 v1.0 首次填充（2026-10-07）；2026-10-08 v3 重定向：值域冻结不变。各 API 文档引用此处定义，禁止重复定义。

| 枚举标识 | 值 | 中文 | 使用对象 | 引用文档 |
|---------|-----|------|---------|---------|
| DeckType | DECK | 演示文稿 | dl_deck.deck_type | api-deck |
| DeckType | DOC | 文档（预留） | dl_deck.deck_type | api-deck |
| DeckType | POSTER | 海报（预留） | dl_deck.deck_type | api-deck |
| DeckStatus | DRAFT | 草稿 | dl_deck.deck_status | api-deck |
| DeckStatus | ITERATING | 迭代中 | dl_deck.deck_status | api-deck |
| DeckStatus | FINALIZED | 已定稿 | dl_deck.deck_status | api-deck |
| DeckStatus | ARCHIVED | 已归档 | dl_deck.deck_status | api-deck |
| TaskType | OUTLINE | 大纲生成 | dl_generation_task.task_type / dl_usage_record.task_type | api-generation/api-platform |
| TaskType | FULL_GENERATE | 整稿生成 | dl_generation_task.task_type / dl_usage_record.task_type | api-generation/api-adjustment/api-platform |
| TaskType | FULL_ADJUST | 整稿调整 | dl_generation_task.task_type / dl_usage_record.task_type | api-adjustment/api-platform |
| TaskType | TARGETED_ADJUST | 定向调整 | dl_generation_task.task_type / dl_usage_record.task_type | api-adjustment/api-platform |
| TaskStatus | QUEUED | 排队中 | dl_generation_task.task_status | api-generation |
| TaskStatus | RUNNING | 执行中 | dl_generation_task.task_status | api-generation |
| TaskStatus | SUCCEEDED | 已成功 | dl_generation_task.task_status | api-generation |
| TaskStatus | FAILED | 已失败 | dl_generation_task.task_status | api-generation |
| TaskStatus | CANCELLED | 已取消 | dl_generation_task.task_status | api-generation |
| VersionSourceType | FULL_GENERATE | 整稿生成 | dl_deck_version.source_type | api-version |
| VersionSourceType | FULL_ADJUST | 整稿调整 | dl_deck_version.source_type | api-version |
| VersionSourceType | TARGETED_ADJUST | 定向调整 | dl_deck_version.source_type | api-version |
| TargetKind | PAGE | 页 | 指令快照 scope | api-adjustment |
| TargetKind | TEXT_BLOCK | 文本块 | 指令快照 scope | api-adjustment |
| TargetKind | IMAGE_BLOCK | 图片元素 | 指令快照 scope | api-adjustment |
| ExportFormat | PDF | PDF 文件 | dl_export_task.export_format | api-delivery |
| ExportFormat | IMAGES | 图片包 | dl_export_task.export_format | api-delivery |
| ExportFormat | PPTX | PPTX（beta） | dl_export_task.export_format | api-delivery |
| ExportStatus | QUEUED | 排队中 | dl_export_task.export_status | api-delivery |
| ExportStatus | RENDERING | 渲染中 | dl_export_task.export_status | api-delivery |
| ExportStatus | SUCCEEDED | 已成功 | dl_export_task.export_status | api-delivery |
| ExportStatus | FAILED | 已失败 | dl_export_task.export_status | api-delivery |
| ExportStatus | CANCELLED | 已取消 | dl_export_task.export_status | api-delivery |
| AssetType | IMAGE | 图片 | dl_asset.asset_type | api-assets |
| AssetType | LOGO | 标志 | dl_asset.asset_type | api-assets |
| AssetStatus | ACTIVE | 启用 | dl_asset.asset_status | api-assets |
| AssetStatus | DISABLED | 停用 | dl_asset.asset_status | api-assets |
| TemplateScene | WHOLE | 整稿场景 | dl_prompt_template.template_scene | api-assets |
| TemplateScene | TARGETED | 定向场景 | dl_prompt_template.template_scene | api-assets |
| AccountStatus | ACTIVE | 正常 | dl_account.account_status | api-platform |
| AccountStatus | LOCKED | 已锁定 | dl_account.account_status | api-platform |

## 状态颜色标签（D4 消费）

| 枚举 | 值→颜色 |
|------|---------|
| DeckStatus | DRAFT→gray · ITERATING→blue · FINALIZED→green · ARCHIVED→gray |
| TaskStatus | QUEUED→gray · RUNNING→blue · SUCCEEDED→green · FAILED→red · CANCELLED→gray |
| ExportStatus | QUEUED→gray · RENDERING→blue · SUCCEEDED→green · FAILED→red · CANCELLED→gray |
| AssetStatus | ACTIVE→green · DISABLED→gray |
