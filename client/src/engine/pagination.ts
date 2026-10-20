/**
 * 分页类型与 useListPage 组合式（frontend-specs §4.8 请求/响应规范的实现载体）。
 *
 * 行为约定：
 * - 分页参数固定 pageNum / pageSize（默认 1 / 20）
 * - 列表响应统一 PageResult.records（禁止 list/data/items）
 * - dateRange 查询字段命名以 Arr 结尾，发送前自动拆分为
 *   {field}Start（补 00:00:00）/ {field}End（补 23:59:59），清空不发送
 * - 行操作按钮由后端每行 operList 驱动（useListPage 不做可见性判断）
 */
import { onMounted, reactive, ref, type Ref } from 'vue'

import { executeAction } from './actionExecutor'

export interface PageQuery {
  pageNum: number
  pageSize: number
  /** 业务筛选字段（含 {field}Arr 日期范围数组，发送前自动拆分） */
  [key: string]: unknown
}

export interface PageResult<T = unknown> {
  records: T[]
  total: number
  pageNum: number
  pageSize: number
}

export const DEFAULT_PAGE_NUM = 1
export const DEFAULT_PAGE_SIZE = 20

// ---------------------------------------------------------------
// dateRange 自动拆分（§4.8）
// ---------------------------------------------------------------

/**
 * 将查询对象中 `xxxArr: [start, end]` 拆分为 `xxxStart`/`xxxEnd`
 * 并补全时间；清空的日期范围不发送。导出供表单提交复用。
 */
export function splitRangeFields(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(query)) {
    if (key.endsWith('Arr')) {
      const base = key.slice(0, -'Arr'.length)
      if (Array.isArray(value) && value.length === 2 && value[0] && value[1]) {
        result[`${base}Start`] = `${String(value[0])} 00:00:00`
        result[`${base}End`] = `${String(value[1])} 23:59:59`
      } else if (!Array.isArray(value) && value != null && value !== '') {
        // 非数组的 Arr 字段原样透传（防御）
        result[key] = value
      }
      continue
    }
    if (Array.isArray(value) && value.length === 0) {
      continue // 空数组不上送
    }
    result[key] = value
  }
  return result
}

// ---------------------------------------------------------------
// useListPage
// ---------------------------------------------------------------

export interface UseListPageOptions<Q extends Record<string, unknown>> {
  /** 列表 action key（必填；PageResult<Q 行 VO>） */
  listAction: string
  /** 额外 path 参数（URL 占位符替换） */
  pathParams?: Record<string, string | number>
  /** 初始查询字段默认值（不含分页） */
  defaultQuery?: Partial<Q>
  defaultPageSize?: number
  /** 挂载后立即加载，默认 true */
  immediate?: boolean
  /** 发送前的最终变换（默认自动做 Arr→Start/End 拆分） */
  transformQuery?: (query: Record<string, unknown>) => Record<string, unknown>
}

export interface UseListPageReturn<T, Q extends Record<string, unknown>> {
  loading: Ref<boolean>
  records: Ref<T[]>
  total: Ref<number>
  pageNum: Ref<number>
  pageSize: Ref<number>
  query: Q
  /** 按当前查询条件从第 1 页加载（查询按钮） */
  search: () => Promise<void>
  /** 重置为 defaultQuery 后从第 1 页加载（重置按钮） */
  reset: () => Promise<void>
  /** 按当前页码条件刷新（操作完成后回调） */
  refresh: () => Promise<void>
  /** 分页器 change */
  handlePageChange: (page: number, size: number) => Promise<void>
}

/**
 * 列表页数据循环组合式。查询/翻页/刷新统一走 listAction。
 *
 *   const { loading, records, total, pageNum, pageSize, query, search, reset, refresh }
 *     = useListPage<DeckListVO, DeckListQuery>({ listAction: 'deck.deckList' })
 */
export function useListPage<T, Q extends Record<string, unknown> = Record<string, unknown>>(
  options: UseListPageOptions<Q>,
): UseListPageReturn<T, Q> {
  const {
    listAction,
    pathParams,
    defaultQuery = {} as Partial<Q>,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    immediate = true,
    transformQuery,
  } = options

  const loading = ref(false)
  const records = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const pageNum = ref(DEFAULT_PAGE_NUM)
  const pageSize = ref(defaultPageSize)
  const query = reactive({ ...defaultQuery }) as Q

  async function load(): Promise<void> {
    loading.value = true
    try {
      const base = transformQuery
        ? transformQuery({ ...query })
        : splitRangeFields({ ...query })
      const payload = {
        ...base,
        pageNum: pageNum.value,
        pageSize: pageSize.value,
      }
      const page = await executeAction<PageResult<T>>(listAction, payload, {
        pathParams,
      })
      records.value = page?.records ?? []
      total.value = page?.total ?? 0
    } finally {
      loading.value = false
    }
  }

  async function search(): Promise<void> {
    pageNum.value = DEFAULT_PAGE_NUM
    await load()
  }

  async function reset(): Promise<void> {
    Object.keys(query).forEach((key) => {
      delete query[key as keyof Q & string]
    })
    Object.assign(query, defaultQuery)
    pageNum.value = DEFAULT_PAGE_NUM
    pageSize.value = defaultPageSize
    await load()
  }

  async function refresh(): Promise<void> {
    await load()
  }

  async function handlePageChange(page: number, size: number): Promise<void> {
    pageNum.value = page
    pageSize.value = size
    await load()
  }

  if (immediate) {
    onMounted(() => {
      void load()
    })
  }

  return {
    loading,
    records,
    total,
    pageNum,
    pageSize,
    query,
    search,
    reset,
    refresh,
    handlePageChange,
  }
}
