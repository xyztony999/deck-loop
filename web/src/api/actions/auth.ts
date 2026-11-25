/**
 * auth 域 action（来源：PageSpec auth.md §2 / settings.md §2 +
 * api-platform.md §4.4 + api-web-agent.md §4.1 个人 API token 三端点）。
 *
 * ADR-018：网站直读 PG 单源，不经同步模块——sync/pull 保留服务端但网站不消费
 * （仅 MCP 本地离线模式），故此处不注册 auth.syncPull。
 */
import { defineModule } from '@/engine/actionExecutor'

export const authModule = defineModule('auth', {
  'auth.login': { method: 'POST', path: '/auth/account/login', type: 'other' },
  'auth.register': { method: 'POST', path: '/auth/account/register', type: 'other' },
  'auth.logout': { method: 'POST', path: '/auth/account/logout', type: 'other' },
  'auth.profile': { method: 'POST', path: '/auth/account/profile', type: 'detail' },
  // 个人 API token（api-web-agent §4.1；会话守卫，网站设置页消费）
  'auth.tokenIssue': { method: 'POST', path: '/auth/token/issue', type: 'other' },
  'auth.tokenRevoke': { method: 'POST', path: '/auth/token/revoke', type: 'other' },
  'auth.tokenList': { method: 'POST', path: '/auth/token/list', type: 'list' },
})
