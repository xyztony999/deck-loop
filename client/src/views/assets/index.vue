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
  <!-- 07 v2.0：Tab 坐表面顶部（下划线式），Tab 内容 = 引擎单表面列表 -->
  <div class="dl-page assets-page">
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
</template>

<style scoped>
.assets-page {
  /* Tab 流占满表面：页签行贴顶、内容区随内容伸展 */
  display: flex;
  flex-direction: column;
}

.assets-tabs {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
}

.assets-tabs :deep(.ant-tabs-content-holder) {
  flex: 1 0 auto;
}

.assets-tabs :deep(.ant-tabs-nav) {
  margin: 0;
  padding: 8px 24px 0;
}

/* 内嵌引擎 .dl-page：嵌套场景不占满屏，随 Tab 内容伸展 */
.assets-tabs :deep(.dl-page) {
  min-height: auto;
}
</style>
