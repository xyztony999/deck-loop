# 服务池

> D3 完成后回填（2026-10-07）。详细契约见 workspace/01-solution/common-spec/05-select-service-pool.md 与 api-index.md。

## 对外服务（域内 OHS / Select）

| 标识 | 路径 | 域 | 返回结构 |
|------|------|-----|---------|
| asset.select.assetList | POST /asset/select/asset-list | 素材品牌 | SelectOption+{assetType,url} |
| asset.select.brandkitList | POST /asset/select/brandkit-list | 素材品牌 | SelectOption+{isDefault} |
| asset.select.promptList | POST /asset/select/prompt-list | 话术 | SelectOption+{content,templateScene} |
| channel.select.modelOptions | POST /channel/select/model-options | AI 网关 | SelectOption+{capabilityTags} |
| deck.select.deckList | POST /deck/select/deck-list | 创作迭代 | SelectOption+{deckStatus,deckType} |

## 域内进程内服务（单服务）

| 服务 | 提供方 | 消费方 |
|------|--------|--------|
| DeckDomainService（assertCanCreateTask/onFirstVersionCreated/movePointer） | C-01 | C-02/C-03/C-04 任务与指针编排 |
| GatewayTaskService#execute / ChannelRegistryService#listEnabled | P-01 | C-02/C-03/D-01 |
| ChannelPreferenceService#resolve(taskType,userId) | D-01 | 任务路由 |
| AssetRepository#refCount 原子更新 / 素材文件 URL 签发 | S-01 | 版本留档回调、导出渲染 |
