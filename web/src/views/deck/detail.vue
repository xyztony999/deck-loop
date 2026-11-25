<script setup lang="ts">
/**
 * 创作物详情工作台（/deck/:deckId；PageSpec deck.md §6，hybrid）。
 *
 * 布局：页头行（名称 + 状态 tag + 操作）→ 分隔线 → 左版本树面板 + 右预览画布；
 * 下方小节流（基本信息 / 迭代状态 / 大纲（仅 DRAFT）/ 交 agent 调整引导）。
 *
 * ADR-018：网站无内容写入口（无指令面板/内容编辑）；版本操作仅指针类（回退/分叉，
 * 树面板承载）+ 大纲保存（DRAFT 中间产物）。内容产出在 agent 侧（MCP agent-create）。
 * 单表面原则：分区用分隔线 + 小节标题，禁卡中卡（07 §3/§9）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal, message } from 'ant-design-vue'
import { CopyOutlined } from '@ant-design/icons-vue'

import { executeAction, formatDatetime, useDict } from '@/engine'
import { sanitizeOutline, validateOutline, type OutlineNode } from '@/services/outline'

import VersionTreePanel from './components/VersionTreePanel.vue'
import DeckPreviewCanvas from './components/DeckPreviewCanvas.vue'
import OutlineEditor from './components/OutlineEditor.vue'
import { useVersionContent } from './composables/useVersionContent'
import type { VersionCompareTarget } from './versionTypes'
import {
  DECK_DICT_STATUS,
  DECK_DICT_TYPE,
  DECK_STATUS,
  type DeckDetailAction,
  type DeckDetailVO,
  deckDetailActions,
  registerDeckDictColors,
} from './deck.shared'

registerDeckDictColors()

const route = useRoute()
const router = useRouter()

const deckId = computed(() => {
  const v = route.params.deckId
  return typeof v === 'string' && v ? v : ''
})

const deckDict = useDict('deck', [DECK_DICT_STATUS, DECK_DICT_TYPE])

// ---------------------------------------------------------------
// Deck 详情（withStats=true / withLatestTask=false，网站不展示任务）
// ---------------------------------------------------------------

const detail = ref<DeckDetailVO | null>(null)
const loading = ref(false)
const loadFailed = ref(false)

const isDraft = computed(() => detail.value?.deckStatus === DECK_STATUS.DRAFT)
const readonly = computed(
  () =>
    detail.value?.deckStatus === DECK_STATUS.FINALIZED ||
    detail.value?.deckStatus === DECK_STATUS.ARCHIVED,
)

const actions = computed<DeckDetailAction[]>(() =>
  deckDetailActions(detail.value?.deckStatus),
)

async function loadDetail(): Promise<void> {
  if (!deckId.value) {
    void router.replace('/deck')
    return
  }
  loading.value = true
  loadFailed.value = false
  try {
    detail.value = await executeAction<DeckDetailVO>('deck.deckDetail', {
      deckId: deckId.value,
      withStats: true,
      withLatestTask: false,
    })
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------
// 预览画布（树节点点击驱动；缺省 = 当前指针版本）
// ---------------------------------------------------------------

const version = useVersionContent()
const previewVersionId = ref('')

async function loadPreview(versionId: string): Promise<void> {
  if (!versionId) return
  previewVersionId.value = versionId
  await version.load(versionId)
}

function onTreePreview(versionId: string): void {
  void loadPreview(versionId)
}

async function onTreeChanged(): Promise<void> {
  await loadDetail()
  // 指针变更后预览同步到新的当前版本
  const cur = detail.value?.currentVersionId
  if (cur) await loadPreview(cur)
}

function onCompare(target: VersionCompareTarget): void {
  void router.push({
    path: `/deck/${deckId.value}/compare`,
    query: { left: target.leftVersionId, right: target.rightVersionId },
  })
}

function onExportFrom(): void {
  void router.push({ path: '/deliver', query: { deckId: deckId.value } })
}

function onPresent(versionId: string): void {
  void router.push({
    path: `/deck/${deckId.value}/present`,
    query: versionId ? { versionId } : {},
  })
}

// ---------------------------------------------------------------
// 大纲（仅 DRAFT 可编辑；首版后只读）
// ---------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** draftOutline 宽松 JSON → 强类型节点树（边界归一） */
function normalizeOutline(raw: unknown): OutlineNode[] {
  const list = Array.isArray(raw) ? raw : []
  const nodes: OutlineNode[] = []
  for (const item of list) {
    const rec = asRecord(item)
    if (!rec) continue
    const nodeId = typeof rec.nodeId === 'string' ? rec.nodeId : `node-${nodes.length + 1}`
    const title = typeof rec.title === 'string' ? rec.title : ''
    const points = Array.isArray(rec.points)
      ? rec.points.filter((p): p is string => typeof p === 'string')
      : []
    const note = typeof rec.note === 'string' ? rec.note : ''
    const pageHint = typeof rec.pageHint === 'number' ? rec.pageHint : undefined
    nodes.push({ nodeId, title, points, note, pageHint })
  }
  return nodes
}

const outlineNodes = ref<OutlineNode[]>([])
const savingOutline = ref(false)

watch(
  () => detail.value?.draftOutline,
  (raw) => {
    outlineNodes.value = normalizeOutline(raw)
  },
  { immediate: true },
)

function onOutlineChange(nodes: OutlineNode[]): void {
  outlineNodes.value = nodes
}

async function saveOutline(): Promise<void> {
  if (savingOutline.value) return
  const cleaned = sanitizeOutline(outlineNodes.value)
  const err = validateOutline(cleaned)
  if (err) {
    message.warning(err)
    return
  }
  savingOutline.value = true
  try {
    await executeAction('deck.outlineSave', {
      deckId: deckId.value,
      outline: cleaned,
    })
    message.success('大纲已保存')
    await loadDetail()
  } catch {
    // BIZ_DECK_OUTLINE_INVALID 等文案由 request 层透传
  } finally {
    savingOutline.value = false
  }
}

// ---------------------------------------------------------------
// 交 agent 调整引导（上下文复制 + 话术库链接）
// ---------------------------------------------------------------

const agentContext = computed(() => {
  const d = detail.value
  if (!d) return ''
  return [
    `deckId: ${d.deckId}`,
    `当前版本: ${previewVersionId.value || d.currentVersionId || '（无）'}`,
    `活动分支: ${d.activeBranch || 'main'}`,
  ].join('\n')
})

async function copyContext(): Promise<void> {
  try {
    await navigator.clipboard.writeText(agentContext.value)
    message.success('已复制上下文')
  } catch {
    message.error('复制失败，请手动选择复制')
  }
}

function goPromptLibrary(): void {
  void router.push({ path: '/assets', query: { tab: 'prompt' } })
}

// ---------------------------------------------------------------
// 页头操作（状态驱动）
// ---------------------------------------------------------------

async function onAction(act: DeckDetailAction): Promise<void> {
  const id = deckId.value
  switch (act.key) {
    case 'edit':
      void router.push({ path: '/deck/new', query: { deckId: id } })
      break
    case 'compare':
      void router.push(`/deck/${id}/compare`)
      break
    case 'present':
      onPresent(previewVersionId.value || detail.value?.currentVersionId || '')
      break
    case 'export':
      void router.push({ path: '/deliver', query: { deckId: id } })
      break
    case 'finalize':
      Modal.confirm({
        title: '确认定稿？',
        content: '定稿后将以当前版本锁定创作物，内容写入将被禁止，需解锁后才能继续迭代。',
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
        content: '解锁后创作物回到「迭代中」，可继续经 agent 迭代。',
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

function goList(): void {
  void router.push('/deck')
}

onMounted(async () => {
  await loadDetail()
  const cur = detail.value?.currentVersionId
  if (cur) await loadPreview(cur)
})

watch(deckId, async (next, prev) => {
  if (!next || next === prev) return
  version.clear()
  previewVersionId.value = ''
  await loadDetail()
  const cur = detail.value?.currentVersionId
  if (cur) await loadPreview(cur)
})
</script>

<template>
  <div class="dl-page deck-workbench">
    <!-- 页头行：名称 + 状态/类型 tag + 操作 -->
    <div class="dl-page-header">
      <h1 class="dl-page-title deck-name">{{ detail?.deckName || '创作物详情' }}</h1>
      <a-tag
        v-if="detail?.deckStatus"
        :color="deckDict.color(DECK_DICT_STATUS, detail.deckStatus)"
      >
        {{ deckDict.label(DECK_DICT_STATUS, detail.deckStatus) }}
      </a-tag>
      <a-tag v-if="detail?.deckType">
        {{ deckDict.label(DECK_DICT_TYPE, detail.deckType) }}
      </a-tag>
      <div class="dl-page-header-right">
        <a-button
          v-for="act in actions"
          :key="act.key"
          :type="act.primary ? 'primary' : 'default'"
          :danger="act.danger"
          size="small"
          @click="onAction(act)"
        >
          {{ act.label }}
        </a-button>
        <a-button size="small" @click="goList">返回列表</a-button>
      </div>
    </div>

    <a-alert
      v-if="loadFailed"
      class="deck-failed"
      type="error"
      show-icon
      message="详情加载失败"
      description="网络或服务暂不可用，可重试。"
    >
      <template #action><a-button size="small" @click="loadDetail">重试</a-button></template>
    </a-alert>

    <!-- 工作台主体：左版本树 + 右预览画布 -->
    <div class="deck-workbench-main">
      <div class="deck-tree-col">
        <VersionTreePanel
          :deck-id="deckId"
          :current-version-id="detail?.currentVersionId ?? undefined"
          :readonly="readonly"
          @preview="onTreePreview"
          @changed="onTreeChanged"
          @compare="onCompare"
          @export-from="onExportFrom"
        />
      </div>
      <div class="deck-canvas-col">
        <DeckPreviewCanvas
          :content="(version.detail.value?.content as Record<string, unknown> | null) ?? null"
          :file-urls="version.fileUrls.value"
          :version-label="version.versionLabel.value"
          :loading="version.loading.value"
          :version-id="previewVersionId"
          @present="onPresent"
        />
      </div>
    </div>

    <!-- 下方小节流（分隔线 + 小节标题，禁卡中卡） -->
    <div class="deck-sections">
      <!-- 基本信息 -->
      <div class="dl-section">
        <div class="dl-section-title">基本信息</div>
        <a-descriptions :column="2" size="small">
          <a-descriptions-item label="主题">{{ detail?.topic || '-' }}</a-descriptions-item>
          <a-descriptions-item label="默认品牌规范">{{ detail?.brandKitName || '-' }}</a-descriptions-item>
          <a-descriptions-item label="需求描述" :span="2">{{ detail?.requirement || '-' }}</a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ formatDatetime(detail?.createdTime) }}</a-descriptions-item>
          <a-descriptions-item label="更新时间">{{ formatDatetime(detail?.updatedTime) }}</a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 迭代状态 -->
      <div class="dl-section">
        <div class="dl-section-title">迭代状态</div>
        <a-descriptions :column="4" size="small">
          <a-descriptions-item label="当前版本">{{ version.versionLabel.value || '-' }}</a-descriptions-item>
          <a-descriptions-item label="活动分支">{{ detail?.activeBranch || '-' }}</a-descriptions-item>
          <a-descriptions-item label="版本数">{{ detail?.stats?.versionCount ?? 0 }}</a-descriptions-item>
          <a-descriptions-item label="调整次数">{{ detail?.stats?.adjustCount ?? 0 }}</a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 大纲（仅 DRAFT 可编辑；首版后只读） -->
      <div class="dl-section">
        <div class="dl-section-title">大纲{{ isDraft ? '' : '（首版后只读）' }}</div>
        <OutlineEditor
          v-if="isDraft"
          :nodes="outlineNodes"
          @change="onOutlineChange"
          @save="saveOutline"
        />
        <div v-else-if="outlineNodes.length > 0" class="deck-outline-readonly">
          <div v-for="(node, i) in outlineNodes" :key="node.nodeId" class="deck-outline-node">
            <span class="deck-outline-no">{{ i + 1 }}</span>
            <div>
              <div class="deck-outline-title">{{ node.title || '未命名节点' }}</div>
              <ul v-if="node.points.length" class="deck-outline-points">
                <li v-for="(p, pi) in node.points" :key="pi">{{ p }}</li>
              </ul>
            </div>
          </div>
        </div>
        <a-empty v-else :image-style="{ height: '40px' }" description="暂无大纲" />
      </div>

      <!-- 交 agent 调整（引导） -->
      <div class="dl-section">
        <div class="dl-section-title">交 agent 调整</div>
        <p class="deck-agent-tip">
          内容修改请在 coding agent 中经 deck-loop MCP 完成（version_create 直写新版本）。
          网站仅支持版本回退/分叉与大纲编辑，不提供内容写入口。
        </p>
        <pre class="deck-agent-context">{{ agentContext }}</pre>
        <a-space>
          <a-button size="small" @click="copyContext">
            <CopyOutlined />
            复制上下文
          </a-button>
          <a-button size="small" type="link" @click="goPromptLibrary">话术库</a-button>
        </a-space>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deck-workbench {
  height: 100%;
}

.deck-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 320px;
}

.deck-failed {
  margin: 16px 24px 0;
}

.deck-workbench-main {
  flex: none;
  display: flex;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--dl-border-light);
  height: 520px;
}

.deck-tree-col {
  flex: none;
  width: 340px;
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--dl-border-light);
  padding-right: 16px;
}

.deck-canvas-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.deck-sections {
  padding: 24px;
}

.deck-agent-tip {
  color: var(--dl-text-secondary);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 12px;
}

.deck-agent-context {
  background: var(--dl-hover-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--dl-title-color);
  margin: 0 0 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
}

.deck-outline-readonly {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.deck-outline-node {
  display: flex;
  gap: 12px;
}

.deck-outline-no {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--dl-primary);
  color: var(--dl-doc-bg);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.deck-outline-title {
  font-weight: 600;
  color: var(--dl-title-color);
}

.deck-outline-points {
  margin: 4px 0 0;
  padding-left: 18px;
  color: var(--dl-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
</style>