<script setup lang="ts">
/**
 * 导出记录中心（/deliver；PageSpec delivery.md §4，C-06）。
 *
 * ADR-018：网站仅下载已导出产物——无 submit/cancel/retry 入口（新导出由 MCP
 * export_deck 触发，本地 headless 渲染→upload 回传）。行 operList 网站仅消费
 * download（cancel/retry 过滤隐藏）；deckName 链接 → 详情工作台。
 *
 * - deckId 筛选（§4.1 modalSelect，deck.select.deckList）由页头远程搜索选择承载；
 * - 下载链路：download-ticket 换限时凭证 → GET 文件流（blob 另存）；失败重换一次；
 * - /deliver?deckId= 入口（详情工作台「导出记录」）：预置筛选。
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'

import { DlListPage, executeAction, useDict } from '@/engine'
import type { ActionConfig, ColumnConfig, RowWithOperList } from '@/engine'
import type { DeckDetailVO } from '@/views/deck/deck.shared'

import DeckSelectField from './components/DeckSelectField.vue'
import { exportListConfig } from './deliver.config'
import {
  DELIVER_DICT_FORMAT,
  EXPORT_FORMAT,
  EXPORT_STATUS,
  downloadExportRow,
  formatFileSize,
  registerDeliverDictColors,
  type ExportListRow,
} from './deliver.shared'

registerDeliverDictColors()

const route = useRoute()
const router = useRouter()

function firstParam(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

const listRef = ref<InstanceType<typeof DlListPage> | null>(null)
const dict = useDict('deliver', [DELIVER_DICT_FORMAT])

// ---------------------------------------------------------------
// deckId 筛选（页头远程搜索选择，写入引擎查询对象）
// ---------------------------------------------------------------

const deckFilterId = ref('')
const deckFilterName = ref('')

watch(deckFilterId, (next) => {
  const list = listRef.value?.list
  if (!list) return
  if (next) list.query.deckId = next
  else delete list.query.deckId
  void list.search()
})

// ---------------------------------------------------------------
// 呈现层派生列 + operList 网站裁剪（仅 download；QUEUED 提示等待 agent 回传）
// ---------------------------------------------------------------

watch(
  () => ({
    rows: listRef.value?.list.records.value,
    ready: dict.ready.value,
  }),
  ({ rows }) => {
    for (const row of (rows ?? []) as ExportListRow[]) {
      row.versionSeqText = row.versionSeq == null ? '-' : `v${row.versionSeq}`
      row.fileSizeText = formatFileSize(row.fileSize)
      const label = dict.label(DELIVER_DICT_FORMAT, row.exportFormat)
      row.exportFormatName =
        row.exportFormat === EXPORT_FORMAT.PPTX ? `${label}（beta）` : label
      // 网站隐藏 cancel/retry（§4.4），仅保留 download
      if (Array.isArray(row.operList)) {
        row.operList = row.operList.filter((it) => it.code === 'download')
      }
    }
  },
  { immediate: true },
)

onMounted(() => {
  const entryDeckId = firstParam(route.query.deckId)
  if (!entryDeckId) return
  deckFilterId.value = entryDeckId
  void executeAction<DeckDetailVO>('deck.deckDetail', { deckId: entryDeckId })
    .then((d) => {
      if (d?.deckName) deckFilterName.value = d.deckName
    })
    .catch(() => undefined)
})

// ---------------------------------------------------------------
// 行操作 / 链接列
// ---------------------------------------------------------------

async function onRowClick(btn: ActionConfig, row: RowWithOperList): Promise<void> {
  const r = row as ExportListRow
  if (btn.key === 'download') {
    if (r.exportStatus === EXPORT_STATUS.SUCCEEDED) {
      await downloadExportRow(r)
    } else {
      message.info('该导出尚未完成，暂不可下载')
    }
  }
}

/** deckName 链接列 → 详情工作台（§4.3） */
function onLinkClick(column: ColumnConfig, row: RowWithOperList): void {
  if (column.dataIndex === 'deckName') {
    const r = row as ExportListRow
    if (r.deckId) void router.push(`/deck/${r.deckId}`)
  }
}
</script>

<template>
  <!-- 07 v2.0：引擎即页面根；deckId 筛选坐页头 #header-extra -->
  <DlListPage
    ref="listRef"
    :config="exportListConfig"
    @row-click="onRowClick"
    @link-click="onLinkClick"
  >
    <template #header-extra>
      <span class="deliver-filter-label">创作物</span>
      <DeckSelectField
        v-model="deckFilterId"
        class="deliver-filter-select"
        :initial-label="deckFilterName"
        placeholder="搜索选择创作物"
        @update:label="deckFilterName = $event"
      />
      <span class="deliver-hint">新导出请在 coding agent 中经 deck-loop MCP 发起（export_deck），完成后此处可下载。</span>
    </template>

    <!-- 空态引导指向 MCP 工作流（§6） -->
    <template #empty>
      <a-empty description="暂无导出记录">
        <span class="deliver-empty-tip">在 coding agent 中经 deck-loop MCP 发起导出（export_deck），完成后此处可下载。</span>
      </a-empty>
    </template>
  </DlListPage>
</template>

<style scoped>
.deliver-filter-label {
  color: var(--dl-text-secondary);
  font-size: 13px;
  flex: none;
  white-space: nowrap;
}

.deliver-filter-select {
  width: 240px;
}

.deliver-hint {
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.deliver-empty-tip {
  color: var(--dl-text-secondary);
  font-size: 12px;
}
</style>