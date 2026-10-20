/**
 * auth 域 action（来源：PageSpec auth.md §2 + api-platform.md §4.4 接口清单）。
 */
import { defineModule } from '@/engine/actionExecutor'

export const authModule = defineModule('auth', {
  'auth.login': { method: 'POST', path: '/auth/account/login', type: 'other' },
  'auth.register': { method: 'POST', path: '/auth/account/register', type: 'other' },
  'auth.logout': { method: 'POST', path: '/auth/account/logout', type: 'other' },
  'auth.profile': { method: 'POST', path: '/auth/account/profile', type: 'detail' },
  // auth.md §3「首次进入触发一次 sync_pull」（api-platform.md §4.4）
  'auth.syncPull': { method: 'POST', path: '/auth/sync/pull', type: 'other' },
})
