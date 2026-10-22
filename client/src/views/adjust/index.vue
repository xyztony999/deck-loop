<script setup lang="ts">
/**
 * 迭代工作台（PageSpec adjustment.md C-03 + C-04 面板；产品核心页，
 * 页面类型 hybrid：左=内容预览画布[code] 60% / 右=指令与版本面板[config] 40%）。
 *
 * - 布局三区：顶栏（deckName · 状态 tag · 当前版本 v{seq}·分支 · 定稿/导出）+
 *   左画布（版本内容渲染 + TargetKind 选中定位）+ 右面板三 Tab
 *   （调整指令 / 版本树 / 任务记录）；
 * - 状态机联动（§1）：DeckStatus=FINALIZED/ARCHIVED 全页只读
 *   （提示解锁/恢复）；DRAFT 引导去生成向导；
 * - 任务跟踪复用 gen 模块 useTaskProgress（轮询 2s + SSE 增强，
 *   SSE 健康时停轮询）与 TaskProgressCard；
 * - needForkBranch（§4.2）：基线≠当前版本时指令卡进入分叉确认态
 *   （branchName 输入 → confirm=true 提交），后端回执同语义兜底；
 * - 弱网（§7）：任务轮询失败静默重试（useTaskProgress 内置）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useRoute, useRouter } from 'vue-router'

import { DlListPage, executeAction, useDict } from '@/engine'
import type { DeckDetailVO } from '@/views/deck/deck.shared'
import {
  DECK_DICT_STATUS,
  DECK_STATUS,
  registerDeckDictColors,
  registerTaskStatusColors,
} from '@/views/deck/deck.shared'
import { useTaskProgress, type TaskProgressInfo } from '@/views/gen/composables/useTaskProgress'
import {
  TASK_STATUS,
  isTerminalTaskStatus,
  type GenTaskCreateVO,
  type GenTaskDetailVO,
} from '@/views/gen/types'

import DeckPreviewCanvas from './components/DeckPreviewCanvas.vue'
import InstructionPanel from './components/InstructionPanel.vue'
import VersionTreePanel from './components/VersionTreePanel.vue'
import VersionCompareDrawer from './components/VersionCompareDrawer.vue'
import { adjustTaskListConfig, registerAdjustDictColors } from './adjust.config'
import { useVersionContent } from './composables/useVersionContent'
import {
  ADJUST_DICT_TARGET_KIND,
  ADJUST_TASK_TYPES,
  buildTargetPath,
  type AdjustSubmitVO,
  type AdjustTarget,
  type InstructionSubmitPayload,
  type ScopeValidateVO,
  type VersionCompareTarget,
} from './types'

registerDeckDictColors()
registerTaskStatusColors()
registerAdjustDictColors()

// ---------------------------------------------------------------
// 路由锚定（/adjust?deckId= 与 PageSpec §1/§6 的 /deck/:deckId/iterate 同页双入口）
// ---------------------------------------------------------------

const route = useRoute()
const router = useRouter()

function firstParam(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** 行 VO 字段收窄（列表行以宽松形态读取，运行时收窄） */
function strVal(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

const deckId = computed(() => firstParam(route.params.deckId) ?? firstParam(route.query.deckId))

/** DlListPage expose 契约（任务记录 Tab；行 VO 宽松形态读） */
interface ListPageHandle {
  refresh: () => Promise<void>
  search: () => Promise<void>
  list: {
    query: Record<string, unknown>
    records: { value: Record<string, unknown>[] }
  }
}

const taskListRef = ref<ListPageHandle | null>(null)
const treeRef = ref<{ reload: () => Promise<void> } | null>(null)

// ---------------------------------------------------------------
// 字典（TargetKind / TaskStatus / DeckStatus，禁止硬编码）
// ---------------------------------------------------------------

const deckDict = useDict('deck', [DECK_DICT_STATUS])
const adjustDict = useDict('adjust', [ADJUST_DICT_TARGET_KIND])
const taskDict = useDict('gen', ['task.TaskStatus'])

// ---------------------------------------------------------------
// Deck 锚定与只读守卫（§1：FINALIZED/ARCHIVED 全页只读）
// ---------------------------------------------------------------

const deck = ref<DeckDetailVO | null>(null)
const deckLoading = ref(false)

async function loadDeck(): Promise<void> {
  if (!deckId.value) return
  deckLoading.value = true
  try {
    deck.value = await executeAction<DeckDetailVO>('deck.deckDetail', {
      deckId: deckId.value,
      withStats: true,
    })
  } finally {
    deckLoading.value = false
  }
}

const deckStatus = computed(() => deck.value?.deckStatus ?? '')
const draftGuard = computed(() => deckStatus.value === DECK_STATUS.DRAFT)
const readonlyMode = computed(
  () => deckStatus.value === DECK_STATUS.FINALIZED || deckStatus.value === DECK_STATUS.ARCHIVED,
)

/** 顶栏「当前版本 v{seq}·分支」标签（加载当前版本 detail 时留存） */
const currentVersionLabel = ref('')
const currentVersionId = computed(() => deck.value?.currentVersionId ?? undefined)

// ---------------------------------------------------------------
// 版本内容预览（画布基线 = viewingVersionId，通常为当前版本）
// ---------------------------------------------------------------

const versionContent = useVersionContent()
const viewingVersionId = ref<string>()
const baselineIsCurrent = computed(
  () => !!currentVersionId.value && viewingVersionId.value === currentVersionId.value,
)

async function loadVersionIntoCanvas(versionId: string): Promise<void> {
  viewingVersionId.value = versionId
  await versionContent.load(versionId)
  if (versionId === currentVersionId.value) {
    currentVersionLabel.value = versionContent.versionLabel.value
  }
}

// ---------------------------------------------------------------
// 定向目标选中（TargetKind 作用域）+ scope 实时校验（§4.1 选中即调）
// ---------------------------------------------------------------

const target = ref<AdjustTarget | null>(null)
const targetValid = ref(true)
const targetSummary = ref('')
let scopeSeq = 0

const targetKindLabel = computed(() =>
  target.value ? adjustDict.label(ADJUST_DICT_TARGET_KIND, target.value.kind) : '',
)

function onCanvasSelect(next: AdjustTarget | null): void {
  target.value = next
  if (!next) {
    targetValid.value = true
    targetSummary.value = ''
    return
  }
  void validateScope(next)
}

/** D4：版本切换后页/块 ID 失效的提前拦截（提交前独立校验接口） */
async function validateScope(t: AdjustTarget): Promise<void> {
  if (!deckId.value || !viewingVersionId.value) return
  const seq = ++scopeSeq
  try {
    const vo = await executeAction<ScopeValidateVO>('adjust.scopeValidate', {
      deckId: deckId.value,
      versionId: viewingVersionId.value,
      targetKind: t.kind,
      targetPath: buildTargetPath(t),
    })
    if (seq !== scopeSeq) return // 过期回包丢弃
    targetValid.value = !!vo?.valid
    targetSummary.value = vo?.targetSummary ?? ''
    if (vo && vo.valid !== true) {
      message.warning('选中的目标在当前基线版本上已失效，请重新选择')
    }
  } catch {
    if (seq === scopeSeq) {
      // 接口异常保守处理：标记失效，禁用定向提交（whole 不受影响）
      targetValid.value = false
      targetSummary.value = ''
    }
  }
}

// 版本切换：旧选中目标的 pageId/blockId 在新基线上失效，统一清空回整稿
watch(viewingVersionId, () => {
  target.value = null
  targetValid.value = true
  targetSummary.value = ''
  scopeSeq += 1
})

// ---------------------------------------------------------------
// 任务跟踪（复用 gen：useTaskProgress 轮询+SSE；TaskProgressCard 展示）
// ---------------------------------------------------------------

const activeTaskId = ref<string>()
const submitting = ref(false)

const progress = useTaskProgress({
  deckId: () => deckId.value,
  onFinished: handleTaskFinished,
})

const activeTaskInfo = computed(() => progress.info(activeTaskId.value))
const taskRunning = computed(
  () => !!activeTaskInfo.value && !isTerminalTaskStatus(activeTaskInfo.value.taskStatus),
)
const taskFailed = computed(
  () => activeTaskInfo.value?.taskStatus === TASK_STATUS.FAILED,
)

function statusLabelOf(t: TaskProgressInfo | undefined): string {
  return t ? taskDict.label('task.TaskStatus', t.taskStatus) : ''
}

/** 终态回调：成功→刷新画布+树+deck 指针；失败→拉错误摘要（§4.3） */
function handleTaskFinished(t: TaskProgressInfo): void {
  if (t.taskId === activeTaskId.value) {
    if (t.taskStatus === TASK_STATUS.SUCCEEDED) {
      void onAdjustSucceeded(t.taskId)
    } else if (t.taskStatus === TASK_STATUS.FAILED) {
      void fetchTaskError(t.taskId)
    }
  }
  void refreshTaskList()
}

async function onAdjustSucceeded(taskId: string): Promise<void> {
  // 成功 toast「已生成 v{newSeq}」（§4.3）——seq 取任务详情 resultVersionSeq
  let seq: number | undefined
  try {
    const detail = await executeAction<GenTaskDetailVO>('gen.taskDetail', { taskId })
    seq = detail?.resultVersionSeq ?? undefined
  } catch {
    // 摘要获取失败静默：toast 退化为通用文案
  }
  message.success(seq != null ? `已生成 v${seq}` : '已生成新版本')
  // 成功自动 version_detail 刷新画布（§4.3）：指针已移向新版本
  panelNeedFork.value = false
  await loadDeck()
  const cur = currentVersionId.value
  if (cur) await loadVersionIntoCanvas(cur)
  await treeRef.value?.reload()
}

async function fetchTaskError(taskId: string): Promise<void> {
  try {
    const detail = await executeAction<GenTaskDetailVO>('gen.taskDetail', { taskId })
    progress.setErrorMsg(taskId, detail?.errorMsg ?? '')
  } catch {
    // 摘要获取失败静默：卡片已有兜底文案
  }
}

// ---------------------------------------------------------------
// 指令提交（whole/targeted + needForkBranch 提示态，§4.2）
// ---------------------------------------------------------------

const panelNeedFork = ref(false)

// 基线回到当前版本后，历史 needForkBranch 回执不再适用，退出分叉确认态
watch(baselineIsCurrent, (cur) => {
  if (cur) panelNeedFork.value = false
})

async function onSubmitInstruction(payload: InstructionSubmitPayload): Promise<void> {
  if (!deckId.value || !viewingVersionId.value || submitting.value) return
  submitting.value = true
  try {
    const ao: Record<string, unknown> = {
      deckId: deckId.value,
      baseVersionId: viewingVersionId.value,
      instructionText: payload.instructionText,
      applyBrandKit: payload.applyBrandKit,
      usedTemplateIds: payload.usedTemplateIds,
    }
    if (payload.applyBrandKit && payload.brandKitId) ao.brandKitId = payload.brandKitId
    if (payload.confirm) {
      ao.confirm = true
      if (payload.branchName) ao.branchName = payload.branchName
    }
    if (payload.mode === 'targeted' && target.value) {
      ao.targetKind = target.value.kind
      ao.targetPath = buildTargetPath(target.value)
    }
    const vo = await executeAction<AdjustSubmitVO>(
      payload.mode === 'whole' ? 'adjust.wholeSubmit' : 'adjust.targetedSubmit',
      ao,
    )
    // needForkBranch 提示态回执（基线≠当前版本且未 confirm）：进入分叉确认
    if (!vo?.taskId && vo?.needForkBranch === true) {
      panelNeedFork.value = true
      message.warning('基线版本非当前版本，请填写分叉分支名后确认提交')
      return
    }
    panelNeedFork.value = false
    if (vo?.taskId) {
      activeTaskId.value = vo.taskId
      progress.track(vo.taskId, vo.taskStatus ?? TASK_STATUS.QUEUED)
      message.success('调整任务已提交，正在跟踪进度')
      void refreshTaskList()
    }
  } finally {
    submitting.value = false
  }
}

// ---------------------------------------------------------------
// 任务操作：取消 / 重试（指令卡任务卡 + 画布错误条 + 任务记录列表共用）
// ---------------------------------------------------------------

function confirmCancelTask(taskId: string | undefined): void {
  if (!taskId) return
  Modal.confirm({
    title: '确定取消该任务？',
    okText: '取消任务',
    cancelText: '返回',
    maskClosable: false,
    okButtonProps: { danger: true },
    onOk: async () => {
      await executeAction('gen.taskCancel', { taskId })
      message.success('已取消')
      void refreshTaskList()
    },
  })
}

async function retryTask(taskId: string, makeActive: boolean): Promise<void> {
  const vo = await executeAction<GenTaskCreateVO>('gen.taskRetry', { taskId })
  if (vo?.taskId) {
    if (makeActive || !activeTaskId.value) activeTaskId.value = vo.taskId
    progress.track(vo.taskId, TASK_STATUS.QUEUED)
    message.success('已重新发起任务')
  }
  void refreshTaskList()
}

function isAdjustTaskType(taskType: string | undefined): boolean {
  return !!taskType && (ADJUST_TASK_TYPES as readonly string[]).includes(taskType)
}

function onTaskRowClick(btn: { key: string }, row: Record<string, unknown>): void {
  const taskId = strVal(row.taskId)
  if (!taskId) return
  if (btn.key === 'cancel') {
    confirmCancelTask(taskId)
  } else if (btn.key === 'retry') {
    // 调整类任务重试后纳入工作台跟踪（画布骨架屏/任务卡）
    void retryTask(taskId, isAdjustTaskType(strVal(row.taskType)))
  }
}

/** 任务记录 Tab3：DlListPage（gen.taskList，deckId 过滤，operList 驱动） */
async function refreshTaskList(): Promise<void> {
  await taskListRef.value?.refresh()
}

/** 任务记录列表在途任务播种：重进工作台接续跟踪进行中的调整任务 */
const taskRecords = computed<Record<string, unknown>[]>(
  () => taskListRef.value?.list.records.value ?? [],
)

watch(taskRecords, (rows) => {
  for (const row of rows) {
    const taskId = strVal(row.taskId)
    const taskType = strVal(row.taskType)
    const taskStatus = strVal(row.taskStatus)
    if (!taskId || !isAdjustTaskType(taskType)) continue
    if (!taskStatus || isTerminalTaskStatus(taskStatus) || progress.has(taskId)) continue
    progress.track(taskId, taskStatus)
    if (!activeTaskId.value) activeTaskId.value = taskId
  }
})

// ---------------------------------------------------------------
// 版本树联动（Tab2）：预览 / 回退分叉后刷新 / 对比（§4.4）
// ---------------------------------------------------------------

async function onTreePreview(versionId: string): Promise<void> {
  await loadVersionIntoCanvas(versionId)
}

async function onTreeChanged(): Promise<void> {
  // rollback/fork 均移动 Deck 指针：deck 与画布回到当前版本
  await loadDeck()
  const cur = currentVersionId.value
  if (cur) await loadVersionIntoCanvas(cur)
}

const compareOpen = ref(false)
const compareTarget = ref<VersionCompareTarget | null>(null)

function onTreeCompare(t: VersionCompareTarget): void {
  compareTarget.value = t
  compareOpen.value = true
}

// ---------------------------------------------------------------
// 顶栏操作：定稿 / 导出 / 解锁 / 恢复（operList 语义，二次确认）
// ---------------------------------------------------------------

function confirmFinalize(): void {
  const id = deckId.value
  if (!id) return
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
      await loadDeck()
    },
  })
}

function goExport(): void {
  if (deckId.value) void router.push({ path: '/deliver', query: { deckId: deckId.value } })
}

/** 演示入口（delivery.md §1/§6：工作台 [演示] → /deck/:deckId/present） */
function goPresent(): void {
  if (deckId.value) void router.push(`/deck/${deckId.value}/present`)
}

function confirmUnfinalize(): void {
  const id = deckId.value
  if (!id) return
  Modal.confirm({
    title: '确认解锁？',
    content: '解锁后创作物回到「迭代中」，可继续生成与调整。',
    okText: '解锁',
    cancelText: '取消',
    maskClosable: false,
    async onOk() {
      await executeAction('deck.deckUnfinalize', { deckId: id, confirm: true })
      message.success('已解锁')
      await loadDeck()
    },
  })
}

async function restoreDeck(): Promise<void> {
  const id = deckId.value
  if (!id) return
  await executeAction('deck.deckRestore', { deckId: id })
  message.success('已恢复')
  await loadDeck()
}

function goDeckDetail(): void {
  if (deckId.value) void router.push(`/deck/${deckId.value}`)
}

function goGenerate(): void {
  if (deckId.value) void router.push({ path: '/gen', query: { deckId: deckId.value } })
}

// ---------------------------------------------------------------
// 生命周期 / 路由 deckId 变更
// ---------------------------------------------------------------

async function initWorkbench(): Promise<void> {
  await loadDeck()
  const cur = currentVersionId.value
  if (cur) await loadVersionIntoCanvas(cur)
  const handle = taskListRef.value
  if (deckId.value && handle) {
    handle.list.query.deckId = deckId.value
    void handle.search()
  }
}

onMounted(() => {
  void initWorkbench()
})

function resetWorkbench(): void {
  deck.value = null
  currentVersionLabel.value = ''
  viewingVersionId.value = undefined
  target.value = null
  targetValid.value = true
  targetSummary.value = ''
  activeTaskId.value = undefined
  panelNeedFork.value = false
  compareOpen.value = false
  compareTarget.value = null
  versionContent.clear()
  progress.clear()
}

watch(deckId, (next, prev) => {
  if (next === prev || !next || !prev) return
  resetWorkbench()
  void initWorkbench()
})

const activeTab = ref('instruction')
</script>

<template>
  <div class="dl-page adjust-page">
    <template v-if="!deckId || draftGuard">
      <div class="dl-page-header">
        <h1 class="dl-page-title">迭代工作台</h1>
      </div>
      <div class="adjust-guard-body">
        <!-- 缺参守卫：无 deckId 无法锚定工作台 -->
        <a-alert
          v-if="!deckId"
          type="warning"
          show-icon
          message="缺少创作物标识（deckId），请从创作物列表或详情进入"
        />
        <!-- DRAFT 守卫：无版本可迭代，引导生成向导 -->
        <a-alert
          v-else
          type="info"
          show-icon
          message="该创作物尚未生成初稿"
          description="迭代工作台基于内容版本工作，请先在生成向导完成初稿生成。"
        />
        <div class="adjust-guard-actions">
          <a-button v-if="!deckId" type="primary" @click="router.push('/deck')">
            返回创作物列表
          </a-button>
          <a-button v-else type="primary" @click="goGenerate">前往生成向导</a-button>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- 顶栏 = 页头行：deckName · 状态 tag · 当前版本 v{seq}·分支 · 定稿/导出（§4；07 v2.0） -->
      <div class="dl-page-header adjust-topbar">
        <div class="adjust-topbar-left">
          <span class="adjust-topbar-name">{{ deck?.deckName ?? '迭代工作台' }}</span>
          <a-tag
            v-if="deckStatus"
            :color="deckDict.color(DECK_DICT_STATUS, deckStatus)"
          >
            {{ deckDict.label(DECK_DICT_STATUS, deckStatus) }}
          </a-tag>
          <a-tag v-if="currentVersionLabel" color="geekblue">
            当前版本 {{ currentVersionLabel }}
          </a-tag>
          <span v-else class="adjust-topbar-nover">暂无当前版本</span>
        </div>
        <div class="dl-page-header-right">
          <a-space>
            <a-button v-if="deckStatus === DECK_STATUS.ITERATING" @click="confirmFinalize">
              定稿
            </a-button>
            <a-button
              v-if="deckStatus === DECK_STATUS.FINALIZED"
              type="primary"
              @click="goExport"
            >
              导出
            </a-button>
            <a-button
              v-if="deckStatus === DECK_STATUS.FINALIZED"
              @click="goPresent"
            >
              演示
            </a-button>
            <a-button @click="goDeckDetail">返回详情</a-button>
          </a-space>
        </div>
      </div>

      <!-- 只读态横幅（§1：FINALIZED 提示解锁 / ARCHIVED 提示恢复） -->
      <a-alert
        v-if="readonlyMode && deckStatus === DECK_STATUS.FINALIZED"
        class="adjust-readonly-banner"
        type="warning"
        show-icon
        message="创作物已定稿，迭代工作台处于只读状态"
        description="定稿版本已锁定，生成与调整被禁止；解锁后回到「迭代中」可继续迭代。"
      >
        <template #action>
          <a-button size="small" type="primary" @click="confirmUnfinalize">解锁</a-button>
        </template>
      </a-alert>
      <a-alert
        v-else-if="readonlyMode && deckStatus === DECK_STATUS.ARCHIVED"
        class="adjust-readonly-banner"
        type="info"
        show-icon
        message="创作物已归档，迭代工作台处于只读状态"
        description="归档创作物仅可查看或恢复；恢复后回到归档前状态。"
      >
        <template #action>
          <a-button size="small" type="primary" @click="restoreDeck">恢复</a-button>
        </template>
      </a-alert>

      <!-- 三区主体：左画布 60% / 右指令与版本面板 40%（§4；07 v2.0 描边面板） -->
      <div class="adjust-main">
        <div class="adjust-panel adjust-left">
          <DeckPreviewCanvas
            :pages="versionContent.pages.value"
            :file-urls="versionContent.fileUrls.value"
            :selected="target"
            :target-valid="targetValid"
            :disabled="readonlyMode || taskRunning"
            :loading="versionContent.loading.value || deckLoading"
            :task-running="taskRunning"
            :task-stage="activeTaskInfo?.stageText"
            :task-failed="taskFailed"
            :task-error="activeTaskInfo?.errorMsg"
            :version-label="versionContent.versionLabel.value"
            :baseline-is-current="baselineIsCurrent"
            @select="onCanvasSelect"
            @retry="activeTaskId && retryTask(activeTaskId, true)"
          />
        </div>

        <div class="adjust-panel adjust-right">
          <a-tabs v-model:active-key="activeTab" size="small">
            <!-- Tab1 调整指令（§4.2） -->
            <a-tab-pane key="instruction" tab="调整指令">
              <InstructionPanel
                :target="target"
                :target-kind-label="targetKindLabel"
                :target-valid="targetValid"
                :target-summary="targetSummary"
                :baseline-label="versionContent.versionLabel.value"
                :baseline-is-current="baselineIsCurrent"
                :need-fork-prompt="panelNeedFork"
                :default-brand-kit-id="deck?.defaultBrandKitId ?? undefined"
                :default-brand-kit-name="deck?.brandKitName ?? undefined"
                :disabled="readonlyMode"
                :task-running="taskRunning"
                :submitting="submitting"
                :task="activeTaskInfo"
                :status-label="statusLabelOf(activeTaskInfo)"
                @submit="void onSubmitInstruction"
                @task-cancel="confirmCancelTask(activeTaskId)"
                @task-retry="activeTaskId && void retryTask(activeTaskId, true)"
              />
            </a-tab-pane>

            <!-- Tab2 版本树（§4.4） -->
            <a-tab-pane key="tree" tab="版本树">
              <VersionTreePanel
                ref="treeRef"
                :deck-id="deckId"
                :current-version-id="currentVersionId"
                :readonly="readonlyMode"
                @preview="void onTreePreview"
                @changed="void onTreeChanged"
                @compare="onTreeCompare"
              />
            </a-tab-pane>

            <!-- Tab3 任务记录（§4：operList 驱动 cancel/retry） -->
            <a-tab-pane key="tasks" tab="任务记录" force-render>
              <div class="adjust-task-list">
                <DlListPage
                  ref="taskListRef"
                  :config="adjustTaskListConfig"
                  @row-click="onTaskRowClick"
                />
              </div>
            </a-tab-pane>
          </a-tabs>
        </div>
      </div>
    </template>

    <!-- 版本对比视图（全屏覆盖层，版本树「与当前对比」打开） -->
    <VersionCompareDrawer
      v-model:open="compareOpen"
      :deck-id="deckId ?? ''"
      :target="compareTarget"
    />
  </div>
</template>

<style scoped>
.adjust-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.adjust-guard-body {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}

.adjust-guard-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.adjust-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.adjust-topbar-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--dl-title-color);
}

.adjust-topbar-nover {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.adjust-readonly-banner {
  border-radius: 10px;
}

.adjust-main {
  display: grid;
  grid-template-columns: 3fr 2fr; /* 60% / 40%（§4） */
  gap: 16px;
  align-items: stretch;
}

/* 07 v2.0 工作台面板：描边区域（tile 语言），非第二层表面卡片 */
.adjust-panel {
  border: 1px solid var(--dl-border-light);
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
}

.adjust-left {
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}

.adjust-right {
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}

/* 嵌套引擎 .dl-page：随内容伸展，不占满屏 */
.adjust-task-list :deep(.dl-page) {
  min-height: auto;
}

@media (max-width: 1100px) {
  .adjust-main {
    grid-template-columns: 1fr;
  }
}
</style>
