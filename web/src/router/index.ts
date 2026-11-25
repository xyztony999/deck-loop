/**
 * 路由（前端静态配置，规约 §1.6；菜单显示项由导航配置驱动，不动态生成路由）。
 *
 * ADR-018 路由结构（web/index.md §2）：退役 /gen、/deck/:deckId/generate、
 * /adjust、/deck/:deckId/iterate、/export-render（访问经 catch-all 重定向 /deck）；
 * /login 保留 → /auth 别名。compare/present 归 deck 域。
 */
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/auth',
    name: 'auth',
    component: () => import('@/views/auth/index.vue'),
    meta: { title: '登录 / 注册', public: true, bare: true },
  },
  // 旧入口兼容别名
  {
    path: '/login',
    redirect: '/auth',
  },
  {
    // 创作物列表（启动首页）
    path: '/deck',
    name: 'deck-list',
    component: () => import('@/views/deck/index.vue'),
    meta: { title: '创作物' },
  },
  {
    // 新建/编辑向导（两步；?deckId= 为编辑态）
    path: '/deck/new',
    name: 'deck-new',
    component: () => import('@/views/deck/new.vue'),
    meta: { title: '新建创作物' },
  },
  {
    // 详情工作台（版本树 + 预览画布 + 大纲编辑 + agent 引导）
    path: '/deck/:deckId',
    name: 'deck-detail',
    component: () => import('@/views/deck/detail.vue'),
    meta: { title: '创作物详情' },
  },
  {
    // 版本对比（?left=&right=）
    path: '/deck/:deckId/compare',
    name: 'deckCompare',
    component: () => import('@/views/deck/compare.vue'),
    meta: { title: '版本对比' },
  },
  {
    // 全屏放映（?versionId=；bare 脱壳，浏览器侧渲染）
    path: '/deck/:deckId/present',
    name: 'deckPresent',
    component: () => import('@/views/deck/present.vue'),
    meta: { title: '放映', bare: true },
  },
  {
    // 资产中心（三 Tab：素材/品牌规范/话术库；?tab=&highlight= 直达）
    path: '/assets',
    name: 'assets',
    component: () => import('@/views/assets/index.vue'),
    meta: { title: '素材库' },
  },
  {
    // 导出记录中心（仅下载；?deckId= 预选）
    path: '/deliver',
    name: 'deliver',
    component: () => import('@/views/deliver/index.vue'),
    meta: { title: '导出交付' },
  },
  {
    // 设置中心（Tab：账户/API token/外观）
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/settings/index.vue'),
    meta: { title: '设置' },
  },
  {
    path: '/',
    redirect: '/deck',
  },
  {
    // 退役路由（/gen、/adjust、/export-render 等）与未知路径统一重定向 /deck
    path: '/:pathMatch(.*)*',
    redirect: '/deck',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局路由守卫：无 token 一律重定向 /auth（auth.md §4）
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn) {
    return { path: '/auth', query: { redirect: to.fullPath } }
  }
  if (to.path === '/auth' && auth.isLoggedIn) {
    return { path: '/deck' }
  }
  return true
})

export default router