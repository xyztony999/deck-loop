<script setup lang="ts">
/**
 * 话术模板选择器（PageSpec adjustment.md §4.2 话术模板选择）。
 *
 * - 数据源：asset 选择池 POST /asset/select/prompt-list
 *   （action adjust.promptSelect，关键词搜索）；
 * - 选项需携带模板正文（content，含 {占位符}）供指令输入区插入——
 *   RemoteSelectField 只保留 value/label，故此处独立实现（复用其
 *   归一化思路：value←templateId，label←title）；
 * - 选用即计数：POST /asset/prompt/touch（adjust.promptTouch，静默失败）。
 */
import { ref } from 'vue'

import { executeAction } from '@/engine'

export interface PromptTemplateOption {
  templateId: string
  title: string
  content: string
}

defineProps<{
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'select', tpl: PromptTemplateOption): void
}>()

const loading = ref(false)
const options = ref<PromptTemplateOption[]>([])
const selectedId = ref<string>()

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/** 选择池响应归一（SelectOption+扩展：templateId/title/content） */
function normalize(raw: unknown): PromptTemplateOption[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { records?: unknown[] } | null)?.records)
      ? ((raw as { records?: unknown[] }).records as unknown[])
      : []
  const result: PromptTemplateOption[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const templateId = firstString(it.templateId, it.promptId, it.value)
    if (!templateId) continue
    const title = firstString(it.title, it.label, templateId) as string
    const content = firstString(it.content, it.templateContent) ?? ''
    result.push({ templateId, title, content })
  }
  return result
}

async function load(keyword = ''): Promise<void> {
  loading.value = true
  try {
    const data = await executeAction<unknown>('adjust.promptSelect', {
      keyword,
    })
    options.value = normalize(data)
  } finally {
    loading.value = false
  }
}

let searchTimer: number | undefined
function onSearch(keyword: string): void {
  if (searchTimer != null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void load(keyword.trim())
  }, 300)
}

function onSelect(value: unknown): void {
  const id = typeof value === 'string' ? value : ''
  const tpl = options.value.find((o) => o.templateId === id)
  // 用后即清空选择，允许连续选用多个模板
  selectedId.value = undefined
  if (!tpl) return
  emit('select', tpl)
  // 使用计数 +1（api-assets.md §4.4 touch；失败静默不打扰输入）
  void executeAction('adjust.promptTouch', { templateId: tpl.templateId }).catch(
    () => undefined,
  )
}
</script>

<template>
  <a-select
    class="dl-prompt-select"
    :value="selectedId"
    :options="options.map((o) => ({ value: o.templateId, label: o.title }))"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder ?? '搜索并选用话术模板（插入指令输入区）'"
    allow-clear
    show-search
    :filter-option="false"
    @focus="() => void load()"
    @search="onSearch"
    @update:value="(v: unknown) => onSelect(v)"
  />
</template>

<style scoped>
.dl-prompt-select {
  width: 100%;
}
</style>
