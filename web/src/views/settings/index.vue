<script setup lang="ts">
/**
 * 设置中心（/settings?tab=account|token|appearance；PageSpec settings.md）。
 *
 * ADR-018：移除生成偏好/用量统计/模型渠道三 Tab（随网关退役）；
 * 三 Tab：账户（资料/会话）· API token（签发/吊销/列表）· 外观（主题三态）。
 * Tab 坐表面顶部下划线式，Tab 内小节流（分隔线 + 小节标题，禁卡中卡）。
 * 入口：顶栏用户菜单「设置」（App.vue 骨架）。
 */
import { ref } from 'vue'
import { useRoute } from 'vue-router'

import AccountTab from './components/AccountTab.vue'
import TokenTab from './components/TokenTab.vue'
import AppearanceTab from './components/AppearanceTab.vue'

type TabKey = 'account' | 'token' | 'appearance'
const TAB_KEYS: TabKey[] = ['account', 'token', 'appearance']

const route = useRoute()

function firstQuery(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

const tabQuery = firstQuery(route.query.tab)
const initialTab: TabKey =
  tabQuery != null && TAB_KEYS.includes(tabQuery as TabKey) ? (tabQuery as TabKey) : 'account'

const activeKey = ref<TabKey>(initialTab)
</script>

<template>
  <div class="dl-page settings-page">
    <a-tabs v-model:active-key="activeKey" class="settings-tabs">
      <a-tab-pane key="account" tab="账户">
        <AccountTab />
      </a-tab-pane>
      <a-tab-pane key="token" tab="API token">
        <TokenTab />
      </a-tab-pane>
      <a-tab-pane key="appearance" tab="外观">
        <AppearanceTab />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
}

.settings-tabs {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
}

.settings-tabs :deep(.ant-tabs-content-holder) {
  flex: 1 0 auto;
}

.settings-tabs :deep(.ant-tabs-nav) {
  margin: 0;
  padding: 8px 24px 0;
}
</style>