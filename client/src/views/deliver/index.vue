<script setup lang="ts">
/**
 * 导出记录中心（/deliver；PageSpec delivery.md §4，C-06）。
 *
 * - DlListPage config 驱动（deliver.config.ts）；行操作由后端行 operList
 *   驱动（§4.4 download/cancel/retry），确认行为：cancel 二次确认；
 *   retry=新任务（export/submit 重发，PPTX needConfirm 语义复用）；
 * - deckId 筛选（§4.1 modalSelect，deck.select.deckList）由页面工具条承载
 *   远程搜索选择并写入引擎查询对象（引擎查询字段无该类型，deck 列表页
 *   archivedScope 同先例）；
 * - exportCode 链接列点击 → 下载（仅 SUCCEEDED，§4.3）；
 * - 下载链路（§7）：download-ticket 换限时凭证 → GET 文件流（blob 另存，
 *   文件名取 Content-Disposition）；失败自动重换 ticket 一次再提示；
 * - /deliver?deckId= 入口（deck 详情/工作台 [导出]）：预置筛选并预选
 *   新建导出弹层（§1 迭代工作台/详情入口）。
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Modal, message } from 'ant-design-vue'

import { DlListPage, executeAction, useDict } from '@/engine'
import type { ActionConfig, ColumnConfig, RowWithOperList } from '@/engine'
import type { DeckDetailVO } from '@/views/deck/deck.shared'

import DeckSelectField from './components/DeckSelectField.vue'
import ExportCreateDialog from './components/ExportCreateDialog.vue'
import { exportListConfig } from './deliver.config'
import {
  DELIVER_DICT_FORMAT,
  EXPORT_FORMAT,
  EXPORT_STATUS,
  downloadExportRow,
  formatFileSize,
  registerDeliverDictColors,
  submitExportTask,
  type ExportListRow,
} from './deliver.shared'

registerDeliverDictColors()

const route = useRoute()

function firstParam(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

const listRef = ref<InstanceType<typeof DlListPage> | null>(null)

// 字典（与引擎内部同 key，命中 deliver 域缓存不重复请求）
const dict = useDict('deliver', [DELIVER_DICT_FORMAT])

async function refresh(): Promise<void> {
  await listRef.value?.refresh()
}

// ---------------------------------------------------------------
// deckId 筛选工具条（§4.1 modalSelect → 页面承载，写入引擎查询对象）
// ---------------------------------------------------------------

const deckFilterId = ref('')
const deckFilterName = ref('')

watch(deckFilterId, (next) => {
  const list = listRef.value?.list
  if (!list) return
  if (next) {
    list.query.deckId = next
  } else {
    delete list.query.deckId
  }
  void list.search()
})

// ---------------------------------------------------------------
// 呈现层派生列（v{seq} / KB/MB / 字典 label + PPTX beta 标，§4.3/§3）
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
    }
  },
  { immediate: true },
)

// ---------------------------------------------------------------
// 新建导出弹层（§4.2；?deckId= 入口预选）
// ---------------------------------------------------------------

const dialogOpen = ref(false)
const presetDeckId = ref<string>()
const presetDeckName = ref<string>()

function onToolbarClick(btn: ActionConfig): void {
  if (btn.key === 'create') {
    // 当前筛选的创作物作为弹层预选（入口预选同路径）
    presetDeckId.value = deckFilterId.value || undefined
    presetDeckName.value = deckFilterId.value ? deckFilterName.value : undefined
    dialogOpen.value = true
  }
}

onMounted(() => {
  const entryDeckId = firstParam(route.query.deckId)
  if (!entryDeckId) return
  deckFilterId.value = entryDeckId
  presetDeckId.value = entryDeckId
  // 预选名称解析（deck.deckDetail；失败静默，选择框回显 deckId 兜底）
  void executeAction<DeckDetailVO>('deck.deckDetail', { deckId: entryDeckId })
    .then((d) => {
      const name = d?.deckName ?? ''
      if (name) {
        presetDeckName.value = name
        deckFilterName.value = name
      }
    })
    .catch(() => undefined)
  dialogOpen.value = true
})

// ---------------------------------------------------------------
// 行操作 / 链接列（§4.4 operList：download / cancel / retry；§4.3 链接）
// ---------------------------------------------------------------

async function onRowClick(btn: ActionConfig, row: RowWithOperList): Promise<void> {
  const r = row as ExportListRow
  if (btn.key === 'download') {
    if (r.exportStatus === EXPORT_STATUS.SUCCEEDED) {
      await downloadExportRow(r)
    } else {
      message.info('该导出尚未完成，暂不可下载')
    }
    return
  }
  if (btn.key === 'cancel') {
    Modal.confirm({
      title: '确定取消该导出任务？',
      content: '排队中或渲染中的任务取消后不可恢复，需要时可重新发起导出。',
      okText: '取消任务',
      cancelText: '返回',
      okButtonProps: { danger: true },
      maskClosable: false,
      async onOk() {
        await executeAction('deliver.exportCancel', { exportId: r.exportId })
        message.success('已取消')
        await refresh()
      },
    })
    return
  }
  if (btn.key === 'retry') {
    // FAILED 重试 = 按原 deck + 格式发起新任务（§4.4；PPTX needConfirm 复用）
    if (!r.deckId || !r.exportFormat) return
    const accepted = await submitExportTask(r.deckId, r.exportFormat)
    if (accepted) {
      message.success('已重新发起导出')
      await refresh()
    }
  }
}

/** exportCode 链接列 → 下载（SUCCEEDED，§4.3） */
function onLinkClick(column: ColumnConfig, row: RowWithOperList): void {
  if (column.dataIndex !== 'exportCode') return
  const r = row as ExportListRow
  if (r.exportStatus === EXPORT_STATUS.SUCCEEDED) {
    void downloadExportRow(r)
  } else {
    message.info('该导出尚未完成，暂不可下载')
  }
}
</script>

<template>
  <div class="dl-page deliver-page">
    <!-- deckId 筛选工具条（§4.1 modalSelect，deck 选择池远程搜索） -->
    <div class="dl-page-card deliver-filter-bar">
      <span class="deliver-filter-label">创作物</span>
      <DeckSelectField
        v-model="deckFilterId"
        class="deliver-filter-select"
        :initial-label="deckFilterName"
        placeholder="搜索选择创作物，筛选导出记录"
        @update:label="deckFilterName = $event"
      />
    </div>

    <DlListPage
      ref="listRef"
      :config="exportListConfig"
      @toolbar-click="onToolbarClick"
      @row-click="onRowClick"
      @link-click="onLinkClick"
    />

    <!-- 新建导出弹层（§4.2） -->
    <ExportCreateDialog
      v-model:open="dialogOpen"
      :preset-deck-id="presetDeckId"
      :preset-deck-name="presetDeckName"
      @success="refresh"
    />
  </div>
</template>

<style scoped>
.deliver-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
}

.deliver-filter-label {
  color: var(--dl-text-secondary);
  font-size: 13px;
  flex: none;
}

.deliver-filter-select {
  max-width: 360px;
}
</style>
