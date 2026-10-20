# 下拉选择服务池（deck-loop）

> D3/D4 阶段登记下拉数据的服务来源。前端选择器统一经服务标识消费（Gateway `/*/select/**` 直连），禁止业务模块自建 proxy/select 接口（Node API 规约 06，v3）。
> D3 v1.0 首次填充（2026-10-07）。

| 服务标识 | 路径 | 域 | 返回结构 | 引用方 |
|---------|------|-----|---------|--------|
| asset.select.assetList | POST /asset/select/asset-list | 素材品牌域 | SelectOption{value=assetId, label=assetName}＋扩展{assetType,url} | 生成/调整引用素材、品牌规范标志选择 |
| asset.select.brandkitList | POST /asset/select/brandkit-list | 素材品牌域 | SelectOption{value=brandKitId, label=kitName}＋扩展{isDefault} | 创作物默认规范、指令品牌约束 |
| asset.select.promptList | POST /asset/select/prompt-list | 话术域 | SelectOption{value=templateId, label=title}＋扩展{content,templateScene} | 指令输入话术选用 |
| channel.select.modelOptions | POST /channel/select/model-options | AI 网关域 | SelectOption{value=channelCode::modelCode, label=渠道/模型名}＋扩展{capabilityTags} | 渠道偏好设置 |
| deck.select.deckList | POST /deck/select/deck-list | 创作迭代域 | SelectOption{value=deckId, label=deckName}＋扩展{deckStatus,deckType} | 导出记录筛选等跨页引用 |

> 入池规则：新数据源先在所属域 Provider/Select Controller 建端点并登记本池，再以服务标识引用。
