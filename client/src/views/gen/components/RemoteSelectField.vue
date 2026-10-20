<script setup lang="ts">
/**
 * 远程选择字段：素材多选 / 品牌规范单选（选择池端点服务端搜索）。
 *
 * 数据源为 asset 域选择池（/asset/select/asset-list、brandkit-list，
 * AO: keyword —— api-assets.md §4.4）。选择池响应为 SelectOption+扩展，
 * 这里对 value/label 与扩展字段（assetId/assetName、brandKitId/kitName）
 * 做归一兼容。选中项标签进入本地缓存，列表被搜索替换后仍可回显。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'

import { executeAction } from '@/engine/actionExecutor'

interface NormalOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** 已注册的选择池 action key */
    actionKey: string
    /** 绑定值：multiple 为 string[]，否则 string（可空） */
    modelValue: string | string[]
    multiple?: boolean
    /** 多选上限（素材引用 ≤10，INV 校验前置） */
    maxCount?: number
    placeholder?: string
    /** 单选回显：外部预填值（如 deck 默认规范）的标签 */
    initialLabel?: string
    allowClear?: boolean
  }>(),
  {
    multiple: false,
    maxCount: undefined,
    placeholder: '搜索选择',
    initialLabel: undefined,
    allowClear: true,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[] | string): void
  /** 单选模式：当前选中项标签（品牌规范名汇总预览用） */
  (e: 'update:label', label: string): void
}>()

const loading = ref(false)
const options = ref<NormalOption[]>([])
/** 已选值 → 标签缓存（搜索列表替换后回显 + 提交前展示） */
const labelCache = new Map<string, string>()

if (props.initialLabel) {
  const v = Array.isArray(props.modelValue) ? props.modelValue[0] : props.modelValue
  if (v) labelCache.set(v, props.initialLabel)
}

// ---------------------------------------------------------------
// 数据加载（选择池 keyword 搜索）
// ---------------------------------------------------------------

function normalize(raw: unknown): NormalOption[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { records?: unknown[] } | null)?.records)
      ? ((raw as { records?: unknown[] }).records as unknown[])
      : []
  const result: NormalOption[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const value = firstString(it.value, it.assetId, it.brandKitId, it.promptId)
    const label = firstString(it.label, it.assetName, it.kitName, it.title, value)
    if (value) result.push({ value, label: label || value })
  }
  return result
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

async function load(keyword = ''): Promise<void> {
  loading.value = true
  try {
    const data = await executeAction<unknown>(props.actionKey, { keyword })
    options.value = normalize(data)
    for (const opt of options.value) labelCache.set(opt.value, opt.label)
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

onMounted(() => {
  void load()
})

// ---------------------------------------------------------------
// 值绑定（严格类型：多选 string[] / 单选 string）
// ---------------------------------------------------------------

const innerValue = computed<string[] | string | undefined>(() => props.modelValue)

/** 选项 = 搜索结果 + 已选但不在结果中的缓存项（保证回显） */
const mergedOptions = computed<NormalOption[]>(() => {
  const extra: NormalOption[] = []
  const values = Array.isArray(props.modelValue) ? props.modelValue : props.modelValue ? [props.modelValue] : []
  const known = new Set(options.value.map((o) => o.value))
  for (const v of values) {
    if (known.has(v)) continue
    extra.push({ value: v, label: labelCache.get(v) ?? v })
  }
  return [...extra, ...options.value]
})

function onChange(next: unknown): void {
  if (props.multiple) {
    const arr = Array.isArray(next) ? next.map(String) : []
    if (props.maxCount != null && arr.length > props.maxCount) {
      message.warning(`最多选择 ${props.maxCount} 项`)
      return // 超限拒绝：保持原值
    }
    for (const o of options.value) {
      if (arr.includes(o.value)) labelCache.set(o.value, o.label)
    }
    emit('update:modelValue', arr)
  } else {
    const v = typeof next === 'string' ? next : ''
    emit('update:modelValue', v)
    emit('update:label', v ? labelCache.get(v) ?? v : '')
  }
}

// 外部预填值变化时同步缓存标签（deck 默认规范）
watch(
  () => props.modelValue,
  (v) => {
    const first = Array.isArray(v) ? v[0] : v
    if (first && props.initialLabel && !labelCache.has(first)) {
      labelCache.set(first, props.initialLabel)
    }
  },
)
</script>

<template>
  <a-select
    class="dl-remote-select"
    :mode="multiple ? 'multiple' : undefined"
    :value="(innerValue as string[] | string | undefined)"
    :options="mergedOptions"
    :loading="loading"
    :max-tag-count="multiple ? 3 : undefined"
    :placeholder="placeholder"
    :allow-clear="allowClear"
    show-search
    :filter-option="false"
    option-filter-prop="label"
    @search="onSearch"
    @update:value="(v: unknown) => onChange(v)"
  />
</template>

<style scoped>
.dl-remote-select {
  width: 100%;
}
</style>
