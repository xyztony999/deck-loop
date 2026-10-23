<script setup lang="ts">
/**
 * DlCardPage v2 — steps 向导容器引擎（07-ui-design-language.md §3.3 单表面形态）。
 *
 * 粘顶向导栏（标题 + 内联文字步骤条 + 动作组）→ 860 居中小节流。
 * 卡片类型（form/detail/list/alert/flow）与全部插槽（#card-{key}/#field-{field}）不变。
 * 按钮约定（F-01）：暂存(仅 saveDraftAction) → 上一步 → 下一步/提交 → 取消。
 * - 表单字段 2 列（860 容器内），textarea/upload 独占一行
 * - Card >=3 自动启用悬浮锚点（§5.8）
 * - loadAction 自动加载详情，禁止页面 onMounted 手动调详情（selfcheck F-18）
 * - beforeNext 抛异常不得静默卡死向导（2026-10-20 教训），显式报错并停留本步
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { CheckOutlined, CloseOutlined, MenuOutlined } from '@ant-design/icons-vue'

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

function goTo(index: number): void {
  if (index < 0 || index >= steps.value.length || index === current.value) return
  current.value = index
  emit('step-change', steps.value[current.value].key, current.value)
}

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
  if (step.beforeNext) {
    let ok: boolean
    try {
      ok = await step.beforeNext(formData)
    } catch (err) {
      console.error('[DlCardPage] beforeNext 执行异常', err)
      message.error('步骤校验异常，请稍后重试')
      return
    }
    if (!ok) return
  }
  if (isLast.value) {
    await doSubmit()
    return
  }
  current.value += 1
  emit('step-change', steps.value[current.value].key, current.value)
}

async function prev(): Promise<void> {
  goTo(current.value - 1)
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
  if (f.span === 'full' || f.span === 2 || f.type === 'textarea' || f.type === 'upload') {
    return 'dl-form-item-full'
  }
  return 'dl-form-item-span-1'
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
    <!-- 粘顶向导栏：标题 + 内联步骤条 + 动作组（07 §3.3） -->
    <div class="dl-wizard-bar">
      <span class="dl-wizard-bar-title">{{ config.title }}</span>

      <div class="dl-wizard-steps">
        <template v-for="(s, i) in steps" :key="s.key">
          <button
            type="button"
            class="dl-step"
            :class="{ 'is-current': i === current, 'is-done': i < current }"
            :disabled="i > current"
            @click="goTo(i)"
          >
            <span class="dl-step-dot">
              <CheckOutlined v-if="i < current" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="dl-step-name">{{ s.title }}</span>
          </button>
          <span v-if="i < steps.length - 1" class="dl-step-sep">›</span>
        </template>
      </div>

      <div class="dl-wizard-actions">
        <a-button @click="emit('cancel')">取消</a-button>
        <a-button v-if="current > 0" @click="prev">上一步</a-button>
        <a-button
          v-if="config.saveDraftAction"
          :loading="submitting"
          @click="saveDraft"
        >
          暂存
        </a-button>
        <a-button
          type="primary"
          :loading="submitting"
          @click="next"
        >
          {{ isLast ? '提交' : '下一步' }}
        </a-button>
      </div>
    </div>

    <!-- 步骤内容：860 居中小节流 -->
    <a-spin :spinning="loadingDetail" class="dl-wizard-spin">
      <div class="dl-wizard-body">
        <section
          v-for="card in visibleCards(current)"
          :id="`dl-card-${card.key}`"
          :key="card.key"
          class="dl-section"
        >
          <h3 class="dl-section-title">{{ card.title }}</h3>

          <!-- form 小节：2 列网格，textarea/upload 独占一行（F-02） -->
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

          <!-- detail 小节：属性网格（同 DlDetailPage 排版：标签上值下 2 列） -->
          <div v-else-if="card.type === 'detail'" class="dl-prop-grid">
            <div v-for="f in card.fields ?? []" :key="f.field" class="dl-prop">
              <div class="dl-prop-label">{{ f.label }}</div>
              <div class="dl-prop-value">{{ detailText(f.field, f.type) }}</div>
            </div>
          </div>

          <!-- list 小节（自治数据可经 #card-{key} 插槽覆盖） -->
          <slot v-else-if="card.type === 'list'" :name="`card-${card.key}`" :card="card" :form-data="formData">
            <a-table
              :columns="(card.columns ?? []).map((c) => ({ key: c.dataIndex, dataIndex: c.dataIndex, title: c.title, width: c.width, align: c.align }))"
              :data-source="card.items ?? []"
              :pagination="(card.items?.length ?? 0) > 5 ? { pageSize: 5, size: 'small' } : false"
              row-key="id"
              size="small"
            />
          </slot>

          <!-- alert 小节（§5.15） -->
          <a-alert
            v-else-if="card.type === 'alert'"
            :type="card.alertType ?? 'info'"
            :message="card.alertMessage"
            show-icon
          />

          <!-- flow 小节（§5.17） -->
          <slot v-else-if="card.type === 'flow'" :name="`card-${card.key}`" :card="card" :form-data="formData" />

          <!-- 通用兜底插槽 -->
          <slot v-else :name="`card-${card.key}`" :card="card" :form-data="formData" />
        </section>
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
/* 内联文字步骤条（07 §3.3）：18px 描边圆序号 + 13px 步骤名；可回跳已完成步 */
.dl-wizard-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dl-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--dl-text-secondary);

  &:disabled {
    cursor: default;
  }

  &.is-current {
    color: var(--dl-title-color);
    font-weight: 600;

    .dl-step-dot {
      border-color: var(--dl-primary);
      color: var(--dl-primary);
    }
  }

  &.is-done {
    .dl-step-dot {
      border-color: var(--dl-primary);
      color: var(--dl-primary);
      background: transparent;
    }
  }
}

.dl-step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--dl-border-light);
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  flex: none;
}

.dl-step-name {
  white-space: nowrap;
}

.dl-step-sep {
  color: var(--dl-border-light);
  font-size: 13px;
}

.dl-wizard-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dl-wizard-spin {
  flex: 1 0 auto;
}

/* 表单 2 列网格（860 容器内；07 §3.3） */
.dl-form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 24px;
}

.dl-form-item-span-1 {
  grid-column: span 1;
}

.dl-w-full {
  width: 100%;
}

/* 属性网格（07 v2.0 §3.4，与 DlDetailPage 同语言） */
.dl-prop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 32px;
}

.dl-prop {
  min-width: 0;
}

.dl-prop-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--dl-text-secondary);
}

.dl-prop-value {
  font-size: 14px;
  color: var(--dl-title-color);
  overflow-wrap: anywhere;
}
</style>
