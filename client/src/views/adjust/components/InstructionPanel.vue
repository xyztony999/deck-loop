<script setup lang="ts">
/**
 * 调整指令卡（PageSpec adjustment.md §4.2 Tab1，hybrid 的 config 部分）。
 *
 * - 指令 textarea ≤2000；话术模板插入后占位符须全部替换
 *   （BIZ_ADJUST_PLACEHOLDER_UNRESOLVED 前置拦截并定位）；
 * - 定向目标回显（画布选中态只读 tag + scope 校验摘要）；
 * - 品牌规范约束开关（开启必须选规范，默认 deck 默认规范——选择池
 *   复用 gen 模块 RemoteSelectField）；
 * - needForkBranch 提示态：基线≠当前版本（或后端回执 needForkBranch）
 *   → 展示分叉说明 + branchName 输入（≤50），提交带 confirm=true；
 * - 提交按钮：发起整稿调整（常驻）/ 发起定向调整（仅目标态且校验通过）；
 * - 下方任务卡复用 gen 模块 TaskProgressCard（提交成功后由父页激活）。
 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'

import TaskProgressCard from '@/views/gen/components/TaskProgressCard.vue'
import RemoteSelectField from '@/views/gen/components/RemoteSelectField.vue'
import type { TaskProgressInfo } from '@/views/gen/composables/useTaskProgress'

import PromptTemplateSelect, {
  type PromptTemplateOption,
} from './PromptTemplateSelect.vue'
import {
  BRANCH_NAME_MAX,
  INSTRUCTION_TEXT_MAX,
  findUnresolvedPlaceholders,
  type AdjustTarget,
  type InstructionSubmitPayload,
} from '../types'

const props = defineProps<{
  /** 画布选中目标（只读回显；null=整稿模式） */
  target?: AdjustTarget | null
  /** adjust.TargetKind 字典反查文案 */
  targetKindLabel?: string
  /** scope/validate 结果 */
  targetValid?: boolean
  targetSummary?: string
  /** 基线版本只读标签（v{seq} · branch） */
  baselineLabel?: string
  baselineIsCurrent?: boolean
  /** 后端 needForkBranch 回执：强制进入分叉确认态 */
  needForkPrompt?: boolean
  /** deck 默认品牌规范（开启开关时的默认选择） */
  defaultBrandKitId?: string
  defaultBrandKitName?: string
  /** 只读（FINALIZED/ARCHIVED） */
  disabled?: boolean
  /** 任务进行中（锁定提交） */
  taskRunning?: boolean
  submitting?: boolean
  /** 任务卡（父页 useTaskProgress 跟踪的当前调整任务） */
  task?: TaskProgressInfo
  statusLabel?: string
}>()

const emit = defineEmits<{
  (e: 'submit', payload: InstructionSubmitPayload): void
  (e: 'task-cancel'): void
  (e: 'task-retry'): void
}>()

// ---------------------------------------------------------------
// 表单状态
// ---------------------------------------------------------------

const instructionText = ref('')
const usedTemplateIds = ref<string[]>([])
const applyBrandKit = ref(false)
const brandKitId = ref('')
const brandKitLabel = ref('')
let brandKitTouched = false
const branchName = ref('')

// 开启品牌约束时默认取 deck 默认规范（§4.2：默认 deck 默认规范）
watch(
  () => props.defaultBrandKitId,
  (v) => {
    if (brandKitTouched || !v) return
    brandKitId.value = String(v)
    brandKitLabel.value = props.defaultBrandKitName ?? ''
  },
  { immediate: true },
)

function onBrandKitChange(v: string | string[]): void {
  brandKitTouched = true
  brandKitId.value = Array.isArray(v) ? (v[0] ?? '') : v
}

function onBrandKitLabel(label: string): void {
  brandKitLabel.value = label
}

/** 基线≠当前版本（或后端要求）→ needForkBranch 提示态 */
const forkRequired = computed(
  () => props.baselineIsCurrent === false || props.needForkPrompt === true,
)

const wholeLabel = computed(() =>
  forkRequired.value ? '确认分叉并整稿调整' : '发起整稿调整',
)
const targetedLabel = computed(() =>
  forkRequired.value ? '确认分叉并定向调整' : '发起定向调整',
)

/** 定向按钮可用：有目标 + scope 校验通过（§4.2：仅目标态可用） */
const targetedEnabled = computed(
  () => !!props.target && props.targetValid !== false,
)

// ---------------------------------------------------------------
// 话术模板插入（content 含 {占位符}，由用户替换）
// ---------------------------------------------------------------

function onTemplateSelect(tpl: PromptTemplateOption): void {
  const base = instructionText.value.trim()
  instructionText.value = (base ? `${base}\n` : '') + tpl.content
  if (instructionText.value.length > INSTRUCTION_TEXT_MAX) {
    instructionText.value = instructionText.value.slice(0, INSTRUCTION_TEXT_MAX)
    message.warning(`指令长度已达上限 ${INSTRUCTION_TEXT_MAX} 字，模板内容已截断`)
  }
  if (!usedTemplateIds.value.includes(tpl.templateId)) {
    usedTemplateIds.value = [...usedTemplateIds.value, tpl.templateId]
  }
  const placeholders = findUnresolvedPlaceholders(tpl.content)
  if (placeholders.length > 0) {
    message.info(`请在指令中替换话术占位符：${placeholders.join('、')}`)
  }
}

// ---------------------------------------------------------------
// 提交（前端校验：必填/长度/占位符/品牌规范/分叉分支名）
// ---------------------------------------------------------------

function buildPayload(mode: 'whole' | 'targeted'): InstructionSubmitPayload {
  return {
    mode,
    instructionText: instructionText.value.trim(),
    usedTemplateIds: usedTemplateIds.value,
    applyBrandKit: applyBrandKit.value,
    brandKitId: applyBrandKit.value && brandKitId.value ? brandKitId.value : undefined,
    confirm: forkRequired.value,
    branchName: forkRequired.value ? branchName.value.trim() : undefined,
  }
}

function validate(payload: InstructionSubmitPayload): string | null {
  if (!payload.instructionText) return '请输入调整指令'
  if (payload.instructionText.length > INSTRUCTION_TEXT_MAX) {
    return `调整指令不能超过 ${INSTRUCTION_TEXT_MAX} 字`
  }
  // INV-10：话术占位符全部替换（BIZ_ADJUST_PLACEHOLDER_UNRESOLVED 定位提示）
  const placeholders = findUnresolvedPlaceholders(payload.instructionText)
  if (placeholders.length > 0) {
    return `存在未替换的话术占位符：${placeholders.join('、')}，请替换后再提交`
  }
  if (payload.applyBrandKit && !payload.brandKitId) {
    return '开启品牌规范约束后必须选择规范'
  }
  if (payload.confirm) {
    if (!payload.branchName) return '请填写分叉分支名'
    if (payload.branchName.length > BRANCH_NAME_MAX) {
      return `分支名不能超过 ${BRANCH_NAME_MAX} 字`
    }
  }
  return null
}

function submit(mode: 'whole' | 'targeted'): void {
  if (props.disabled || props.taskRunning || props.submitting) return
  if (mode === 'targeted') {
    if (!props.target) {
      message.warning('请先在左侧画布选中定向目标')
      return
    }
    if (props.targetValid === false) {
      message.warning('选中的目标在当前基线版本上已失效，请重新选择')
      return
    }
  }
  const payload = buildPayload(mode)
  const err = validate(payload)
  if (err) {
    message.warning(err)
    return
  }
  emit('submit', payload)
}
</script>

<template>
  <div class="dl-instruction">
    <!-- 目标回显（画布选中态只读 tag，§4.2） -->
    <div class="dl-instr-row dl-instr-target">
      <span class="dl-instr-label">调整目标</span>
      <template v-if="target">
        <a-tag color="orange">{{ targetKindLabel || target.kind }}</a-tag>
        <span v-if="targetSummary" class="dl-instr-summary">{{ targetSummary }}</span>
        <span v-if="targetValid === false" class="dl-instr-invalid">
          目标已失效，请重新选择
        </span>
      </template>
      <span v-else class="dl-instr-hint">未选中目标：将发起整稿调整（全稿重写）</span>
    </div>

    <!-- 指令输入（必填 ≤2000，§4.2） -->
    <div class="dl-instr-row">
      <span class="dl-instr-label">调整指令</span>
      <div class="dl-instr-grow">
        <a-textarea
          v-model:value="instructionText"
          :rows="5"
          :maxlength="INSTRUCTION_TEXT_MAX"
          :show-count="true"
          :disabled="disabled"
          placeholder="用一句话描述本次调整（≤2000 字）；可选用话术模板后替换 {占位符}"
        />
      </div>
    </div>

    <!-- 话术模板（选用即插入 + 计数） -->
    <div class="dl-instr-row">
      <span class="dl-instr-label">话术模板</span>
      <div class="dl-instr-grow">
        <PromptTemplateSelect :disabled="disabled" @select="onTemplateSelect" />
      </div>
    </div>

    <!-- 品牌规范约束（开关 + 选择器；开启必须选规范） -->
    <div class="dl-instr-row dl-instr-brand">
      <span class="dl-instr-label">品牌规范约束</span>
      <a-switch
        :checked="applyBrandKit"
        :disabled="disabled"
        @update:checked="(v: unknown) => (applyBrandKit = v === true)"
      />
      <div v-if="applyBrandKit" class="dl-instr-brand-select">
        <RemoteSelectField
          :model-value="brandKitId"
          action-key="adjust.brandkitSelect"
          placeholder="选择品牌规范（必选）"
          :initial-label="brandKitLabel"
          :disabled="disabled"
          @update:model-value="onBrandKitChange"
          @update:label="onBrandKitLabel"
        />
      </div>
    </div>

    <!-- 基线版本（只读 v{seq}） -->
    <div class="dl-instr-row dl-instr-baseline">
      <span class="dl-instr-label">基线版本</span>
      <a-tag>{{ baselineLabel || '-' }}</a-tag>
      <span v-if="baselineIsCurrent === false" class="dl-instr-hint">
        基线为预览中的历史版本
      </span>
    </div>

    <!-- needForkBranch 提示态（§4.2：基线≠当前版本 → 确认分叉 + branchName） -->
    <div v-if="forkRequired" class="dl-instr-fork">
      <a-alert
        type="warning"
        show-icon
        message="调整将产生分叉分支"
        :description="`基线版本 ${baselineLabel || ''} 非当前版本，本次调整将从该基线分叉出新分支；请填写分支名（≤${BRANCH_NAME_MAX} 字，同创作物内唯一）后确认提交。`"
      />
      <a-input
        v-model:value="branchName"
        :maxlength="BRANCH_NAME_MAX"
        :disabled="disabled"
        allow-clear
        placeholder="分叉分支名（≤50 字，同创作物内唯一）"
      />
    </div>

    <!-- 提交按钮（§4.2：无选中→整稿；有选中→定向） -->
    <div class="dl-instr-actions">
      <a-button
        type="primary"
        :loading="submitting"
        :disabled="disabled || taskRunning"
        @click="submit('whole')"
      >
        {{ wholeLabel }}
      </a-button>
      <a-button
        :disabled="disabled || taskRunning || !targetedEnabled"
        @click="submit('targeted')"
      >
        {{ targetedLabel }}
      </a-button>
    </div>

    <!-- 任务卡（§4.3：提交成功后激活，轮询/SSE 双通道由父页驱动） -->
    <div class="dl-instr-task">
      <TaskProgressCard
        :task="task"
        :status-label="statusLabel"
        hint="发起调整后在此跟踪任务进度（成功自动刷新画布）"
        @cancel="emit('task-cancel')"
        @retry="emit('task-retry')"
      />
    </div>
  </div>
</template>

<style scoped>
.dl-instruction {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dl-instr-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.dl-instr-label {
  flex: none;
  width: 88px;
  color: var(--dl-text-secondary);
  line-height: 32px;
  text-align: right;
}

.dl-instr-target {
  align-items: center;
  min-height: 32px;
  flex-wrap: wrap;
}

.dl-instr-summary {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.dl-instr-invalid {
  color: var(--dl-danger-color);
  font-size: 13px;
}

.dl-instr-hint {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.dl-instr-row :deep(.dl-prompt-select) {
  width: 100%;
}

.dl-instr-grow {
  flex: 1;
  min-width: 0;
}

.dl-instr-brand {
  align-items: center;
  flex-wrap: wrap;
}

.dl-instr-brand-select {
  flex: 1;
  min-width: 200px;
}

.dl-instr-baseline {
  align-items: center;
}

.dl-instr-fork {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dl-instr-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dl-instr-task {
  border-top: 1px solid var(--dl-border-light);
  padding-top: 12px;
}
</style>
