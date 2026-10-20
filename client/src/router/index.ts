/**
 * 路由（前端静态配置，规约 §1.6；菜单显示项由导航配置驱动，不动态生成路由）。
 *
 * F1 为七组占位路由 + 懒加载占位页；F2-F4 按各 PageSpec 的「路由定义」
 * 逐步替换为真实页面（如 /deck/:deckId、/deck/:deckId/iterate 等）。
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
  // F1 占位期为 /login；PageSpec auth.md §4 收敛为 /auth，留 redirect 别名兼容旧入口
  {
    path: '/login',
    redirect: '/auth',
  },
  {
    // PageSpec deck.md §7：/deck 列表（启动首页）
    path: '/deck',
    name: 'deck-list',
    component: () => import('@/views/deck/index.vue'),
    meta: { title: '创作物' },
  },
  {
    // PageSpec deck.md §7：/deck/new 新建向导（三步；?deckId= 为编辑态）
    path: '/deck/new',
    name: 'deck-new',
    component: () => import('@/views/deck/new.vue'),
    meta: { title: '新建创作物' },
  },
  {
    // PageSpec deck.md §7：/deck/:deckId 详情
    path: '/deck/:deckId',
    name: 'deck-detail',
    component: () => import('@/views/deck/detail.vue'),
    meta: { title: '创作物详情' },
  },
  {
    path: '/gen',
    name: 'gen',
    component: () => import('@/views/gen/index.vue'),
    meta: { title: '生成向导' },
  },
  {
    // PageSpec generation.md §6：/deck/:deckId/generate（与 /gen?deckId= 同页双入口）
    path: '/deck/:deckId/generate',
    name: 'deckGenerate',
    component: () => import('@/views/gen/index.vue'),
    meta: { title: '生成向导' },
  },
  {
    path: '/adjust',
    name: 'adjust',
    component: () => import('@/views/adjust/index.vue'),
    meta: { title: '迭代工作台' },
  },
  {
    // PageSpec adjustment.md §1/§6：/deck/:deckId/iterate（详情「进入迭代工作台」
    // 落地页；与 /adjust?deckId= 同页双入口）
    path: '/deck/:deckId/iterate',
    name: 'deckIterate',
    component: () => import('@/views/adjust/index.vue'),
    meta: { title: '迭代工作台' },
  },
  {
    path: '/deck/:deckId/compare',
    name: 'deckCompare',
    component: () => import('@/views/adjust/compare.vue'),
    meta: { title: '版本对比' },
  },
  {
    // ADR-015：导出本地渲染隐藏窗口（PageSpec delivery.md §5；bare 脱壳，
    // 内容经 localStorage 通道由 services/exportRender.ts 驱动）
    path: '/export-render',
    name: 'exportRender',
    component: () => import('@/views/export/render-view.vue'),
    meta: { bare: true },
  },
  {
    // PageSpec delivery.md §6：/deck/:deckId/present 演示放映（S-03
    // 全屏 code 页；bare 脱离侧边导航骨架，详情/工作台 [演示] 入口）
    path: '/deck/:deckId/present',
    name: 'deckPresent',
    component: () => import('@/views/deliver/present.vue'),
    meta: { title: '演示', bare: true },
  },
  {
    // PageSpec assets.md §7：/assets 资产中心（三 Tab：素材/品牌规范/话术库；
    // ?tab=&highlight= 为工作台引用选择器直达入口，assets.md §8）
    path: '/assets',
    name: 'assets',
    component: () => import('@/views/assets/index.vue'),
    meta: { title: '素材库' },
  },
  {
    // PageSpec delivery.md §6：/deliver 导出记录中心（C-06；
    // ?deckId= 为详情/工作台 [导出] 入口预选，delivery.md §1）
    path: '/deliver',
    name: 'deliver',
    component: () => import('@/views/deliver/index.vue'),
    meta: { title: '导出交付' },
  },
  {
    // PageSpec settings.md §7：/settings 设置中心（Tab: 生成偏好/用量统计/账户）
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
    path: '/:pathMatch(.*)*',
    redirect: '/deck',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局路由守卫：无 token 一律重定向 /auth（auth.md §5）
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
