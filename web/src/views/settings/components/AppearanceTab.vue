<script setup lang="ts">
/**
 * 外观 Tab（PageSpec settings.md §5）：主题三态（跟随系统/亮/暗，默认跟随系统）。
 * 暗色锚定 ADR-014 三层色板（theme.ts/global.less --dl-* 同值）；预览画布文档
 * 表面永远白纸，不受主题影响（07 §1）。客户端本地能力，不入业务接口。
 */
import { useAppearanceStore } from '@/stores/appearance'
import type { DlAppearanceMode } from '@/styles/theme'

const appearance = useAppearanceStore()

const options: Array<{ label: string; value: DlAppearanceMode }> = [
  { label: '跟随系统', value: 'auto' },
  { label: '亮色', value: 'light' },
  { label: '暗色', value: 'dark' },
]

function onModeChange(v: unknown): void {
  appearance.setMode(v as DlAppearanceMode)
}
</script>

<template>
  <div class="dl-tab-section">
    <div class="dl-section-title">外观</div>
    <div class="general-row">
      <div class="general-meta">
        <div class="general-label">主题模式</div>
        <div class="general-hint">界面配色方案；「跟随系统」随操作系统外观实时切换</div>
      </div>
      <a-radio-group
        :value="appearance.mode"
        :options="options"
        option-type="button"
        button-style="solid"
        @update:value="onModeChange"
      />
    </div>
  </div>
</template>

<style scoped>
.general-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.general-label {
  font-weight: 600;
  color: var(--dl-title-color);
}

.general-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--dl-text-secondary);
}
</style>
