<script setup lang="ts">
/**
 * 设置中心（/settings；PageSpec settings.md：ScmCardPage layout 'tab' 的
 * deck-loop 等价——三 Tab 惰性挂载）。
 *
 * Tab1 生成偏好：默认渠道/模型 + 分任务档位（channel 域偏好与选择池）；
 * Tab2 用量统计：channel.usage/summary 三维度只读台账（无导出）；
 * Tab3 账户：资料编辑 / 多端同步 / 会话退出（auth 域跨域复用 action）。
 *
 * 入口：主窗口侧边导航「设置」+ 主窗口右上设置图标位（App.vue 骨架，
 * settings.md §1/§7）。
 */
import GeneralTab from './components/GeneralTab.vue'
import PreferenceTab from './components/PreferenceTab.vue'
import UsageTab from './components/UsageTab.vue'
import AccountTab from './components/AccountTab.vue'
</script>

<template>
  <div class="dl-page">
    <div class="dl-page-card settings-card">
      <a-tabs default-active-key="preference" class="settings-tabs">
        <a-tab-pane key="general" tab="通用">
          <GeneralTab />
        </a-tab-pane>
        <a-tab-pane key="preference" tab="生成偏好">
          <PreferenceTab />
        </a-tab-pane>
        <a-tab-pane key="usage" tab="用量统计">
          <UsageTab />
        </a-tab-pane>
        <a-tab-pane key="account" tab="账户">
          <AccountTab />
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<style scoped>
.settings-card {
  padding-bottom: 8px;
}

/* Tab 内容区去掉 antd tabs 默认上边距，交给各 Tab 卡片间距 */
.settings-tabs :deep(.ant-tabs-content-holder) {
  padding: 0 0 8px;
}
</style>
