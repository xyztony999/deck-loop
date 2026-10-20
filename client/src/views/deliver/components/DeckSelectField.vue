<script setup lang="ts">
/**
 * 创作物选择字段（deck.select.deckList 选择池，服务端搜索单选）。
 *
 * - PageSpec delivery.md §4.1 deckId 查询为 modalSelect、§4.2 新建导出弹层
 *   限 FINALIZED——引擎查询字段无该类型，数据量不可预估（§5.11），
 *   以搜索下拉承载（gen RemoteSelectField 同先例）；弹层场景经
 *   extraParams 上送 deckStatus=FINALIZED 过滤（选择池登记即「导出筛选」，
 *   后端若未支持该过滤参数，由 export/submit 的 FINALIZED 守卫兜底）；
 * - 选中项标签进入本地缓存，列表被搜索替换后仍可回显（含外部预填值）。
 */
import { computed, onMounted, ref, watch } from 'vue'

import { executeAction } from '@/engine'

interface DeckOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** 绑定值：deckId（'' 为未选） */
    modelValue: string
    /** 单选回显：外部预填值（如 ?deckId= 入口）的标签 */
    initialLabel?: string
    /** 额外上送参数（如弹层 { deckStatus: FINALIZED }） */
    extraParams?: Record<string, unknown>
    placeholder?: string
    allowClear?: boolean
  }>(),
  {
    initialLabel: undefined,
    extraParams: undefined,
    placeholder: '搜索选择创作物',
    allowClear: true,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:label', label: string): void
}>()

const loading = ref(false)
const options = ref<DeckOption[]>([])
const labelCache = new Map<string, string>()

if (props.initialLabel && props.modelValue) {
  labelCache.set(props.modelValue, props.initialLabel)
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

/** 选择池响应归一（SelectOption[value,label]；records 分页形态兼容） */
function normalize(raw: unknown): DeckOption[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { records?: unknown[] } | null)?.records)
      ? ((raw as { records?: unknown[] }).records as unknown[])
      : []
  const result: DeckOption[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const value = firstString(it.value, it.deckId)
    const label = firstString(it.label, it.deckName, value)
    if (value) result.push({ value, label: label || value })
  }
  return result
}

async function load(keyword = ''): Promise<void> {
  loading.value = true
  try {
    const data = await executeAction<unknown>('deliver.deckSelect', {
      keyword,
      ...(props.extraParams ?? {}),
    })
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

// 外部预填值变化时同步缓存标签（?deckId= 入口解析出名称后）
watch(
  () => [props.modelValue, props.initialLabel] as const,
  ([v, label]) => {
    if (v && label && !labelCache.has(v)) labelCache.set(v, label)
  },
)

/** 选项 = 搜索结果 + 已选但不在结果中的缓存项（保证回显） */
const mergedOptions = computed<DeckOption[]>(() => {
  const extra: DeckOption[] = []
  const known = new Set(options.value.map((o) => o.value))
  if (props.modelValue && !known.has(props.modelValue)) {
    extra.push({ value: props.modelValue, label: labelCache.get(props.modelValue) ?? props.modelValue })
  }
  return [...extra, ...options.value]
})

function onChange(next: unknown): void {
  const v = typeof next === 'string' ? next : ''
  emit('update:modelValue', v)
  emit('update:label', v ? labelCache.get(v) ?? v : '')
}
</script>

<template>
  <a-select
    class="deliver-deck-select"
    :value="modelValue || undefined"
    :options="mergedOptions"
    :loading="loading"
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
.deliver-deck-select {
  width: 100%;
}
</style>
