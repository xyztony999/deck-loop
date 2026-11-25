import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import type { DlAppearanceMode } from '@/styles/theme'

const STORAGE_KEY = 'dl-appearance-mode'
const MODES: DlAppearanceMode[] = ['light', 'dark', 'auto']

function readStoredMode(): DlAppearanceMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return MODES.includes(raw as DlAppearanceMode) ? (raw as DlAppearanceMode) : 'auto'
}

/**
 * 外观偏好（亮/暗/跟随系统），localStorage 持久化；
 * 解析结果经 <html data-dl-theme="dark|light"> 驱动 global.less 的 CSS 变量切换，
 * 并由 App.vue 的 ConfigProvider 切 darkAlgorithm。
 */
export const useAppearanceStore = defineStore('dl-appearance', () => {
  const mode = ref<DlAppearanceMode>(readStoredMode())
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemDark.value = e.matches
  })

  const isDark = computed(() => (mode.value === 'auto' ? systemDark.value : mode.value === 'dark'))

  function apply(): void {
    document.documentElement.dataset.dlTheme = isDark.value ? 'dark' : 'light'
  }

  watch([mode, systemDark], apply, { immediate: true })
  watch(mode, (next) => localStorage.setItem(STORAGE_KEY, next))

  function setMode(next: DlAppearanceMode): void {
    mode.value = next
  }

  function cycleMode(): void {
    mode.value = MODES[(MODES.indexOf(mode.value) + 1) % MODES.length]!
  }

  return { mode, isDark, setMode, cycleMode }
})
