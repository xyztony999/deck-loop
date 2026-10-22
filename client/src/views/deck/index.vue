<script setup lang="ts">
/**
 * 创作物列表页（/deck；PageSpec deck.md §4）。
 *
 * - DlListPage config 驱动（DeckList.config.ts）；行操作由后端行 operList
 *   驱动可见性（§4.4），确认行为：finalize 二次确认（锁定提示）、
 *   unfinalize 二次确认、delete 强确认（软删除不可自恢复）
 * - 归档区：archivedScope 开关（§4.1 switch 类型引擎查询区不支持，由本页
 *   工具条承载并写入引擎查询对象）+ 批量恢复（§4.2）
 * - 卡片视图 #card 插槽（§4.3 卡片映射列语义；归档卡片视觉弱化 §8）
 * - 空态引导「新建第一个创作物」（§8）
 */
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Modal, message } from 'ant-design-vue'

import { DlListPage, executeAction, formatDatetime, useDict } from '@/engine'
import type { ActionConfig, ColumnConfig, RowWithOperList } from '@/engine'

import { deckListConfig } from './DeckList.config'
import {
  DECK_DICT_STATUS,
  DECK_DICT_TYPE,
  DECK_STATUS,
  type DeckListRow,
  registerDeckDictColors,
} from './deck.shared'

registerDeckDictColors()

const router = useRouter()

/** 卡片视图字典标签/颜色（与引擎内部同 key，命中 dict 缓存不重复请求） */
const dict = useDict('deck', [DECK_DICT_TYPE, DECK_DICT_STATUS])

const listRef = ref<InstanceType<typeof DlListPage> | null>(null)

// ---------------------------------------------------------------
// 归档区（archivedScope switch + 批量恢复，deck.md §4.1/§4.2）
// ---------------------------------------------------------------

const archiveMode = ref(false)
const selectedRows = ref<DeckListRow[]>([])

function clearTableSelection(): void {
  if (listRef.value) listRef.value.selectedRowKeys = []
}

function onSelectionChange(
  _keys: (string | number)[],
  rows: RowWithOperList[],
): void {
  selectedRows.value = rows as DeckListRow[]
}

async function onArchiveScopeChange(): Promise<void> {
  const list = listRef.value?.list
  if (!list) return
  if (archiveMode.value) {
    list.query.archivedScope = 1
    // 归档区后端强制 deckStatus=ARCHIVED（api-deck list 校验规则），清状态筛选避免误导
    delete list.query.deckStatus
  } else {
    list.query.archivedScope = 0
  }
  selectedRows.value = []
  clearTableSelection()
  await list.search()
}

function onBatchRestore(): void {
  if (!archiveMode.value) {
    message.warning('请先打开「查看归档区」')
    return
  }
  if (selectedRows.value.length === 0) {
    message.warning('请先勾选要恢复的创作物')
    return
  }
  const count = selectedRows.value.length
  const names = selectedRows.value.map((r) => r.deckName).join('、')
  Modal.confirm({
    title: `确认恢复选中的 ${count} 个创作物？`,
    content: names,
    okText: '恢复',
    cancelText: '取消',
    maskClosable: false,
    async onOk() {
      await Promise.all(
        selectedRows.value.map((row) =>
          executeAction('deck.deckRestore', { deckId: row.deckId }),
        ),
      )
      message.success('恢复成功')
      selectedRows.value = []
      clearTableSelection()
      await listRef.value?.refresh()
    },
  })
}

// ---------------------------------------------------------------
// 呈现层派生列（当前版本 v{seq}、版本/调整）+ 空态引导（§8）
// ---------------------------------------------------------------

const showEmptyGuide = ref(false)

watch(
  () => ({
    rows: listRef.value?.list.records.value,
    total: listRef.value?.list.total.value,
  }),
  ({ rows, total }) => {
    for (const row of (rows ?? []) as DeckListRow[]) {
      row.currentVersionText =
        row.currentVersionSeq == null ? '-' : `v${row.currentVersionSeq}`
      row.versionAdjustText = `${row.versionCount ?? 0} / ${row.adjustCount ?? 0}`
    }
    showEmptyGuide.value = (total ?? 0) === 0 && !archiveMode.value
  },
  { immediate: true },
)

// ---------------------------------------------------------------
// 工具栏 / 链接 / 行操作（operList key 对齐 deck.md §4.4）
// ---------------------------------------------------------------

function onToolbarClick(btn: ActionConfig): void {
  if (btn.key === 'create') {
    void router.push('/deck/new')
  }
}

/** 名称链接列 → 详情（§4.4：deckName 链接 → /deck/:deckId） */
function onLinkClick(column: ColumnConfig, row: RowWithOperList): void {
  if (column.dataIndex === 'deckName') {
    void router.push(`/deck/${String(row.deckId)}`)
  }
}

async function onRowClick(btn: ActionConfig, row: RowWithOperList): Promise<void> {
  const deckId = String(row.deckId)
  const refresh = async () => listRef.value?.refresh()

  if (btn.key === 'edit') {
    void router.push({ path: '/deck/new', query: { deckId } })
    return
  }
  if (btn.key === 'finalize') {
    // 二次确认 + 锁定提示（§4.4）
    Modal.confirm({
      title: '确认定稿？',
      content:
        '定稿后将以当前版本锁定创作物（已定稿），生成与调整将被禁止，需解锁后才能继续迭代。',
      okText: '定稿',
      cancelText: '取消',
      maskClosable: false,
      async onOk() {
        await executeAction('deck.deckFinalize', { deckId, confirm: true })
        message.success('已定稿')
        await refresh()
      },
    })
    return
  }
  if (btn.key === 'unfinalize') {
    Modal.confirm({
      title: '确认解锁？',
      content: '解锁后创作物回到「迭代中」，可继续生成与调整。',
      okText: '解锁',
      cancelText: '取消',
      maskClosable: false,
      async onOk() {
        await executeAction('deck.deckUnfinalize', { deckId, confirm: true })
        message.success('已解锁')
        await refresh()
      },
    })
    return
  }
  if (btn.key === 'archive') {
    // §4.4 archive 无前置确认
    await executeAction('deck.deckArchive', { deckId })
    message.success('已归档')
    await refresh()
    return
  }
  if (btn.key === 'restore') {
    await executeAction('deck.deckRestore', { deckId })
    message.success('已恢复')
    await refresh()
    return
  }
  if (btn.key === 'delete') {
    // 强确认：软删除不可自恢复（§4.4）
    Modal.confirm({
      title: '确认删除？',
      content: '删除为软删除且无法自行恢复，仅归档状态可删除。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      async onOk() {
        await executeAction('deck.deckDelete', { deckId })
        message.success('已删除')
        await refresh()
      },
    })
  }
}

// ---------------------------------------------------------------
// 卡片视图辅助（#card 插槽）
// ---------------------------------------------------------------

function rowText(row: RowWithOperList, key: string): string {
  const v = row[key]
  return v == null ? '' : String(v)
}

function rowStatus(row: RowWithOperList): string {
  return rowText(row, 'deckStatus')
}

function goDetail(row: RowWithOperList): void {
  void router.push(`/deck/${rowText(row, 'deckId')}`)
}

/** 生成向导入口（generation.md §1/§6：DRAFT 态 → /deck/:deckId/generate） */
function goGenerate(row: RowWithOperList): void {
  void router.push(`/deck/${rowText(row, 'deckId')}/generate`)
}

/** 迭代工作台入口（adjustment.md §1：→ /deck/:deckId/iterate） */
function goIterate(row: RowWithOperList): void {
  void router.push(`/deck/${rowText(row, 'deckId')}/iterate`)
}
</script>

<template>
  <div class="dl-page">
    <!-- 归档区工具条（deck.md §4.1 archivedScope switch + §4.2 批量恢复） -->
    <div class="dl-page-card deck-archive-bar">
      <span class="deck-archive-label">查看归档区</span>
      <a-switch v-model:checked="archiveMode" size="small" @change="onArchiveScopeChange" />
      <a-divider type="vertical" />
      <a-button
        size="small"
        :disabled="!archiveMode || selectedRows.length === 0"
        @click="onBatchRestore"
      >
        批量恢复{{ selectedRows.length > 0 ? `（${selectedRows.length}）` : '' }}
      </a-button>
    </div>

    <DlListPage
      ref="listRef"
      :config="deckListConfig"
      @toolbar-click="onToolbarClick"
      @row-click="onRowClick"
      @link-click="onLinkClick"
      @selection-change="onSelectionChange"
    >
      <!-- 卡片视图（§4.3 映射列语义；归档视觉弱化 §8） -->
      <template #card="{ row }">
        <div
          class="deck-card"
          :class="{ 'deck-card--archived': rowStatus(row) === DECK_STATUS.ARCHIVED }"
        >
          <div class="deck-card-head">
            <a-button type="link" class="deck-card-name" @click="goDetail(row)">
              {{ rowText(row, 'deckName') }}
            </a-button>
            <a-tag :color="dict.color(DECK_DICT_STATUS, rowStatus(row))">
              {{ dict.label(DECK_DICT_STATUS, rowStatus(row)) }}
            </a-tag>
          </div>
          <p class="deck-card-topic">{{ rowText(row, 'topic') || '—' }}</p>
          <div class="deck-card-meta">
            <span>{{ dict.label(DECK_DICT_TYPE, rowText(row, 'deckType')) }}</span>
            <span>当前版本 {{ rowText(row, 'currentVersionText') || '-' }}</span>
            <span>
              版本 {{ rowText(row, 'versionCount') || '0' }} /
              调整 {{ rowText(row, 'adjustCount') || '0' }}
            </span>
          </div>
          <div class="deck-card-foot">
            <span class="deck-card-time">{{ formatDatetime(rowText(row, 'updatedTime')) }}</span>
            <a-space :size="4">
              <a-button
                v-if="rowStatus(row) === DECK_STATUS.DRAFT"
                size="small"
                type="primary"
                @click="goGenerate(row)"
              >
                开始生成
              </a-button>
              <a-button
                v-else-if="
                  rowStatus(row) === DECK_STATUS.ITERATING ||
                  rowStatus(row) === DECK_STATUS.FINALIZED
                "
                size="small"
                @click="goIterate(row)"
              >
                进入迭代
              </a-button>
            </a-space>
          </div>
        </div>
      </template>
    </DlListPage>

    <!-- 空态引导（deck.md §8） -->
    <div v-if="showEmptyGuide" class="dl-page-card deck-empty-guide">
      <a-empty description="还没有创作物">
        <a-button type="primary" @click="router.push('/deck/new')">
          新建第一个创作物
        </a-button>
      </a-empty>
    </div>
  </div>
</template>

<style scoped>
.deck-archive-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
}

.deck-archive-label {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.deck-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dl-card-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 10px;
  box-shadow: var(--dl-card-shadow);
  padding: 16px 16px;
  height: 100%;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.deck-card:hover {
  box-shadow: var(--dl-card-shadow-hover);
  transform: translateY(-1px);
}

/* 归档区视觉弱化（deck.md §8） */
.deck-card--archived {
  opacity: 0.55;
}

.deck-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.deck-card-name {
  padding: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.deck-card-topic {
  margin: 0;
  color: var(--dl-text-secondary);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 38px;
}

.deck-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.deck-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--dl-border-light);
  padding-top: 8px;
  margin-top: auto;
}

.deck-card-time {
  color: var(--dl-text-secondary);
  font-size: 12px;
}
</style>
