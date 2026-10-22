<script setup lang="ts">
/**
 * 应用根组件：登录页全屏裸渲染；其余路由为侧边导航布局骨架
 * （创作物 / 素材 / 设置 等主导航占位出口）。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppstoreOutlined,
  FolderOutlined,
  ExportOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons-vue'
import type { Component } from 'vue'

import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { getDlTheme } from '@/styles/theme'
import { useSyncStore } from '@/stores/sync'
import { useLogout } from '@/composables/useLogout'
import LogoMark from '@/components/LogoMark.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const appearance = useAppearanceStore()
const sync = useSyncStore()
const { confirmLogout, loggingOut } = useLogout()

const themeConfig = computed(() => getDlTheme(appearance.isDark))
const isBare = computed(() => route.meta.bare === true)
const selectedKeys = computed<string[]>(() => [route.path])

interface NavItem {
  key: string
  label: string
  icon: Component
}

const navItems: NavItem[] = [
  { key: '/deck', label: '创作物', icon: AppstoreOutlined },
  { key: '/assets', label: '素材库', icon: FolderOutlined },
  { key: '/deliver', label: '导出交付', icon: ExportOutlined },
  { key: '/settings', label: '设置', icon: SettingOutlined },
]

const collapsed = ref(false)

function onNavClick(e: { key: string | number }): void {
  void router.push(String(e.key))
}

</script>

<template>
  <a-config-provider :theme="themeConfig">
    <!-- 登录等裸页 -->
    <router-view v-if="isBare" :key="`${sync.accountId}:${sync.revision}`" />

    <!-- 侧边导航布局骨架 -->
    <a-layout v-else class="dl-layout">
      <a-layout-sider v-model:collapsed="collapsed" :width="200" class="dl-sider">
        <div class="dl-logo">
          <LogoMark :size="collapsed ? 26 : 22" />
          <span v-if="!collapsed" class="dl-logo-text">Deck-Loop</span>
        </div>
        <a-menu
          mode="inline"
          :selected-keys="selectedKeys"
          @click="onNavClick"
        >
          <a-menu-item v-for="item in navItems" :key="item.key">
            <component :is="item.icon" />
            <span>{{ item.label }}</span>
          </a-menu-item>
        </a-menu>
        <div class="dl-sider-footer">
          <a-button
            v-if="auth.isLoggedIn"
            type="text"
            size="small"
            :loading="loggingOut"
            @click="confirmLogout"
          >
            <LogoutOutlined />
            <span v-if="!collapsed">退出登录</span>
          </a-button>
        </div>
      </a-layout-sider>
      <a-layout>
        <a-layout-header class="dl-header">
          <!-- 07 v2.0：页面标题移入各页表面页头行，顶栏只留账号与设置入口 -->
          <span class="dl-header-right">
            <span v-if="auth.nickname" class="dl-header-user">{{ auth.nickname }}</span>
            <!-- settings.md §1：主窗口右上角设置入口 -->
            <a-button type="text" size="small" @click="router.push('/settings')">
              <SettingOutlined />
            </a-button>
          </span>
        </a-layout-header>
        <a-layout-content class="dl-content">
          <router-view :key="`${sync.accountId}:${sync.revision}`" />
        </a-layout-content>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>

<style scoped>
.dl-layout {
  height: 100%;
}

.dl-logo {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid var(--dl-border-light);
}

.dl-logo-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--dl-title-color);
  white-space: nowrap;
}

.dl-sider-footer {
  position: absolute;
  bottom: 12px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
}

.dl-header {
  /* 07 v2.0：顶栏属内容表面——表面底色 + 底部分隔线，高度 48 */
  height: 48px;
  line-height: 48px;
  background: var(--dl-card-bg);
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-bottom: 1px solid var(--dl-border-light);
}

.dl-header-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dl-header-user {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.dl-content {
  /* 07 v2.0：内容区即单表面（#1f1f1f），页面贴壳满幅 */
  background: var(--dl-card-bg);
  overflow-y: auto;
}
</style>
