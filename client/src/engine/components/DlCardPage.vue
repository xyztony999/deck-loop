<script setup lang="ts">
/**
 * DlCardPage — steps 向导容器引擎（ScmCardPage/ScmStepFormPage 的
 * deck-loop 轻量等价）。
 *
 * 结构：sticky 标题栏 + 步骤条 + 每步卡片（form/detail/list/alert/flow）。
 * 按钮约定（frontend-specs §3.4 / F-01）：暂存 → 上一步 → 下一步/提交 → 取消。
 * - 表单字段 itemsPerRow=3，textarea/upload 独占一行（§5.7）
 * - Card >=3 自动启用悬浮锚点（§5.8）
 * - loadAction 自动加载详情，禁止页面 onMounted 手动调详情（selfcheck F-18）
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { MenuOutlined, CloseOutlined } from '@ant-design/icons-vue'

import type { DlCardPageConfig, DlCardSchema, DlFieldConfig } from '../pageSchemas'
import { executeAction } from '../actionExecutor'
import { useDict, toSelectOptions } from '../dict'
import { displayValue, formatAmount, formatDatetime, formatUnitPrice } from '../format'

const props = defineProps<{
  config: DlCardPageConfig
  /** 编辑态详情 id（配合 loadAction / detailIdKey） */
  detailId?: string | number
}>()

const emit = defineEmits<{
  /** 页面级操作按钮 */
  (e: 'action', btn: { key: string }, formData: Record<string, unknown>): void
  /** 提交成功（submitAction 返回的 data） */
  (e: 'success', data: unknown): void
  /** 取消 / 关闭 */
  (e: 'cancel'): void
  /** 步骤切换 */
  (e: 'step-change', stepKey: string, index: number): void
}>()

// ---------------------------------------------------------------
// 步骤状态
// ---------------------------------------------------------------

const current = ref(0)
const formData = reactive<Record<string, unknown>>({})
const loadingDetail = ref(false)
const submitting = ref(false)
const formRef = ref()

const steps = computed(() => props.config.steps)
const currentStep = computed(() => steps.value[current.value])

const isLast = computed(() => current.value === steps.value.length - 1)

// ---------------------------------------------------------------
// 字典（全部步骤字段合并一次批量拉取）
// ---------------------------------------------------------------

const dictKeys = computed(() => {
  const keys = new Set<string>()
  steps.value.forEach((s) =>
    s.cards.forEach((c) =>
      (c.fields ?? []).forEach((f) => {
        if (f.dictKey) keys.add(f.dictKey)
      }),
    ),
  )
  return [...keys]
})

const domain = computed(() => props.config.domain ?? '')

const dict = useDict(domain.value, dictKeys.value)

function dictOptions(dictKey: string | undefined) {
  if (!dictKey) return []
  return toSelectOptions(dict.options(dictKey))
}

// ---------------------------------------------------------------
// 详情加载（loadAction 自动加载，F-18）
// ---------------------------------------------------------------

onMounted(async () => {
  if (!props.config.loadAction || props.detailId == null) return
  loadingDetail.value = true
  try {
    const idKey = props.config.detailIdKey ?? 'id'
    const data = await executeAction<Record<string, unknown>>(
      props.config.loadAction,
      { [idKey]: props.detailId },
    )
    if (data) Object.assign(formData, data)
  } finally {
    loadingDetail.value = false
  }
})

// ---------------------------------------------------------------
// 步骤流转
// ---------------------------------------------------------------

function visibleCards(stepIndex: number): DlCardSchema[] {
  const step = steps.value[stepIndex]
  if (!step) return []
  if (step.skip && step.skip(formData)) return []
  return step.cards
}

async function next(): Promise<void> {
  const step = currentStep.value
  if (!step) return
  // 校验当前步 form 卡片
  if (formRef.value && typeof formRef.value.validate === 'function') {
    try {
      await formRef.value.validate()
    } catch {
      return
    }
  }
  if (step.beforeNext && !(await step.beforeNext(formData))) return
  if (isLast.value) {
    await doSubmit()
    return
  }
  current.value += 1
  emit('step-change', steps.value[current.value].key, current.value)
}

async function prev(): Promise<void> {
  if (current.value === 0) return
  current.value -= 1
  emit('step-change', steps.value[current.value].key, current.value)
}

async function doSubmit(): Promise<void> {
  if (!props.config.submitAction) {
    emit('action', { key: 'submit' }, formData)
    return
  }
  submitting.value = true
  try {
    const data = await executeAction(props.config.submitAction, { ...formData })
    message.success('提交成功')
    emit('success', data)
  } finally {
    submitting.value = false
  }
}

async function saveDraft(): Promise<void> {
  if (props.config.saveDraftAction) {
    await executeAction(props.config.saveDraftAction, { ...formData })
  }
  message.success('已暂存')
  emit('action', { key: 'draft' }, formData)
}

// ---------------------------------------------------------------
// 字段绑定辅助（严格类型，不用 any）
// ---------------------------------------------------------------

function fieldSpanClass(f: DlFieldConfig): string {
  if (f.span === 'full' || f.type === 'textarea' || f.type === 'upload') {
    return 'dl-form-item-full'
  }
  return `dl-form-item-span-${f.span ?? 1}`
}

function strField(f: string): string | undefined {
  const v = formData[f]
  return typeof v === 'string' ? v : undefined
}
function numField(f: string): number | undefined {
  const v = formData[f]
  return typeof v === 'number' ? v : undefined
}
function setField(f: string, v: unknown): void {
  formData[f] = v
}

function detailText(field: string, type: string | undefined): string {
  const raw = formData[field]
  switch (type) {
    case 'amount':
      return formatAmount(raw as number | string | null) || '-'
    case 'unitPrice':
      return formatUnitPrice(raw as number | string | null) || '-'
    case 'datetime':
      return formatDatetime(raw as string | null) || '-'
    default:
      return displayValue(raw)
  }
}

// ---------------------------------------------------------------
// 悬浮锚点（可见 Card >=3 时启用，§5.8）
// ---------------------------------------------------------------

const anchorOpen = ref(false)
const anchorCards = computed(() => {
  const cards: { key: string; title: string }[] = []
  steps.value.forEach((s) =>
    s.cards.forEach((c) => cards.push({ key: c.key, title: c.title })),
  )
  return cards
})
const showAnchor = computed(() => anchorCards.value.length >= 3)

defineExpose({
  /** 跳到指定步骤 */
  goToStep: (n: number) => {
    current.value = n
  },
  current: computed(() => current.value),
  formData,
  /** 重新加载详情 */
  reload: () => {
    if (props.config.loadAction && props.detailId != null) {
      void executeAction<Record<string, unknown>>(props.config.loadAction, {
        [props.config.detailIdKey ?? 'id']: props.detailId,
      }).then((data) => {
        if (data) Object.assign(formData, data)
      })
    }
  },
})
</script>

<template>
  <div class="dl-page">
    <!-- sticky 标题栏（F-01） -->
    <div class="dl-sticky-bar dl-card-bar">
      <span class="dl-bar-title">{{ config.title }}</span>
      <a-space>
        <a-button :loading="submitting" @click="saveDraft">暂存</a-button>
        <a-button v-if="current > 0" @click="prev">上一步</a-button>
        <a-button
          type="primary"
          :loading="submitting"
          @click="next"
        >
          {{ isLast ? '提交' : '下一步' }}
        </a-button>
        <a-button @click="emit('cancel')">取消</a-button>
      </a-space>
    </div>

    <!-- 步骤条 -->
    <div class="dl-page-card">
      <a-steps :current="current" size="small">
        <a-step
          v-for="s in steps"
          :key="s.key"
          :title="s.title"
          :description="s.description"
        />
      </a-steps>
    </div>

    <a-spin :spinning="loadingDetail">
      <!-- 当前步骤卡片 -->
      <div
        v-for="card in visibleCards(current)"
        :id="`dl-card-${card.key}`"
        :key="card.key"
        class="dl-page-card"
      >
        <div class="dl-card-title">{{ card.title }}</div>

        <!-- form 卡片：3 列网格，textarea/upload 独占一行（F-02） -->
        <a-form
          v-if="card.type === 'form'"
          ref="formRef"
          class="dl-form"
          layout="vertical"
          :model="formData"
        >
          <div class="dl-form-grid">
            <a-form-item
              v-for="f in card.fields ?? []"
              :key="f.field"
              :class="fieldSpanClass(f)"
              :name="f.field"
              :label="f.type === 'hidden' ? undefined : f.label"
              :rules="f.required ? [{ required: true, message: `请${f.type === 'select' || f.type === 'date' || f.type === 'radio' ? '选择' : '输入'}${f.label}` }] : undefined"
            >
              <slot :name="`field-${f.field}`" :field="f" :form-data="formData">
                <a-input
                  v-if="!f.type || f.type === 'input'"
                  :value="strField(f.field)"
                  :placeholder="f.placeholder ?? '请输入'"
                  v-bind="f.props"
                  @update:value="(v: string) => setField(f.field, v)"
                />
                <a-textarea
                  v-else-if="f.type === 'textarea'"
                  :value="strField(f.field)"
                  :rows="3"
                  :placeholder="f.placeholder ?? '请输入'"
                  v-bind="f.props"
                  @update:value="(v: string) => setField(f.field, v)"
                />
                <a-input-number
                  v-else-if="f.type === 'number'"
                  :value="numField(f.field)"
                  :placeholder="f.placeholder ?? '请输入'"
                  class="dl-w-full"
                  v-bind="f.props"
                  @update:value="(v: unknown) => setField(f.field, v === undefined ? undefined : Number(v))"
                />
                <a-select
                  v-else-if="f.type === 'select'"
                  :value="strField(f.field)"
                  :options="dictOptions(f.dictKey)"
                  :placeholder="f.placeholder ?? '请选择'"
                  v-bind="f.props"
                  @update:value="(v: unknown) => setField(f.field, v === undefined || v === null ? '' : String(v))"
                />
                <a-date-picker
                  v-else-if="f.type === 'date'"
                  :value="strField(f.field)"
                  value-format="YYYY-MM-DD"
                  class="dl-w-full"
                  :placeholder="f.placeholder ?? '请选择日期'"
                  v-bind="f.props"
                  @update:value="(v: unknown) => setField(f.field, v === undefined || v === null ? '' : String(v))"
                />
                <a-radio-group
                  v-else-if="f.type === 'radio'"
                  :value="strField(f.field)"
                  :options="dictOptions(f.dictKey)"
                  v-bind="f.props"
                  @update:value="(v: string) => setField(f.field, v)"
                />
              </slot>
            </a-form-item>
          </div>
        </a-form>

        <!-- detail 卡片 -->
        <a-descriptions v-else-if="card.type === 'detail'" :column="3" size="small">
          <a-descriptions-item
            v-for="f in card.fields ?? []"
            :key="f.field"
            :label="f.label"
          >
            {{ detailText(f.field, f.type) }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- list 卡片（自治数据可经 #card-{key} 插槽覆盖） -->
        <slot v-else-if="card.type === 'list'" :name="`card-${card.key}`" :card="card" :form-data="formData">
          <a-table
            :columns="(card.columns ?? []).map((c) => ({ key: c.dataIndex, dataIndex: c.dataIndex, title: c.title, width: c.width, align: c.align }))"
            :data-source="card.items ?? []"
            :pagination="(card.items?.length ?? 0) > 5 ? { pageSize: 5, size: 'small' } : false"
            row-key="id"
            size="small"
          />
        </slot>

        <!-- alert 卡片（§5.15） -->
        <a-alert
          v-else-if="card.type === 'alert'"
          :type="card.alertType ?? 'info'"
          :message="card.alertMessage"
          show-icon
        />

        <!-- flow 卡片（§5.17） -->
        <slot v-else-if="card.type === 'flow'" :name="`card-${card.key}`" :card="card" :form-data="formData" />

        <!-- 通用兜底插槽 -->
        <slot v-else :name="`card-${card.key}`" :card="card" :form-data="formData" />
      </div>
    </a-spin>

    <!-- 悬浮锚点（§5.8，Teleport 到 body） -->
    <teleport v-if="showAnchor" to="body">
      <div class="dl-anchor-float">
        <div v-if="anchorOpen" class="dl-anchor-float-panel">
          <div class="dl-anchor-float-header">
            <span>导航</span>
            <a-button type="text" size="small" @click="anchorOpen = false">
              <CloseOutlined />
            </a-button>
          </div>
          <a-anchor :offset-top="80" :affix="false">
            <a-anchor-link
              v-for="c in anchorCards"
              :key="c.key"
              :href="`#dl-card-${c.key}`"
              :title="c.title"
            />
          </a-anchor>
        </div>
        <a-button
          v-else
          type="primary"
          shape="circle"
          size="large"
          class="dl-anchor-toggle"
          @click="anchorOpen = true"
        >
          <MenuOutlined />
        </a-button>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.dl-card-bar {
  margin-bottom: 12px;
}

.dl-bar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--dl-title-color);
}

.dl-form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
}

.dl-form-item-span-1 {
  grid-column: span 1;
}

.dl-form-item-span-2 {
  grid-column: span 2;
}

.dl-form-item-span-3 {
  grid-column: span 3;
}

.dl-w-full {
  width: 100%;
}
</style>
