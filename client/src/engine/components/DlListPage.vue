<script setup lang="ts">
/**
 * DlListPage — 列表页引擎（ScmListPage 的 deck-loop 轻量等价）。
 *
 * 查询区（defaultRowCount 折叠）+ 工具栏 + 表格/卡片切换 + 分页，
 * config 对象驱动（DlListPageConfig）。行为约定（frontend-specs）：
 * - 行操作由后端每行 operList 驱动，rowActions 仅为过渡兜底（规则 6）
 * - 操作列 `{ dataIndex: '__action__', type: 'action' }`
 * - 字典列绑编码字段 + colorTag 渲染（§5.4）
 * - dateRange 查询字段 Arr → Start/End 自动拆分（§4.8，useListPage 内置）
 * - 列宽/对齐/fixed 由 config 按字段类型给出（§5.5）
 */
import { computed, ref, useSlots } from 'vue'
import { Modal } from 'ant-design-vue'
import {
  DownOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'

import type { ActionConfig, OperItem } from '../types'
import type {
  ColumnConfig,
  DlListPageConfig,
  QueryFieldConfig,
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
// 查询区（§5.2：3 列，超出 defaultRowCount*3 格折叠）
// ---------------------------------------------------------------

const defaultRowCount = computed(() => props.config.defaultRowCount ?? 2)
const expanded = ref(false)

/** 每字段占的格数（dateRange 默认 2 列） */
function units(f: QueryFieldConfig): number {
  return f.span ?? (f.type === 'dateRange' ? 2 : 1)
}

const collapsedLimit = computed(() => defaultRowCount.value * 3)

const visibleFieldCount = computed(() => {
  const fields = props.config.queryFields ?? []
  const totalUnits = fields.reduce((acc, f) => acc + units(f), 0)
  if (expanded.value || totalUnits <= collapsedLimit.value) {
    return fields.length
  }
  let acc = 0
  let last = 0
  for (let i = 0; i < fields.length; i++) {
    acc += units(fields[i])
    if (acc > collapsedLimit.value) break
    last = i + 1
  }
  return Math.max(last, 1)
})

const visibleFields = computed(() =>
  (props.config.queryFields ?? []).slice(0, visibleFieldCount.value),
)
const collapsible = computed(() =>
  (props.config.queryFields?.length ?? 0) > visibleFieldCount.value,
)

function dictOptions(dictKey: string | undefined) {
  if (!dictKey) return []
  return toSelectOptions(dict.options(dictKey))
}

// 动态字段绑定辅助（保持模板严格类型，不用 any）
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
function setQuery(field: string, value: unknown): void {
  list.query[field] = value
}

// ---------------------------------------------------------------
// 表格列
// ---------------------------------------------------------------

interface TableCol extends Record<string, unknown> {
  key: string
  dataIndex: string
  title: string
  width?: number | string
  align?: 'left' | 'center' | 'right'
  fixed?: 'left' | 'right'
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
      fixed: c.fixed,
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
      col.fixed = 'right'
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

const rowSelection = computed(() => {
  if (!props.config.rowSelection) return undefined
  return {
    selectedRowKeys: selectedRowKeys.value,
    onChange: (keys: (string | number)[], rows: RowWithOperList[]) => {
      selectedRowKeys.value = keys
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
  /** 当前选中行 keys（rowSelection 场景） */
  selectedRowKeys,
  /** 数据循环句柄（查询/分页状态） */
  list,
})
</script>

<template>
  <div class="dl-page">
    <!-- 查询卡片（§5.2） -->
    <div v-if="visibleFields.length > 0" class="dl-page-card">
      <div class="dl-query-grid">
        <div
          v-for="f in visibleFields"
          :key="f.field"
          class="dl-query-item"
          :style="{ gridColumn: `span ${units(f)}` }"
        >
          <span class="dl-query-label">{{ f.label }}</span>
          <a-input
            v-if="!f.type || f.type === 'input'"
            :value="strValue(f.field)"
            :placeholder="f.placeholder ?? '请输入'"
            allow-clear
            @update:value="(v: string) => setQuery(f.field, v)"
            @press-enter="list.search"
          />
          <a-select
            v-else-if="f.type === 'select'"
            :value="strValue(f.field)"
            :options="dictOptions(f.dictKey)"
            :placeholder="f.placeholder ?? '请选择'"
            allow-clear
            show-search
            option-filter-prop="label"
            @update:value="(v: unknown) => setQuery(f.field, v === undefined || v === null ? '' : String(v))"
          />
          <a-range-picker
            v-else-if="f.type === 'dateRange'"
            :value="rangeValue(f.field)"
            value-format="YYYY-MM-DD"
            :placeholder="['开始日期', '结束日期']"
            @update:value="(v: unknown) => setQuery(f.field, v)"
          />
          <a-date-picker
            v-else-if="f.type === 'date'"
            :value="strValue(f.field)"
            value-format="YYYY-MM-DD"
            :placeholder="f.placeholder ?? '请选择日期'"
            @update:value="(v: unknown) => setQuery(f.field, v === undefined || v === null ? '' : String(v))"
          />
          <a-input-number
            v-else-if="f.type === 'number'"
            :value="numValue(f.field)"
            :placeholder="f.placeholder ?? '请输入'"
            @update:value="(v: unknown) => setQuery(f.field, v === undefined ? undefined : Number(v))"
          />
        </div>
        <div class="dl-query-item dl-query-actions">
          <a-button type="primary" @click="list.search">
            <SearchOutlined />
            查询
          </a-button>
          <a-button @click="list.reset">
            <ReloadOutlined />
            重置
          </a-button>
          <a-button v-if="collapsible" type="link" @click="expanded = !expanded">
            {{ expanded ? '收起' : '展开' }}
            <DownOutlined :class="{ 'dl-expand-rotate': expanded }" />
          </a-button>
        </div>
      </div>
    </div>

    <!-- 工具栏 + 表格卡片 -->
    <div class="dl-page-card">
      <div class="dl-toolbar">
        <a-space>
          <a-button
            v-for="btn in config.toolbar ?? []"
            :key="btn.key"
            :type="btn.key === 'create' ? 'primary' : 'default'"
            :danger="btn.danger"
            @click="emit('toolbar-click', btn)"
          >
            {{ btn.label }}
          </a-button>
        </a-space>
        <a-radio-group
          v-if="viewMode === 'both' && hasCardSlot"
          v-model:value="activeView"
          button-style="solid"
          size="small"
        >
          <a-radio-button value="table">表格</a-radio-button>
          <a-radio-button value="card">卡片</a-radio-button>
        </a-radio-group>
      </div>

      <!-- 表格视图 -->
      <a-table
        v-if="activeView === 'table'"
        class="dl-table"
        :columns="tableColumns"
        :data-source="list.records.value"
        :loading="list.loading.value"
        :row-key="config.rowKey ?? 'id'"
        :row-selection="rowSelection"
        :pagination="false"
        :scroll="{ x: 'max-content' }"
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
      </a-table>

      <!-- 卡片视图（内容经 #card 插槽，F2-F4 提供） -->
      <div v-else class="dl-card-grid">
        <template v-if="list.records.value.length > 0">
          <div
            v-for="(row, i) in list.records.value"
            :key="String(row[config.rowKey ?? 'id'] ?? i)"
          >
            <slot name="card" :row="row" :index="i" />
          </div>
        </template>
        <a-empty v-else description="暂无数据" />
      </div>

      <div class="dl-pagination">
        <a-pagination
          :current="list.pageNum.value"
          :page-size="list.pageSize.value"
          :total="list.total.value"
          show-size-changer
          :show-total="(t: number) => `共 ${t} 条`"
          @change="list.handlePageChange"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.dl-query-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 16px;
  align-items: center;
}

.dl-query-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dl-query-label {
  flex: none;
  color: var(--dl-text-secondary);
  white-space: nowrap;
}

.dl-query-actions {
  justify-content: flex-end;
}

.dl-expand-rotate {
  transform: rotate(180deg);
}

.dl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  min-height: 32px;
}

.dl-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.dl-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
</style>
