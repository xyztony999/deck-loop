/**
 * 字典服务（frontend-specs §4.7 字典注册规范的 deck-loop 等价实现）。
 *
 * - 接口：POST /{domain}/dict/batch，body { keys: string[] }，
 *   响应 Result<{ [dictKey]: SelectOption[] }>（后端 {Domain}DictController）。
 * - 内存缓存：同域同 key 只拉一次；进行中的请求合并（同 URL 多 key 由
 *   dictBatch 批量语义天然合并）。
 * - 颜色：后端 SelectOption 无 color 字段；colorTag 渲染所需的颜色经
 *   registerDictColorMap 注册（呈现层映射，非业务枚举硬编码——选项
 *   label/value 仍全部来自后端字典）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { executeAction } from './actionExecutor'
import type { DictItem, DictMap, SelectOption } from './types'

// ---------------------------------------------------------------
// 颜色映射注册（呈现层）
// ---------------------------------------------------------------

/**
 * 颜色映射结构：{ [domain]: { [dictKey]: { [value]: antdTagColor } } }
 * 由 F2-F4 按模块注册（如 deck 域 deckStatus 的 DRAFT→default）。
 */
type DomainColorMap = Record<string, Record<string, Record<string, string>>>

const colorMap: DomainColorMap = {}

/** 注册某域的字典 Tag 颜色映射（模块 setup 时调用一次） */
export function registerDictColorMap(
  domain: string,
  map: Record<string, Record<string, string>>,
): void {
  colorMap[domain] = { ...(colorMap[domain] ?? {}), ...map }
}

export function getDictColor(
  domain: string,
  dictKey: string,
  value: string,
): string | undefined {
  return colorMap[domain]?.[dictKey]?.[value]
}

// ---------------------------------------------------------------
// 批量拉取 + 内存缓存
// ---------------------------------------------------------------

/** 域级缓存：{ [domain]: { [dictKey]: DictItem[] } } */
const cache = new Map<string, DictMap>()
/** 进行中请求合并 */
const pending = new Map<string, Promise<DictMap>>()

/**
 * 调 POST /{domain}/dict/batch 拉取字典（action key `{domain}.dictBatch`，
 * 由 src/api/actions 注册；未注册时抛错并在控制台提示）。
 * 同域 key 自动合并为一次批量请求；命中缓存直接返回。
 */
export async function dictBatch(
  domain: string,
  keys: string[],
): Promise<DictMap> {
  for (;;) {
    const cached = cache.get(domain)
    const missing = keys.filter((k) => !cached?.[k])
    if (missing.length === 0) {
      return mergeIntoCache(domain, keys)
    }

    // 已有同域请求在途：等它落地后重算缺失（可能未覆盖本次的 key）
    const inflight = pending.get(domain)
    if (inflight) {
      await inflight.catch(() => undefined)
      continue
    }

    const request = executeAction<Record<string, SelectOption[]>>(
      `${domain}.dictBatch`,
      { keys: missing },
    ).then((data) => {
      const normalized: DictMap = {}
      for (const [dictKey, items] of Object.entries(data ?? {})) {
        normalized[dictKey] = (items ?? []).map((it) => ({ ...it }))
      }
      const prev = cache.get(domain) ?? {}
      cache.set(domain, { ...prev, ...normalized })
      return cache.get(domain) as DictMap
    })

    pending.set(domain, request)
    try {
      await request
    } finally {
      pending.delete(domain)
    }
  }
}

function mergeIntoCache(domain: string, keys: string[]): DictMap {
  const all = cache.get(domain) ?? {}
  const result: DictMap = {}
  for (const key of keys) {
    if (all[key]) result[key] = all[key]
  }
  return result
}

/** 清空缓存（登出 / 测试用） */
export function clearDictCache(): void {
  cache.clear()
  pending.clear()
}

// ---------------------------------------------------------------
// useDict hook
// ---------------------------------------------------------------

export interface UseDictReturn {
  /** 是否加载完成 */
  ready: Ref<boolean>
  /** 全量字典（响应式） */
  dicts: Ref<DictMap>
  /** 某个 dictKey 的选项列表（供 select options 使用） */
  options: (dictKey: string) => DictItem[]
  /** code → label 反查（详情/列表展示；Name 字段缺失时兜底） */
  label: (dictKey: string, value: string | null | undefined) => string
  /** code → tag 颜色（colorTag 渲染） */
  color: (dictKey: string, value: string | null | undefined) => string | undefined
  /** 当前涉及的全部 dictKey */
  keys: string[]
}

/**
 * 字典 hook：按域批量拉取并缓存。
 *
 *   const dict = useDict('deck', ['deckType', 'deckStatus'])
 *   dict.options('deckStatus')   // [{ value, label, color? }]
 *   dict.label('deckStatus', row.deckStatus)
 *   dict.color('deckStatus', row.deckStatus)
 *
 * @param domain 接口域（deck/gen/adjust/ver/deliver/asset/channel/auth）
 * @param keys   字典 key 列表（与后端 {Domain}DictBatchAO.keys 一致）
 */
export function useDict(domain: string, keys: string[]): UseDictReturn {
  const ready = ref(false)
  const dicts = ref<DictMap>({})

  if (domain && keys.length > 0) {
    void dictBatch(domain, keys)
      .then((map) => {
        dicts.value = map
      })
      .finally(() => {
        ready.value = true
      })
  } else {
    ready.value = true
  }

  const options = (dictKey: string): DictItem[] => dicts.value[dictKey] ?? []
  const label = (
    dictKey: string,
    value: string | null | undefined,
  ): string => {
    if (value == null || value === '') return ''
    const hit = options(dictKey).find((it) => it.value === value)
    return hit?.label ?? value
  }
  const color = (
    dictKey: string,
    value: string | null | undefined,
  ): string | undefined => {
    if (value == null || value === '') return undefined
    return getDictColor(domain, dictKey, value)
  }

  return { ready, dicts, options, label, color, keys }
}

/** 非 hook 场景的选项转换（ComputedRef 场景下使用） */
export function toSelectOptions(
  items: DictItem[] | undefined,
): { value: string; label: string }[] {
  return (items ?? []).map(({ value, label }) => ({ value, label }))
}

/** 便于模板绑定的 options computed 工厂 */
export function computedOptions(
  dict: UseDictReturn,
  dictKey: string,
): ComputedRef<{ value: string; label: string }[]> {
  return computed(() => toSelectOptions(dict.options(dictKey)))
}
