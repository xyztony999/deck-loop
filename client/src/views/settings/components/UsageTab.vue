<script setup lang="ts">
/**
 * Tab2 用量统计（PageSpec settings.md §5 config 列表，只读台账无导出）。
 *
 * - 查询区：dimension 单选（CHANNEL/DECK/TASK_TYPE 契约枚举）+ timeRange
 *   必填且跨度 ≤12 个月（api-channel.md §4.4 AO 原文为 timeRange，不走
 *   引擎 Arr→Start/End 拆分；响应为 rows 亦非标准 records，故数据循环在
 *   组件内实现，表格列经 settings.config 驱动）；
 * - DECK 维度分页（pageNum/pageSize 上送，其余维度服务端整页返回）；
 * - 呈现：a-table + 纯 CSS 静态条形（任务数占比），不引图表库。
 */
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import dayjs, { type Dayjs } from 'dayjs'

import { executeAction, formatDatetime } from '@/engine'
import { usageTableColumns } from '../settings.config'
import {
  USAGE_DIMENSION,
  USAGE_DIMENSION_OPTIONS,
  USAGE_RANGE_DEFAULT_MONTHS,
  USAGE_RANGE_MAX_MONTHS,
  type UsageDimension,
  type UsageSummaryRow,
  type UsageSummaryVO,
} from '../types'

// ---------------------------------------------------------------
// 查询状态
// ---------------------------------------------------------------

const dimension = ref<UsageDimension>(USAGE_DIMENSION.CHANNEL)
/** timeRange（AO 原文字段名）：['YYYY-MM-DD', 'YYYY-MM-DD'] */
const timeRange = ref<[string, string]>(defaultRange())

function defaultRange(): [string, string] {
  const end = dayjs()
  const start = end.subtract(USAGE_RANGE_DEFAULT_MONTHS, 'month')
  return [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')]
}

function onRangeChange(v: unknown): void {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') {
    timeRange.value = [v[0], v[1]]
  } else {
    timeRange.value = ['', '']
  }
}

const rangeInvalid = computed(() => {
  const [start, end] = timeRange.value
  if (!start || !end) return true
  return dayjs(end).diff(dayjs(start), 'month', true) > USAGE_RANGE_MAX_MONTHS
})

const rangeValue = computed<[string, string] | undefined>(() =>
  timeRange.value[0] && timeRange.value[1] ? timeRange.value : undefined,
)

/** 禁选跨度外日期（辅助约束；最终以查询时校验为准） */
function disabledDate(d: Dayjs): boolean {
  return d.isAfter(dayjs(), 'day')
}

// ---------------------------------------------------------------
// 数据加载（rows/total 契约；DECK 维度分页）
// ---------------------------------------------------------------

const loading = ref(false)
const records = ref<UsageSummaryRow[]>([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(20)

/** DECK 维度分页（PageSpec §5），其余维度隐藏分页器 */
const paginated = computed(() => dimension.value === USAGE_DIMENSION.DECK)

async function load(): Promise<void> {
  const [start, end] = timeRange.value
  if (!start || !end) {
    message.warning('请选择统计时间范围')
    return
  }
  if (rangeInvalid.value) {
    message.warning(`时间范围不能超过 ${USAGE_RANGE_MAX_MONTHS} 个月`)
    return
  }
  loading.value = true
  try {
    const vo = await executeAction<UsageSummaryVO>('channel.usageSummary', {
      dimension: dimension.value,
      // 契约 AO 为拆分字段（后端 DTO timeRangeStart/End，yyyy-MM-dd）
      timeRangeStart: start,
      timeRangeEnd: end,
      pageNum: pageNum.value,
      pageSize: pageSize.value,
    })
    records.value = vo?.rows ?? []
    total.value = vo?.total ?? records.value.length
  } finally {
    loading.value = false
  }
}

async function search(): Promise<void> {
  pageNum.value = 1
  await load()
}

function onDimensionChange(): void {
  // 维度切换重置分页并按当前时间范围立即查询
  void search()
}

async function onPageChange(page: number, size: number): Promise<void> {
  pageNum.value = page
  pageSize.value = size
  await load()
}

onMounted(() => {
  void load()
})

// ---------------------------------------------------------------
// 呈现：数字千分位 + 静态条形（任务数占比）
// ---------------------------------------------------------------

function fmtNum(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '-'
}

function fmtDate(v: unknown): string {
  return typeof v === 'string' && v ? formatDatetime(v) : '-'
}

const maxTaskCount = computed(() =>
  records.value.reduce((max, r) => Math.max(max, r.taskCount ?? 0), 0),
)

function barPercent(row: UsageSummaryRow): number {
  if (maxTaskCount.value <= 0) return 0
  return Math.round(((row.taskCount ?? 0) / maxTaskCount.value) * 100)
}
</script>

<template>
  <!-- 查询区（§5：dimension 单选 + timeRange 必填） -->
  <div class="dl-tab-section">
    <div class="dl-section-title">用量统计</div>
    <div class="usage-query">
      <div class="usage-query-item">
        <span class="usage-query-label">统计维度</span>
        <a-radio-group
          :value="dimension"
          :options="USAGE_DIMENSION_OPTIONS"
          option-type="button"
          button-style="solid"
          @update:value="(v: unknown) => { dimension = v as UsageDimension; onDimensionChange() }"
        />
      </div>
      <div class="usage-query-item">
        <span class="usage-query-label">时间范围</span>
        <a-range-picker
          :value="rangeValue"
          value-format="YYYY-MM-DD"
          :placeholder="['开始日期', '结束日期']"
          :allow-clear="false"
          :disabled-date="disabledDate"
          @update:value="onRangeChange"
        />
        <span class="usage-range-hint">
          必填，最长 {{ USAGE_RANGE_MAX_MONTHS }} 个月
          <template v-if="rangeInvalid">（当前范围超限）</template>
        </span>
      </div>
      <div class="usage-query-actions">
        <a-button type="primary" :loading="loading" @click="search">查询</a-button>
      </div>
    </div>
  </div>

  <!-- 结果台账（只读，无导出按钮） -->
  <div class="dl-tab-section">
    <a-table
      class="dl-table"
      :columns="usageTableColumns"
      :data-source="records"
      :loading="loading"
      :pagination="false"
      row-key="dimKey"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'taskCount'">{{ fmtNum((record as UsageSummaryRow).taskCount) }}</template>
        <template v-else-if="column.key === 'promptTokens'">{{ fmtNum((record as UsageSummaryRow).promptTokens) }}</template>
        <template v-else-if="column.key === 'completionTokens'">{{ fmtNum((record as UsageSummaryRow).completionTokens) }}</template>
        <template v-else-if="column.key === 'lastUsedAt'">{{ fmtDate((record as UsageSummaryRow).lastUsedAt) }}</template>
        <template v-else-if="column.key === '__share__'">
          <div class="usage-bar-track" :title="`占比 ${barPercent(record as UsageSummaryRow)}%（相对本页最大任务数）`">
            <div class="usage-bar" :style="{ width: `${barPercent(record as UsageSummaryRow)}%` }" />
          </div>
        </template>
      </template>
    </a-table>

    <div v-if="paginated" class="usage-pagination">
      <a-pagination
        :current="pageNum"
        :page-size="pageSize"
        :total="total"
        show-size-changer
        :show-total="(t: number) => `共 ${t} 条`"
        @change="onPageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.usage-query {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 32px;
}

.usage-query-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.usage-query-label {
  color: var(--dl-text-secondary);
  white-space: nowrap;
}

.usage-range-hint {
  color: var(--dl-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.usage-query-actions {
  margin-left: auto;
}

.usage-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}

.usage-bar-track {
  width: 100%;
  max-width: 180px;
  height: 8px;
  background: var(--dl-bg-page);
  border-radius: 4px;
  overflow: hidden;
}

.usage-bar {
  height: 100%;
  background: var(--dl-title-bar);
  border-radius: 4px;
  transition: width 0.2s;
}
</style>
