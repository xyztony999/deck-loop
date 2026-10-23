<script setup lang="ts">
/**
 * 创作物详情页（/deck/:deckId；PageSpec deck.md §6）。
 *
 * - DlDetailPage 组合「基本信息 / 迭代状态」区块；数据 deck.deckDetail
 *   （withStats=true / withLatestTask=true，api-deck.md §4.4）
 * - 操作按钮区：状态驱动（同 operList 语义，派生表见 deck.shared.ts；
 *   「无进行中任务」守卫由后端执行并经统一错误提示透出）
 * - 入口跳转：开始生成（DRAFT）/ 进入迭代工作台 → /deck/:deckId/{generate|iterate}
 *   （generation.md §1/§6、adjustment.md §1）；导出（FINALIZED）→ /deliver?deckId=
 *   （delivery.md §1：详情 [导出] 入口 → 导出记录中心，deckId 预选）；
 *   演示（FINALIZED）→ /deck/:deckId/present（delivery.md §6 详情 [演示] 入口）
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal, message } from 'ant-design-vue'

import { DlDetailPage, executeAction, useDict } from '@/engine'

import { deckDetailConfig } from './DeckDetail.config'
import {
  DECK_DICT_STATUS,
  DECK_DICT_TYPE,
  TASK_DICT_STATUS,
  type DeckDetailAction,
  type DeckDetailVO,
  deckDetailActions,
  registerDeckDictColors,
  registerTaskStatusColors,
} from './deck.shared'

registerDeckDictColors()
registerTaskStatusColors()

const route = useRoute()
const router = useRouter()

const deckId = computed(() => {
  const v = route.params.deckId
  return typeof v === 'string' && v ? v : ''
})

const detail = ref<DeckDetailVO | null>(null)
const loading = ref(false)

/** 最近任务状态 tag（gen 域 task.TaskStatus 字典；颜色经 registerTaskStatusColors） */
const taskDict = useDict('gen', [TASK_DICT_STATUS])
const latestTaskStatus = computed(() => detail.value?.latestTask?.taskStatus ?? '')

/** 实体头阵（#lead 槽）：名称大字 + 状态/类型 tag（deck 域字典） */
const deckDict = useDict('deck', [DECK_DICT_STATUS, DECK_DICT_TYPE])

/** DlDetailPage 数据：DetailVO + 呈现层扁平字段（stats/latestTask 嵌套展开） */
const display = computed<Record<string, unknown> | null>(() => {
  const d = detail.value
  if (!d) return null
  return {
    ...d,
    // TODO 请确认：DetailVO（主表全字段）不含 currentVersionSeq，
    // 「当前版本 v{seq}」（deck.md §6）暂以有无 currentVersionId 表达，
    // 待后端 DetailVO 补 currentVersionSeq 后改为 `v${seq}`
    currentVersionText: d.currentVersionId ? '已生成' : '暂无（未生成）',
    statsVersionCount: d.stats?.versionCount,
    statsAdjustCount: d.stats?.adjustCount,
  }
})

/** 操作按钮区（deck.md §6：状态驱动，同 operList 语义） */
const actions = computed<DeckDetailAction[]>(() =>
  deckDetailActions(detail.value?.deckStatus),
)

async function loadDetail(): Promise<void> {
  if (!deckId.value) {
    void router.replace('/deck')
    return
  }
  loading.value = true
  try {
    detail.value = await executeAction<DeckDetailVO>('deck.deckDetail', {
      deckId: deckId.value,
      withStats: true,
      withLatestTask: true,
    })
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)

function onClose(): void {
  void router.push('/deck')
}

async function onAction(act: DeckDetailAction): Promise<void> {
  const id = deckId.value
  switch (act.key) {
    case 'generate':
      void router.push(`/deck/${id}/generate`)
      break
    case 'iterate':
      void router.push(`/deck/${id}/iterate`)
      break
    case 'edit':
      void router.push({ path: '/deck/new', query: { deckId: id } })
      break
    case 'export':
      void router.push({ path: '/deliver', query: { deckId: id } })
      break
    case 'present':
      // 演示放映（delivery.md §6：/deck/:deckId/present，FINALIZED 守卫由后端执行）
      void router.push(`/deck/${id}/present`)
      break
    case 'finalize':
      // 二次确认 + 锁定提示（同列表 operList 行为，deck.md §4.4）
      Modal.confirm({
        title: '确认定稿？',
        content:
          '定稿后将以当前版本锁定创作物（已定稿），生成与调整将被禁止，需解锁后才能继续迭代。',
        okText: '定稿',
        cancelText: '取消',
        maskClosable: false,
        async onOk() {
          await executeAction('deck.deckFinalize', { deckId: id, confirm: true })
          message.success('已定稿')
          await loadDetail()
        },
      })
      break
    case 'unfinalize':
      Modal.confirm({
        title: '确认解锁？',
        content: '解锁后创作物回到「迭代中」，可继续生成与调整。',
        okText: '解锁',
        cancelText: '取消',
        maskClosable: false,
        async onOk() {
          await executeAction('deck.deckUnfinalize', { deckId: id, confirm: true })
          message.success('已解锁')
          await loadDetail()
        },
      })
      break
    case 'archive':
      await executeAction('deck.deckArchive', { deckId: id })
      message.success('已归档')
      await loadDetail()
      break
    case 'restore':
      await executeAction('deck.deckRestore', { deckId: id })
      message.success('已恢复')
      await loadDetail()
      break
    case 'delete':
      // 强确认：软删除不可自恢复（同列表 operList 行为）
      Modal.confirm({
        title: '确认删除？',
        content: '删除为软删除且无法自行恢复，仅归档状态可删除。',
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        maskClosable: false,
        async onOk() {
          await executeAction('deck.deckDelete', { deckId: id })
          message.success('已删除')
          void router.push('/deck')
        },
      })
      break
  }
}
</script>

<template>
  <!-- 07 v2.0：引擎即页面根；操作按钮坐页头行（deck.md §6 状态驱动，同 operList 语义） -->
  <DlDetailPage
    :config="deckDetailConfig"
    :data="display"
    domain="deck"
    :loading="loading"
    @close="onClose"
  >
    <template #header-actions>
      <a-button
        v-for="act in actions"
        :key="act.key"
        :type="act.primary ? 'primary' : 'default'"
        :danger="act.danger"
        @click="onAction(act)"
      >
        {{ act.label }}
      </a-button>
    </template>

    <!-- 实体头阵：名称 + 状态/类型 tag（07 v2.0 §3.4；替代属性网格首行重复） -->
    <template #lead>
      <div class="deck-lead">
        <h2 class="deck-lead-name">{{ display?.deckName ?? '—' }}</h2>
        <a-tag
          v-if="display?.deckStatus"
          :color="deckDict.color(DECK_DICT_STATUS, String(display.deckStatus))"
        >
          {{ deckDict.label(DECK_DICT_STATUS, String(display.deckStatus)) }}
        </a-tag>
        <a-tag
          v-if="display?.deckType"
          :color="deckDict.color(DECK_DICT_TYPE, String(display.deckType))"
        >
          {{ deckDict.label(DECK_DICT_TYPE, String(display.deckType)) }}
        </a-tag>
      </div>
    </template>

    <!-- 最近任务状态 tag（deck.md §6；task.TaskStatus 属 gen 域字典） -->
    <template #field-latestTaskText>
      <a-tag
        v-if="latestTaskStatus"
        :color="taskDict.color(TASK_DICT_STATUS, latestTaskStatus)"
      >
        {{ taskDict.label(TASK_DICT_STATUS, latestTaskStatus) }}
      </a-tag>
      <span v-else class="dl-empty-value">暂无</span>
    </template>
  </DlDetailPage>
</template>

<style scoped>
/* 实体头阵（07 v2.0 §3.4）：名称大字 + 关键 tag 同行 */
.deck-lead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.deck-lead-name {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--dl-title-color);
  overflow-wrap: anywhere;
}
</style>
