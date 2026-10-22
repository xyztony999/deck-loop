<script setup lang="ts">
/**
 * DlListPage v2 — 列表页引擎（07-ui-design-language.md §3.2 单表面形态）。
 *
 * 页头行（标题 + #header-extra + 内联筛选即查 + 操作）→ 选择条 → 平铺表格 → 页脚行。
 * config 对象驱动（DlListPageConfig，协议与 v1 兼容）。行为约定：
 * - 筛选变更即查（07 §8）：select/date/dateRange 变更或清空即查；input 回车或清空即查；
 *   废除查询/重置按钮组；存在激活筛选时页头出现「重置」（仅清引擎自有筛选字段，
 *   不动页面写入的额外键如 archivedScope）
 * - 表格不设 scroll.x（07 §7：禁 max-content 横滚），fixed 仅作配置兼容忽略
 * - 行操作由后端每行 operList 驱动，rowActions 仅为过渡兜底（规则 6）
 * - 卡片视图 = 描边 tile（07 §3.5）；批量操作经 #selection-actions 槽
 */
import { computed, ref, useSlots } from 'vue'
import { Modal } from 'ant-design-vue'
import { DownOutlined, ReloadOutlined } from '@ant-design/icons-vue'

import type { ActionConfig, OperItem } from '../types'
import type {
  ColumnConfig,
  DlListPageConfig,
  RowWithOperList,
} from '../pageSchemas'
import { useDict, toSelectOptions } from '../dict'
import { useListPage } from '../pagination'
import { formatAmount, formatDatetime, formatUnitPrice } from '../format'

const props = defineProps<{
  config: DlListPageConfig
}>()

const emit = defineEmits<{
  /** 工具栏按钮点击 */
  (e: 'toolbar-click', btn: ActionConfig): void
  /** 行操作按钮点击（btn.key 对齐后端 operList[].code） */
  (e: 'row-click', btn: ActionConfig, row: RowWithOperList): void
  /** 业务单据链接列点击（type: 'link'） */
  (e: 'link-click', column: ColumnConfig, row: RowWithOperList): void
  /** 勾选变更 */
  (e: 'selection-change', keys: (string | number)[], rows: RowWithOperList[]): void
}>()

const slots = useSlots()

// ---------------------------------------------------------------
// 字典（查询下拉 + 字典列共用，同域合并一次批量请求）
// ---------------------------------------------------------------

const dictKeys = computed(() => {
  const keys = new Set<string>()
  props.config.queryFields?.forEach((f) => {
    if (f.type === 'select' && f.dictKey) keys.add(f.dictKey)
  })
  props.config.columns.forEach((c) => {
    if (c.type === 'dict' && c.dictKey) keys.add(c.dictKey)
  })
  return [...keys]
})

const dict = useDict(props.config.domain, dictKeys.value)

// ---------------------------------------------------------------
// 数据循环
// ---------------------------------------------------------------

const list = useListPage<RowWithOperList>({
  listAction: props.config.listAction,
  defaultPageSize: props.config.defaultPageSize,
})

// ---------------------------------------------------------------
// 内联筛选（07 §8：变更即查；重置仅清引擎自有字段）
// ---------------------------------------------------------------

const queryFields = computed(() => props.config.queryFields ?? [])

const dictOptions = (dictKey: string | undefined) => {
  if (!dictKey) return []
  return toSelectOptions(dict.options(dictKey))
}

function strValue(field: string): string | undefined {
  const v = list.query[field]
  return typeof v === 'string' ? v : undefined
}
function numValue(field: string): number | undefined {
  const v = list.query[field]
  return typeof v === 'number' ? v : undefined
}
function rangeValue(field: string): [string, string] | undefined {
  const v = list.query[field]
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') {
    return [v[0], v[1]]
  }
  return undefined
}

/** 写入筛选并立即查询（select/date/dateRange 用：变更与清空都查） */
function setAndSearch(field: string, value: unknown): void {
  list.query[field] = value
  void list.search()
}

/** input：回车或清空才查（逐键不查） */
function onInput(field: string, v: string): void {
  list.query[field] = v
  if (v === '') void list.search()
}

const hasActiveFilter = computed(() =>
  queryFields.value.some((f) => {
    const v = list.query[f.field]
    if (Array.isArray(v)) return v.length > 0
    return v != null && v !== ''
  }),
)

/** 仅清引擎自有筛选字段（保留页面写入的额外键，如 archivedScope） */
async function resetFilters(): Promise<void> {
  queryFields.value.forEach((f) => {
    delete list.query[f.field]
  })
  await list.search()
}

// ---------------------------------------------------------------
// 工具栏（create → 页头 primary；其余 → 页头 default）
// ---------------------------------------------------------------

const primaryButtons = computed(() =>
  (props.config.toolbar ?? []).filter((b) => b.key === 'create'),
)
const secondaryButtons = computed(() =>
  (props.config.toolbar ?? []).filter((b) => b.key !== 'create'),
)

// ---------------------------------------------------------------
// 表格列（07 §7：不设 scroll.x，fixed 忽略）
// ---------------------------------------------------------------

interface TableCol extends Record<string, unknown> {
  key: string
  dataIndex: string
  title: string
  width?: number | string
  align?: 'left' | 'center' | 'right'
  ellipsis?: boolean
  __dl?: ColumnConfig
}

const tableColumns = computed<TableCol[]>(() =>
  props.config.columns.map((c) => {
    const col: TableCol = {
      key: c.dataIndex,
      dataIndex: c.dataIndex,
      title: c.title,
      width: c.width,
      align: c.align,
      ellipsis:
        c.ellipsis === undefined
          ? undefined
          : typeof c.ellipsis === 'boolean'
            ? c.ellipsis
            : true,
      __dl: c,
    }
    if (c.type === 'seq') {
      col.width = c.width ?? 60
      col.align = c.align ?? 'center'
    }
    if (c.type === 'action') {
      col.key = '__action__'
      col.align = 'center'
      col.width = c.width ?? ((props.config.rowActions?.length ?? 0) > 3 ? 180 : 160)
    }
    return col
  }),
)

const columnMeta = new Map<string, ColumnConfig>()
props.config.columns.forEach((c) => columnMeta.set(c.dataIndex, c))

function metaOf(colKey: string): ColumnConfig | undefined {
  return columnMeta.get(colKey)
}

function cellText(c: ColumnConfig, record: RowWithOperList): string {
  const raw = record[c.dataIndex]
  switch (c.type) {
    case 'dict': {
      // 展示优先取 {编码字段}Name 冗余，缺失回退字典反查（§5.4）
      const nameField = `${c.dataIndex}Name`
      if (typeof record[nameField] === 'string' && record[nameField]) {
        return record[nameField] as string
      }
      return dict.label(c.dictKey ?? '', String(raw ?? ''))
    }
    case 'amount':
      return formatAmount(raw as number | string | null)
    case 'unitPrice':
      return formatUnitPrice(raw as number | string | null)
    case 'datetime':
      return formatDatetime(raw as string | null)
    default:
      return raw == null ? '' : String(raw)
  }
}

function cellTagColor(c: ColumnConfig, record: RowWithOperList): string | undefined {
  return dict.color(c.dictKey ?? '', String(record[c.dataIndex] ?? ''))
}

// ---------------------------------------------------------------
// 行操作（operList 驱动，规则 6）
// ---------------------------------------------------------------

function opersOf(row: RowWithOperList): ActionConfig[] {
  const operList = (row.operList ?? []) as OperItem[]
  if (operList.length > 0) {
    return operList.map((it) => ({
      key: it.code,
      label: it.label,
      danger: it.style === 'danger',
    }))
  }
  return props.config.rowActions ?? []
}

function splitOpers(row: RowWithOperList): {
  inline: ActionConfig[]
  more: ActionConfig[]
} {
  const opers = opersOf(row)
  return { inline: opers.slice(0, 2), more: opers.slice(2) }
}

function onOper(btn: ActionConfig, row: RowWithOperList): void {
  if (btn.confirm) {
    Modal.confirm({
      title: btn.confirm,
      okText: '确定',
      cancelText: '取消',
      maskClosable: false,
      onOk: () => emit('row-click', btn, row),
    })
    return
  }
  emit('row-click', btn, row)
}

function onLink(column: ColumnConfig, row: RowWithOperList): void {
  emit('link-click', column, row)
}

// ---------------------------------------------------------------
// 行选择 / 视图切换
// ---------------------------------------------------------------

const selectedRowKeys = ref<(string | number)[]>([])
const selectedRows = ref<RowWithOperList[]>([])

function clearSelection(): void {
  selectedRowKeys.value = []
  selectedRows.value = []
}

const rowSelection = computed(() => {
  if (!props.config.rowSelection) return undefined
  return {
    selectedRowKeys: selectedRowKeys.value,
    onChange: (keys: (string | number)[], rows: RowWithOperList[]) => {
      selectedRowKeys.value = keys
      selectedRows.value = rows
      emit('selection-change', keys, rows)
    },
  }
})

const viewMode = computed(() => props.config.viewMode ?? 'table')
const activeView = ref<'table' | 'card'>(
  viewMode.value === 'card' ? 'card' : 'table',
)
const hasCardSlot = computed(() => slots.card != null)

defineExpose({
  refresh: list.refresh,
  search: list.search,
  reset: list.reset,
  /** 清除表格勾选（选择条「清除」与页面批量操作后调用） */
  clearSelection,
  /** 当前选中行 keys（rowSelection 场景） */
  selectedRowKeys,
  /** 数据循环句柄（查询/分页状态） */
  list,
})
</script>

<template>
  <div class="dl-page">
    <!-- 页头行：标题 + 页面级控件 + 内联筛选 + 操作（07 §3.2） -->
    <div class="dl-page-header">
      <h1 v-if="config.title" class="dl-page-title">{{ config.title }}</h1>
      <slot name="header-extra" :list="list" />

      <div class="dl-page-header-right">
        <template v-if="queryFields.length > 0">
          <template v-for="f in queryFields" :key="f.field">
            <a-select
              v-if="f.type === 'select'"
              class="dl-filter dl-filter--select"
              size="small"
              :value="strValue(f.field) || undefined"
              :options="dictOptions(f.dictKey)"
              :placeholder="f.label"
              allow-clear
              @update:value="(v: unknown) => setAndSearch(f.field, v === undefined || v === null ? '' : String(v))"
            />
            <a-input
              v-else-if="!f.type || f.type === 'input'"
              class="dl-filter dl-filter--input"
              size="small"
              :value="strValue(f.field)"
              :placeholder="f.placeholder ?? f.label"
              allow-clear
              @update:value="(v: string) => onInput(f.field, v)"
              @press-enter="list.search"
            />
            <a-range-picker
              v-else-if="f.type === 'dateRange'"
              class="dl-filter dl-filter--range"
              size="small"
              :value="rangeValue(f.field)"
              value-format="YYYY-MM-DD"
              :placeholder="['开始日期', '结束日期']"
              @update:value="(v: unknown) => setAndSearch(f.field, v)"
            />
            <a-date-picker
              v-else-if="f.type === 'date'"
              class="dl-filter dl-filter--date"
              size="small"
              :value="strValue(f.field)"
              value-format="YYYY-MM-DD"
              :placeholder="f.label"
              @update:value="(v: unknown) => setAndSearch(f.field, v === undefined || v === null ? '' : String(v))"
            />
            <a-input-number
              v-else-if="f.type === 'number'"
              class="dl-filter dl-filter--number"
              size="small"
              :value="numValue(f.field)"
              :placeholder="f.label"
              @update:value="(v: unknown) => (list.query[f.field] = v === undefined ? undefined : Number(v))"
              @press-enter="list.search"
            />
          </template>
          <a-button
            v-if="hasActiveFilter"
            type="text"
            size="small"
            class="dl-filter-reset"
            @click="resetFilters"
          >
            <ReloadOutlined />
            重置
          </a-button>
        </template>

        <a-radio-group
          v-if="viewMode === 'both' && hasCardSlot"
          v-model:value="activeView"
          size="small"
          option-type="button"
          button-style="solid"
          :options="[
            { label: '表格', value: 'table' },
            { label: '卡片', value: 'card' },
          ]"
        />

        <a-space :size="8">
          <a-button
            v-for="btn in secondaryButtons"
            :key="btn.key"
            :danger="btn.danger"
            @click="emit('toolbar-click', btn)"
          >
            {{ btn.label }}
          </a-button>
          <a-button
            v-for="btn in primaryButtons"
            :key="btn.key"
            type="primary"
            @click="emit('toolbar-click', btn)"
          >
            {{ btn.label }}
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 选择条（勾选后出现；批量操作经 #selection-actions） -->
    <div
      v-if="rowSelection && selectedRowKeys.length > 0"
      class="dl-selection-bar"
    >
      <span class="dl-selection-count">已选 {{ selectedRowKeys.length }} 项</span>
      <slot
        name="selection-actions"
        :rows="selectedRows"
        :keys="selectedRowKeys"
        :clear="clearSelection"
      />
      <a-button type="text" size="small" @click="clearSelection">清除</a-button>
    </div>

    <!-- 平铺表格（07 §7：无 scroll.x、表头透明、固定列分界线禁用） -->
    <a-table
      v-if="activeView === 'table'"
      class="dl-table dl-table-flex"
      :columns="tableColumns"
      :data-source="list.records.value"
      :loading="list.loading.value"
      :row-key="config.rowKey ?? 'id'"
      :row-selection="rowSelection"
      :pagination="false"
      size="middle"
    >
      <template #bodyCell="{ column, record, index }">
        <template v-if="column.key === '__seq__'">
          {{ index + 1 }}
        </template>
        <template v-else-if="column.key === '__action__'">
          <a-space :size="4">
            <a-button
              v-for="btn in splitOpers(record).inline"
              :key="btn.key"
              type="link"
              size="small"
              :danger="btn.danger"
              @click="onOper(btn, record)"
            >
              {{ btn.label }}
            </a-button>
            <a-dropdown v-if="splitOpers(record).more.length > 0">
              <a-button type="link" size="small">
                更多
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item
                    v-for="btn in splitOpers(record).more"
                    :key="btn.key"
                    :danger="btn.danger"
                    @click="onOper(btn, record)"
                  >
                    {{ btn.label }}
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
        <template v-else-if="metaOf(String(column.key))?.type === 'link'">
          <a-button
            type="link"
            size="small"
            @click="onLink(metaOf(String(column.key))!, record)"
          >
            {{ cellText(metaOf(String(column.key))!, record) }}
          </a-button>
        </template>
        <template v-else-if="metaOf(String(column.key))?.type === 'dict'">
          <a-tag
            v-if="metaOf(String(column.key))?.colorTag"
            :color="cellTagColor(metaOf(String(column.key))!, record)"
          >
            {{ cellText(metaOf(String(column.key))!, record) }}
          </a-tag>
          <span v-else>{{ cellText(metaOf(String(column.key))!, record) }}</span>
        </template>
        <template v-else-if="metaOf(String(column.key))?.type === 'amount'">
          <span class="dl-amount">
            {{ cellText(metaOf(String(column.key))!, record) }}
          </span>
        </template>
        <template v-else-if="metaOf(String(column.key))?.type === 'unitPrice'">
          <span class="dl-unit-price">
            {{ cellText(metaOf(String(column.key))!, record) }}
          </span>
        </template>
        <template v-else>
          {{ cellText(metaOf(String(column.key)) ?? { dataIndex: String(column.key), title: '' }, record) }}
        </template>
      </template>
      <template #emptyText>
        <slot name="empty">
          <a-empty description="暂无数据" />
        </slot>
      </template>
    </a-table>

    <!-- 卡片视图：描边 tile（07 §3.5，内容经 #card 插槽） -->
    <div v-else class="dl-card-grid">
      <template v-if="list.records.value.length > 0">
        <div
          v-for="(row, i) in list.records.value"
          :key="String(row[config.rowKey ?? 'id'] ?? i)"
          class="dl-tile"
        >
          <slot name="card" :row="row" :index="i" />
        </div>
      </template>
      <a-empty v-else description="暂无数据" />
    </div>

    <!-- 页脚行：共 N 条 + 分页 -->
    <div class="dl-page-footer">
      <span class="dl-footer-total">共 {{ list.total.value }} 条</span>
      <a-pagination
        size="small"
        :current="list.pageNum.value"
        :page-size="list.pageSize.value"
        :total="list.total.value"
        show-size-changer
        @change="list.handlePageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.dl-filter--select {
  width: 140px;
}

.dl-filter--input {
  width: 220px;
}

.dl-filter--range {
  width: 260px;
}

.dl-filter--date {
  width: 140px;
}

.dl-filter--number {
  width: 120px;
}

.dl-filter-reset {
  color: var(--dl-text-secondary);
}

/* 表格坐表面：占满页头/页脚之间的剩余高度（短内容时页脚仍贴内容尾） */
.dl-table-flex {
  flex: 1 0 auto;
}

.dl-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 16px 24px;
}

.dl-card-grid > :deep(.ant-empty) {
  grid-column: 1 / -1;
  padding: 24px 0;
}
</style>
