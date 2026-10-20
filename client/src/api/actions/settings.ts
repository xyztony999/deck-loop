/**
 * channel 域 action（来源：PageSpec settings.md §2 Action 定义 +
 * api-channel.md §4.4 接口清单）。
 *
 * - 仅注册 channel 域 4 个接口；PageSpec §2 的 account_profile / sync_pull /
 *   logout 为跨域 auth 接口，auth.ts 已注册（auth.profile / auth.syncPull /
 *   auth.logout），registerModule 对重复 key 直接抛错，故此处只导出复用键
 *   常量、不重复注册（与 deck.ts 的跨域键名隔离先例一致）。
 * - channel 域无 dict 端点：api-channel.md §3.4「无独立业务枚举（档位键=
 *   TaskType）」，故 dict.ts 不注册 channel.dictBatch；档位分组标签走
 *   gen 域字典 task.TaskType（settings.md §3）。
 */
import { defineModule } from '@/engine/actionExecutor'

export const channelModule = defineModule('channel', {
  preferenceDetail: {
    method: 'POST',
    path: '/channel/preference/detail',
    type: 'detail',
  },
  preferenceSave: {
    method: 'POST',
    path: '/channel/preference/save',
    type: 'save',
  },
  modelOptions: {
    method: 'POST',
    path: '/channel/select/model-options',
    type: 'list',
  },
  usageSummary: {
    method: 'POST',
    path: '/channel/usage/summary',
    type: 'list',
  },
})

/**
 * PageSpec settings.md §2 跨域复用 action key（auth.ts 已注册）。
 * 页面经这些常量调用，避免散落魔法字符串。
 */
export const SETTINGS_AUTH_ACTIONS = {
  /** 账户资料读/改昵称（api-platform.md §4.4 account/profile） */
  accountProfile: 'auth.profile',
  /** 手动同步（api-platform.md §4.4 sync/pull） */
  syncPull: 'auth.syncPull',
  /** 退出登录 */
  logout: 'auth.logout',
} as const
