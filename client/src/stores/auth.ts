/**
 * 认证态（pinia）。
 *
 * - token 来源：POST /auth/account/login（VO: token/nickname，30 天滑动）
 * - 持久化：localStorage（F 阶段 TODO：迁 Tauri Stronghold 安全存储，
 *   对应 auth.md「token 持久化（本地安全存储）」）
 * - X-Auth-Token 头注入：main.ts 装配时经 setAuthBridge 接入 request.ts
 * - 401 / BIZ_AUTH_SESSION_EXPIRED：forceLogout() 清态回 /auth
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { message } from 'ant-design-vue'

import { executeAction } from '@/engine/actionExecutor'
import { clearDictCache } from '@/engine/dict'
import { useSyncStore } from './sync'

interface AccountProfile {
  accountId: string
  email: string
  nickname: string
}

const TOKEN_KEY = 'dl_token'
const NICKNAME_KEY = 'dl_nickname'

interface LoginVO {
  token: string
  nickname: string
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const nickname = ref<string | null>(localStorage.getItem(NICKNAME_KEY))

  const isLoggedIn = computed(() => !!token.value)

  function persist(nextToken: string | null, nextNickname: string | null): void {
    token.value = nextToken
    nickname.value = nextNickname
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken)
    else localStorage.removeItem(TOKEN_KEY)
    if (nextNickname) localStorage.setItem(NICKNAME_KEY, nextNickname)
    else localStorage.removeItem(NICKNAME_KEY)
  }

  /** 登录（action: auth.login，PageSpec auth.md §2） */
  async function login(email: string, password: string): Promise<void> {
    const vo = await executeAction<LoginVO>('auth.login', { email, password })
    if (!vo?.token) throw new Error('登录响应缺少 token')
    useSyncStore().reset()
    persist(vo.token, vo.nickname ?? null)
  }

  /** 登出（尽力调后端，失败不阻断本地清态；路由跳转由调用方负责） */
  async function logout(): Promise<void> {
    try {
      if (token.value) await executeAction('auth.logout', {})
    } catch {
      // 后端登出失败不阻断本地退出
    } finally {
      forceLogout(false)
    }
  }

  /**
   * 昵称更新回写（设置中心-账户 Tab 昵称编辑接线，settings.md §6；
   * auth.account/profile 保存成功后调用：顶栏昵称即时更新 + 持久化）。
   */
  function updateNickname(next: string): void {
    persist(token.value, next)
  }

  /**
   * Resolve the authenticated account before reading its persisted sync checkpoint.
   */
  async function loadProfile(): Promise<AccountProfile> {
    const sessionToken = token.value
    const profile = await executeAction<AccountProfile>('auth.profile', {})
    if (!sessionToken || sessionToken !== token.value) throw new Error('账户会话已变更')
    if (!profile.accountId) throw new Error('账户信息缺少 accountId')
    useSyncStore().bindAccount(profile.accountId)
    updateNickname(profile.nickname)
    return profile
  }

  async function syncNow(): Promise<number> {
    await loadProfile()
    return useSyncStore().pull()
  }

  async function initialSync(): Promise<void> {
    try {
      await syncNow()
    } catch {
      // 首次同步失败不阻断进入应用
    }
  }

  /**
   * 会话失效（401 / BIZ_AUTH_SESSION_EXPIRED）全局回调：
   * 清态 + 清字典缓存。跳转 /auth 由 main.ts 认证桥统一执行。
   */
  function forceLogout(notify = true): void {
    useSyncStore().reset()
    persist(null, null)
    clearDictCache()
    if (notify) message.warning('会话已过期，请重新登录')
  }

  return {
    token,
    nickname,
    isLoggedIn,
    login,
    logout,
    updateNickname,
    initialSync,
    loadProfile,
    syncNow,
    forceLogout,
  }
})
