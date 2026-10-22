<script setup lang="ts">
/**
 * 生成向导（PageSpec generation.md C-02）：
 * 步骤① 需求补充与引用 → 步骤② 大纲确认与编辑 → 步骤③ 整稿生成，
 * 下方任务跟踪 = 进行中任务进度（向导内任务卡）+ 历史任务列表。
 *
 * - 引擎：DlCardPage steps 向导（按钮序列 暂存→上一步→下一步/提交→取消），
 *   大纲编辑树/任务卡经插槽实现（页面类型 hybrid 的 code 部分）。
 * - 进度：批量轮询 /gen/task/progress 为主，SSE（/gw/task/stream）增强，
 *   SSE 不健康时静默回退轮询（useTaskProgress）。
 * - 全局一致性（§7）：ITERATING 及之后进入本页 → 只读引导去迭代工作台；
 *   任务失败错误码/摘要透传展示。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useRoute, useRouter } from 'vue-router'

import { DlCardPage, DlListPage, executeAction, useDict } from '@/engine'
import RemoteSelectField from './components/RemoteSelectField.vue'
import OutlineEditor from './components/OutlineEditor.vue'
import TaskProgressCard from './components/TaskProgressCard.vue'
import { useTaskProgress, type TaskProgressInfo } from './composables/useTaskProgress'
import { buildGenWizardConfig, genTaskListConfig } from './gen.config'
import {
  sanitizeOutline,
  validateOutline,
  type OutlineNode,
} from '@/services/outline'
import {
  ASSET_IDS_MAX,
  LENGTH_OPTIONS,
  LENGTH_OPTION_DEFAULT,
  OUTLINE_AUTOSAVE_DELAY_MS,
  TASK_STATUS,
  TASK_TYPE,
  isTerminalTaskStatus,
  type GenTaskCreateVO,
  type GenTaskDetailVO,
} from './types'

// ---------------------------------------------------------------
// 路由与 deck 锚定（/gen?deckId= 或 PageSpec /deck/:deckId/generate）
// ---------------------------------------------------------------

const route = useRoute()
const router = useRouter()

function firstParam(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** 行 VO 字段收窄（列表行以宽松形态读取） */
function strVal(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

const deckId = computed(() => firstParam(route.params.deckId) ?? firstParam(route.query.deckId))

/** DlCardPage expose 契约（env.d.ts 的 SFC 宽类型拿不到具体 expose） */
interface CardPageHandle {
  goToStep: (n: number) => void
  formData: Record<string, unknown>
  reload: () => void
}

/** DlListPage expose 契约（仅用到部分句柄；行 VO 以宽松形态读，运行时收窄） */
interface ListPageHandle {
  refresh: () => Promise<void>
  search: () => Promise<void>
  list: {
    query: Record<string, unknown>
    records: { value: Record<string, unknown>[] }
  }
}

const wizardRef = ref<CardPageHandle | null>(null)
const taskListRef = ref<ListPageHandle | null>(null)

// ---------------------------------------------------------------
// 字典（TaskType/TaskStatus，禁止硬编码）
// ---------------------------------------------------------------

const dict = useDict('gen', ['taskStatus', 'taskType'])

// ---------------------------------------------------------------
// 任务进度（轮询为主 + SSE 增强）
// ---------------------------------------------------------------

const outlineTaskId = ref<string>()
const fullTaskId = ref<string>()
const outlineSubmitting = ref(false)
const fullSubmitting = ref(false)

const progress = useTaskProgress({
  deckId: () => deckId.value,
  onFinished: handleTaskFinished,
})

const outlineTaskInfo = computed(() => progress.info(outlineTaskId.value))
const fullTaskInfo = computed(() => progress.info(fullTaskId.value))

function statusLabelOf(t: TaskProgressInfo | undefined): string {
  return t ? dict.label('taskStatus', t.taskStatus) : ''
}

function outlineActive(): boolean {
  const t = outlineTaskInfo.value
  return !!t && !isTerminalTaskStatus(t.taskStatus)
}

function fullActive(): boolean {
  const t = fullTaskInfo.value
  return !!t && !isTerminalTaskStatus(t.taskStatus)
}

/** 终态回调：大纲成功→刷新进步骤②；整稿成功→toast+跳迭代工作台；失败→拉摘要 */
function handleTaskFinished(t: TaskProgressInfo): void {
  if (t.taskId === outlineTaskId.value) {
    if (t.taskStatus === TASK_STATUS.SUCCEEDED) {
      message.success('大纲已生成')
      outlineDirty.value = false
      pendingAdvanceToOutline.value = true
      wizardRef.value?.reload()
    } else if (t.taskStatus === TASK_STATUS.FAILED) {
      void fetchTaskError(t.taskId)
    }
  } else if (t.taskId === fullTaskId.value) {
    if (t.taskStatus === TASK_STATUS.SUCCEEDED) {
      message.success('初稿 v1 已生成')
      void goAdjust()
    } else if (t.taskStatus === TASK_STATUS.FAILED) {
      void fetchTaskError(t.taskId)
    }
  }
  void refreshTaskList()
}

async function fetchTaskError(taskId: string): Promise<void> {
  try {
    const detail = await executeAction<GenTaskDetailVO>('gen.taskDetail', { taskId })
    // errorMsg 为失败摘要（错误码透传由 request 层全局 message 承担）
    progress.setErrorMsg(taskId, detail?.errorMsg ?? '')
  } catch {
    // 摘要获取失败静默：卡片已有兜底文案
  }
}

async function refreshTaskList(): Promise<void> {
  await taskListRef.value?.refresh()
}

// ---------------------------------------------------------------
// 只读守卫（ITERATING 及之后：PageSpec §7）
// ---------------------------------------------------------------

const deckForm = computed(() => wizardRef.value?.formData)
const loadedDeckStatus = ref<string>()

watch(
  () => deckForm.value?.deckStatus,
  (s) => {
    if (typeof s === 'string' && s !== '') loadedDeckStatus.value = s
  },
)

const readonlyMode = computed(
  () => !!loadedDeckStatus.value && loadedDeckStatus.value !== 'DRAFT',
)

async function goAdjust(): Promise<void> {
  await router.push({ path: '/adjust', query: { deckId: deckId.value } })
}

// ---------------------------------------------------------------
// 表单侧状态（引擎 formData 之外的插槽侧绑定）
// ---------------------------------------------------------------

const assetIds = ref<string[]>([])
const brandKitId = ref<string>('')
const brandKitLabel = ref<string>('')
let brandKitTouched = false

const outlineNodes = ref<OutlineNode[]>([])
const outlineDirty = ref(false)
const pendingAdvanceToOutline = ref(false)
let saveTimer: number | undefined

const outlineReady = computed(() => outlineNodes.value.length > 0)

// deck 详情回填：默认规范 / 已有 draftOutline / 篇幅默认值
watch(
  () => deckForm.value?.defaultBrandKitId,
  (v) => {
    if (brandKitTouched || !v) return
    brandKitId.value = String(v)
    const name = deckForm.value?.brandKitName
    brandKitLabel.value = typeof name === 'string' && name !== '' ? name : ''
  },
)

watch(
  () => deckForm.value?.brandKitName,
  (name) => {
    // 尚未手动选择时，跟随 deck 默认规范名
    if (!brandKitTouched && typeof name === 'string' && name !== '' && brandKitId.value) {
      brandKitLabel.value = name
    }
  },
)

watch(
  () => deckForm.value?.draftOutline,
  (v) => {
    if (outlineDirty.value || !Array.isArray(v) || v.length === 0) return
    outlineNodes.value = cloneOutline(v)
    syncSummary()
    if (pendingAdvanceToOutline.value) {
      pendingAdvanceToOutline.value = false
      wizardRef.value?.goToStep(1)
    }
  },
)

watch(
  () => deckForm.value,
  (fd) => {
    if (fd && fd.lengthOption == null) fd.lengthOption = LENGTH_OPTION_DEFAULT
  },
)

function cloneOutline(v: unknown): OutlineNode[] {
  const nodes = JSON.parse(JSON.stringify(v)) as OutlineNode[]
  return Array.isArray(nodes) ? nodes : []
}

// 步骤③ 汇总预览（写入 formData 供 detail 卡渲染）
watch([outlineNodes, assetIds, brandKitLabel], () => syncSummary())

function syncSummary(): void {
  const fd = deckForm.value
  if (!fd) return
  fd.outlineNodeCount = outlineNodes.value.length
  fd.assetCount = assetIds.value.length
  fd.selectedBrandKitName = brandKitLabel.value || '未引用'
}

// 篇幅 radio 插槽绑定
const lengthOption = computed<string>(() => {
  const v = deckForm.value?.lengthOption
  return typeof v === 'string' && v !== '' ? v : LENGTH_OPTION_DEFAULT
})

function setLengthOption(v: string): void {
  const fd = deckForm.value
  if (fd) fd.lengthOption = v
}

// ---------------------------------------------------------------
// 大纲编辑：自动保存（debounce 2s）+ 校验 + flush
// ---------------------------------------------------------------

function onOutlineChange(nodes: OutlineNode[]): void {
  outlineDirty.value = true
  outlineNodes.value = nodes
  scheduleAutosave()
}

function scheduleAutosave(): void {
  if (saveTimer != null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined
    void saveOutlineNow()
  }, OUTLINE_AUTOSAVE_DELAY_MS)
}

/** 大纲校验与落盘清洗：services/outline.ts 纯函数（契约单一来源） */

async function saveOutlineNow(opts: { notify?: boolean } = {}): Promise<void> {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
  }
  if (!deckId.value || outlineNodes.value.length === 0) return
  const outline = sanitizeOutline(outlineNodes.value)
  if (validateOutline(outline) != null) return // 脏数据不落盘，由 flush 路径提示
  await executeAction('gen.outlineSave', { deckId: deckId.value, outline })
  if (opts.notify) message.success('大纲已保存')
}

/** 步骤②→③ 前置：校验 + flush 自动保存 */
async function flushOutline(): Promise<boolean> {
  const err = validateOutline(outlineNodes.value)
  if (err) {
    message.warning(err)
    return false
  }
  await saveOutlineNow()
  return true
}

// ---------------------------------------------------------------
// 步骤①：生成大纲（outline_generate）
// ---------------------------------------------------------------

async function startOutlineGenerate(): Promise<void> {
  if (!deckId.value) return
  if (outlineActive()) {
    message.warning('大纲任务进行中，请等待完成')
    return
  }
  outlineSubmitting.value = true
  try {
    const extra = deckForm.value?.extraRequirement
    const vo = await executeAction<GenTaskCreateVO>('gen.outlineGenerate', {
      deckId: deckId.value,
      extraRequirement: typeof extra === 'string' ? extra : '',
      assetIds: assetIds.value,
      brandKitId: brandKitId.value || undefined,
    })
    if (vo?.taskId) {
      outlineTaskId.value = vo.taskId
      progress.track(vo.taskId, vo.taskStatus ?? TASK_STATUS.QUEUED)
    }
  } finally {
    outlineSubmitting.value = false
  }
}

function confirmRegenerate(): void {
  Modal.confirm({
    title: '重新生成大纲',
    content: '重新生成将覆盖当前大纲编辑内容，确定继续？',
    okText: '重新生成',
    cancelText: '取消',
    maskClosable: false,
    onOk: () => startOutlineGenerate(),
  })
}

// ---------------------------------------------------------------
// 步骤③：整稿生成（full_generate，useDraft=true）
// ---------------------------------------------------------------

async function startFullGenerate(): Promise<void> {
  if (!deckId.value) return
  if (!outlineReady.value) {
    message.warning('请先完成大纲确认')
    return
  }
  if (fullActive()) {
    message.warning('整稿任务进行中，请等待完成')
    return
  }
  // full 走 useDraft=true：先把未落盘的大纲编辑 flush 到 draftOutline
  if (!(await flushOutline())) return
  fullSubmitting.value = true
  try {
    const vo = await executeAction<GenTaskCreateVO>('gen.fullGenerate', {
      deckId: deckId.value,
      useDraft: true,
      brandKitId: brandKitId.value || undefined,
      assetIds: assetIds.value,
      lengthOption: lengthOption.value,
    })
    if (vo?.taskId) {
      fullTaskId.value = vo.taskId
      progress.track(vo.taskId, vo.taskStatus ?? TASK_STATUS.QUEUED)
    }
  } finally {
    fullSubmitting.value = false
  }
}

// ---------------------------------------------------------------
// 任务操作：取消 / 重试（进度卡 + 任务记录列表共用）
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

async function retryTask(taskId: string, kind: 'outline' | 'full'): Promise<void> {
  const vo = await executeAction<GenTaskCreateVO>('gen.taskRetry', { taskId })
  if (vo?.taskId) {
    if (kind === 'outline') outlineTaskId.value = vo.taskId
    else fullTaskId.value = vo.taskId
    progress.track(vo.taskId, TASK_STATUS.QUEUED)
    message.success('已重新发起任务')
  }
  void refreshTaskList()
}

function onTaskRowClick(btn: { key: string }, row: Record<string, unknown>): void {
  const taskId = strVal(row.taskId)
  if (!taskId) return
  if (btn.key === 'cancel') {
    confirmCancelTask(taskId)
  } else if (btn.key === 'retry') {
    void retryTask(taskId, strVal(row.taskType) === TASK_TYPE.OUTLINE ? 'outline' : 'full')
  }
}

/** 任务记录列表在途任务播种：重进页面接续跟踪进行中的任务 */
const taskRecords = computed<Record<string, unknown>[]>(
  () => taskListRef.value?.list.records.value ?? [],
)

watch(taskRecords, (rows) => {
  for (const row of rows) {
    const taskId = strVal(row.taskId)
    const taskType = strVal(row.taskType)
    const taskStatus = strVal(row.taskStatus)
    if (!taskId || !taskType || !taskStatus) continue
    if (isTerminalTaskStatus(taskStatus) || progress.has(taskId)) continue
    if (taskType === TASK_TYPE.OUTLINE) outlineTaskId.value = taskId
    else if (taskType === TASK_TYPE.FULL_GENERATE) fullTaskId.value = taskId
    else continue // 调整类任务在迭代工作台跟踪
    progress.track(taskId, taskStatus)
  }
})

// ---------------------------------------------------------------
// 向导按钮区（引擎统一按钮：暂存/上一步/下一步/提交/取消）
// ---------------------------------------------------------------

const wizardConfig = buildGenWizardConfig({
  isOutlineReady: () => outlineReady.value,
  flushOutline,
})

function onWizardAction(btn: { key: string }): void {
  if (btn.key === 'draft') {
    // 引擎已 toast「已暂存」；这里把大纲编辑一并落盘
    void saveOutlineNow()
  } else if (btn.key === 'submit') {
    void startFullGenerate()
  }
}

function onWizardCancel(): void {
  if (window.history.state?.back) router.back()
  else void router.push('/deck')
}

// ---------------------------------------------------------------
// 生命周期 / 路由 deckId 变更
// ---------------------------------------------------------------

onMounted(() => {
  const handle = taskListRef.value
  if (deckId.value && handle) {
    handle.list.query.deckId = deckId.value
    void handle.search()
  }
})

function resetWizardState(): void {
  outlineNodes.value = []
  outlineDirty.value = false
  pendingAdvanceToOutline.value = false
  outlineTaskId.value = undefined
  fullTaskId.value = undefined
  assetIds.value = []
  brandKitId.value = ''
  brandKitLabel.value = ''
  brandKitTouched = false
  loadedDeckStatus.value = undefined
  progress.clear()
}

watch(deckId, (next, prev) => {
  if (next === prev || !next || !prev) return
  resetWizardState()
  wizardRef.value?.reload()
  const handle = taskListRef.value
  if (handle) {
    handle.list.query.deckId = next
    void handle.search()
  }
})

onBeforeUnmount(() => {
  if (saveTimer != null) window.clearTimeout(saveTimer)
})

// ---------------------------------------------------------------
// 插槽事件薄包装（保持模板简洁）
// ---------------------------------------------------------------

function onOutlineSave(): void {
  const err = validateOutline(outlineNodes.value)
  if (err) {
    message.warning(err)
    return
  }
  void saveOutlineNow({ notify: true })
}

function onBrandKitChange(v: string | string[]): void {
  brandKitTouched = true
  brandKitId.value = Array.isArray(v) ? (v[0] ?? '') : v
}

function onAssetIdsChange(v: string | string[]): void {
  assetIds.value = Array.isArray(v) ? v : []
}

function onBrandKitLabel(label: string): void {
  brandKitLabel.value = label
}

function onOutlineCancel(): void {
  confirmCancelTask(outlineTaskId.value)
}

function onOutlineRetry(): void {
  if (outlineTaskId.value) void retryTask(outlineTaskId.value, 'outline')
}

function onFullCancel(): void {
  confirmCancelTask(fullTaskId.value)
}

function onFullRetry(): void {
  if (fullTaskId.value) void retryTask(fullTaskId.value, 'full')
}
</script>

<template>
  <!-- 07 v2.0 单表面：守卫态 = 页头 + 居中提示区；正常态 = 向导 + 分隔线 + 任务记录 -->
  <div class="dl-page">
    <template v-if="!deckId || readonlyMode">
      <div class="dl-page-header">
        <h1 class="dl-page-title">生成向导</h1>
      </div>
      <div class="gen-guard-body">
        <!-- 缺参守卫：无 deckId 无法进入向导 -->
        <a-alert
          v-if="!deckId"
          type="warning"
          show-icon
          message="缺少创作物标识（deckId），请从创作物列表进入"
        />
        <!-- 只读守卫：ITERATING 及之后（PageSpec §7） -->
        <a-alert
          v-else
          type="info"
          show-icon
          message="该创作物已进入迭代阶段，初稿生成向导已锁定"
          description="初稿生成仅在创作物处于草稿态时可用，请前往迭代工作台继续调整内容。"
        />
        <div class="gen-guard-actions">
          <a-button v-if="!deckId" type="primary" @click="router.push('/deck')">
            返回创作物列表
          </a-button>
          <a-button v-else type="primary" @click="goAdjust">前往迭代工作台</a-button>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- 三步向导 -->
      <DlCardPage
        ref="wizardRef"
        :config="wizardConfig"
        :detail-id="deckId"
        @action="onWizardAction"
        @cancel="onWizardCancel"
      >
        <template #field-assetIds>
          <RemoteSelectField
            :model-value="assetIds"
            action-key="gen.assetSelectList"
            multiple
            :max-count="ASSET_IDS_MAX"
            :placeholder="`搜索并选择素材（最多 ${ASSET_IDS_MAX} 个）`"
            @update:model-value="onAssetIdsChange"
          />
        </template>

        <template #field-brandKitId>
          <RemoteSelectField
            :model-value="brandKitId"
            action-key="gen.brandkitSelectList"
            placeholder="选择品牌规范（可空）"
            :initial-label="brandKitLabel"
            @update:model-value="onBrandKitChange"
            @update:label="onBrandKitLabel"
          />
        </template>

        <template #field-lengthOption>
          <a-radio-group
            :value="lengthOption"
            :options="LENGTH_OPTIONS"
            @update:value="(v: string) => setLengthOption(v)"
          />
        </template>

        <!-- 步骤①：生成大纲 + 任务进度条 -->
        <template #card-outlineTask>
          <TaskProgressCard
            :task="outlineTaskInfo"
            :status-label="statusLabelOf(outlineTaskInfo)"
            start-label="生成大纲"
            :start-loading="outlineSubmitting"
            hint="补充需求与引用后生成大纲（生成完成后自动进入下一步）"
            @start="startOutlineGenerate"
            @cancel="onOutlineCancel"
            @retry="onOutlineRetry"
          />
        </template>

        <!-- 步骤②：大纲编辑树（自动保存 2s + 显式保存/重新生成） -->
        <template #card-outlineEditor>
          <OutlineEditor
            :nodes="outlineNodes"
            @change="onOutlineChange"
            @save="onOutlineSave"
            @regenerate="confirmRegenerate"
          />
        </template>

        <!-- 步骤③：发起整稿 + 任务卡 -->
        <template #card-fullTask>
          <TaskProgressCard
            :task="fullTaskInfo"
            :status-label="statusLabelOf(fullTaskInfo)"
            start-label="发起整稿生成"
            :start-loading="fullSubmitting"
            hint="确认篇幅与汇总后发起整稿生成（成功后自动进入迭代工作台）"
            @start="startFullGenerate"
            @cancel="onFullCancel"
            @retry="onFullRetry"
          />
        </template>
      </DlCardPage>

      <!-- 任务跟踪 · 历史任务列表（operList 驱动 cancel/retry；分隔线隔开向导） -->
      <div class="gen-tasks">
        <DlListPage
          ref="taskListRef"
          :config="genTaskListConfig"
          @row-click="onTaskRowClick"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.gen-guard-body {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}

.gen-guard-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

/* 嵌套引擎 .dl-page：随内容伸展，不占满屏 */
.gen-tasks {
  border-top: 1px solid var(--dl-border-light);
}

.gen-tasks :deep(.dl-page) {
  min-height: auto;
}
</style>
