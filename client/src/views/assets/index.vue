<script setup lang="ts">
/**
 * 资产中心（/assets；PageSpec assets.md 三 Tab 列表）。
 *
 * - Tab：素材库（网格卡片）/ 品牌规范（表格）/ 话术库（表格）；
 * - 三 Tab 查询状态独立保持（§8）：a-tabs 默认不销毁非活动面板，各 Tab
 *   组件挂载后自行保持查询/分页状态；
 * - §8 工作台引用选择器直达：/assets?tab=asset|brandkit|prompt&highlight=
 *   {assetId} —— tab 决定初始页签，highlight 驱动素材卡片高亮；
 * - 页面类型 config（master_data），引擎 DlListPage ×3 组合（deck-loop
 *   引擎无 tab 布局容器，页签壳为 hybrid code 区，gen/index.vue 同例）。
 */
import { ref } from 'vue'
import { useRoute } from 'vue-router'

import AssetTab from './AssetTab.vue'
import BrandkitTab from './BrandkitTab.vue'
import PromptTab from './PromptTab.vue'
import { registerAssetDictColors } from './assets.shared'

registerAssetDictColors()

type TabKey = 'asset' | 'brandkit' | 'prompt'
const TAB_KEYS: TabKey[] = ['asset', 'brandkit', 'prompt']

const route = useRoute()

function firstQuery(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

const tabQuery = firstQuery(route.query.tab)
const initialTab: TabKey =
  tabQuery != null && TAB_KEYS.includes(tabQuery as TabKey)
    ? (tabQuery as TabKey)
    : 'asset'

const activeKey = ref<TabKey>(initialTab)

/** 工作台引用选择器直达的素材高亮（PageSpec §8） */
const highlightAssetId = firstQuery(route.query.highlight)
</script>

<template>
  <div class="dl-page assets-page">
    <div class="dl-page-card assets-shell">
      <a-tabs v-model:active-key="activeKey" class="assets-tabs">
        <a-tab-pane key="asset" tab="素材库">
          <AssetTab :highlight-asset-id="highlightAssetId" />
        </a-tab-pane>
        <a-tab-pane key="brandkit" tab="品牌规范">
          <BrandkitTab />
        </a-tab-pane>
        <a-tab-pane key="prompt" tab="话术库">
          <PromptTab />
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<style scoped>
.assets-shell {
  padding: 8px 16px 16px;
}

/* 内嵌 DlListPage：去掉其页面级灰底/内边距，融入 Tab 卡片（gen 先例） */
.assets-tabs :deep(.dl-page) {
  padding: 0;
  background: transparent;
  min-height: auto;
}

.assets-tabs :deep(.dl-page-card) {
  box-shadow: none;
  padding: 0;
}

.assets-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 12px;
}
</style>
