<script setup lang="ts">
/**
 * Tab1 生成偏好（PageSpec settings.md §4 config 表单）。
 *
 * - 默认渠道/模型 + 四档位（OUTLINE/FULL_GENERATE/FULL_ADJUST/
 *   TARGETED_ADJUST）经 channel.select.modelOptions 选择池取数：
 *   value=channelCode::modelCode 组合值（05-select-service-pool.md），
 *   「级联」以组合值单选实现——选择池不提供渠道级独立选项，选中即同时
 *   确定渠道与模型，保存时拆分为 defaultChannelCode/defaultModelCode；
 * - 档位选项按 capabilityTag eq 过滤（api-channel.md §4.4 model-options
 *   AO；capabilityTag=档位键即 TaskType），选项渲染扩展 capabilityTags
 *   tag（settings.md §3）；池内仅 enabled 渠道（INV-22 的前端前置）；
 * - 不可用容错（§4）：detail 返回 available=false 或存量组合已不在
 *   enabled 池中 → 红色标注「已下线，请改选」；保存时强制改选；
 * - fallbackChannel 平台兜底只读展示；按钮：保存/重置；
 * - 保存成功提示「新任务即时生效，进行中任务不受影响」（§8 全局一致性）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'

import { executeAction, useDict } from '@/engine'
import {
  MODEL_VALUE_SEPARATOR,
  PREFERENCE_TASK_TYPES,
  PREFERENCE_TIER_GROUPS,
  PREFERENCE_TIER_HINTS,
  splitModelValue,
  type ModelOptionVO,
  type PreferenceDetailVO,
  type PreferenceSaveAO,
  type PreferenceTaskType,
  type TierPreferenceVO,
} from '../types'

// ---------------------------------------------------------------
// 字典（档位分组标签走 gen 域 task.TaskType，settings.md §3）
// ---------------------------------------------------------------

const dict = useDict('gen', ['task.TaskType'])

function tierLabel(type: PreferenceTaskType): string {
  return dict.label('task.TaskType', type) || type
}

function tierHint(type: PreferenceTaskType): string | undefined {
  return PREFERENCE_TIER_HINTS[type]
}

// ---------------------------------------------------------------
// 数据加载：偏好详情 + 选择池（全量 + 逐档位 capabilityTag 过滤）
// ---------------------------------------------------------------

const loading = ref(false)
const saving = ref(false)
const detail = ref<PreferenceDetailVO | null>(null)
/** 默认渠道/模型选择池（全量 enabled，不带 capabilityTag） */
const defaultPool = ref<ModelOptionVO[]>([])
/** 逐档位过滤池（model-options AO capabilityTag=档位键） */
const tierPool = reactive<Record<PreferenceTaskType, ModelOptionVO[]>>({
  OUTLINE: [],
  FULL_GENERATE: [],
  FULL_ADJUST: [],
  TARGETED_ADJUST: [],
})

/** 组合值（channelCode::modelCode）；空串=未设置（回落默认/首次配置） */
const defaultCombo = ref('')
const tierCombo = reactive<Record<PreferenceTaskType, string>>({
  OUTLINE: '',
  FULL_GENERATE: '',
  FULL_ADJUST: '',
  TARGETED_ADJUST: '',
})

function comboOf(channelCode?: string, modelCode?: string): string {
  if (!channelCode || !modelCode) return ''
  return `${channelCode}${MODEL_VALUE_SEPARATOR}${modelCode}`
}

function tierOf(type: PreferenceTaskType): TierPreferenceVO | undefined {
  return detail.value?.preferenceMap?.[type]
}

async function loadPools(): Promise<void> {
  // 默认池 + 四档位池并行（capabilityTag eq 服务端过滤，api-channel §4.4）
  const tasks: Promise<void>[] = [
    executeAction<ModelOptionVO[]>('channel.modelOptions', {}).then((rows) => {
      defaultPool.value = rows ?? []
    }),
  ]
  for (const type of PREFERENCE_TASK_TYPES) {
    tasks.push(
      executeAction<ModelOptionVO[]>('channel.modelOptions', {
        capabilityTag: type,
      }).then((rows) => {
        tierPool[type] = rows ?? []
      }),
    )
  }
  await Promise.all(tasks)
}

async function loadDetail(): Promise<void> {
  detail.value = await executeAction<PreferenceDetailVO>(
    'channel.preferenceDetail',
    {},
  )
  applyDetailToForm()
}

/** detail → 表单（加载/重置共用） */
function applyDetailToForm(): void {
  const d = detail.value
  defaultCombo.value = comboOf(d?.defaultChannel?.code, d?.defaultModel?.code)
  for (const type of PREFERENCE_TASK_TYPES) {
    const tier = tierOf(type)
    tierCombo[type] = comboOf(tier?.channelCode, tier?.modelCode)
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadPools(), loadDetail()])
  } finally {
    loading.value = false
  }
})

// ---------------------------------------------------------------
// 可用性标注（§4：available=false 或存量组合不在 enabled 池 → 已下线）
// ---------------------------------------------------------------

function poolHas(pool: ModelOptionVO[], combo: string): boolean {
  return combo !== '' && pool.some((o) => o.value === combo)
}

const defaultUnavailable = computed(() => {
  if (!defaultCombo.value) return false
  if (detail.value?.defaultChannel?.available === false) return true
  return !poolHas(defaultPool.value, defaultCombo.value)
})

function tierUnavailable(type: PreferenceTaskType): boolean {
  const combo = tierCombo[type]
  if (!combo) return false
  if (tierOf(type)?.available === false) return true
  return !poolHas(tierPool[type], combo)
}

const unavailableTiers = computed<PreferenceTaskType[]>(() =>
  PREFERENCE_TASK_TYPES.filter((t) => tierUnavailable(t)),
)

// ---------------------------------------------------------------
// 选择池选项（a-select options；#option 插槽渲染 capabilityTags tag）
// ---------------------------------------------------------------

const defaultOptions = computed<ModelOptionVO[]>(() => defaultPool.value)

function tierOptions(type: PreferenceTaskType): ModelOptionVO[] {
  return tierPool[type]
}

// ---------------------------------------------------------------
// 保存 / 重置（§4 按钮）
// ---------------------------------------------------------------

async function onSave(): Promise<void> {
  // 不可用存量选择：强制改选（§4）
  if (defaultUnavailable.value || unavailableTiers.value.length > 0) {
    const names = [
      ...(defaultUnavailable.value ? ['默认渠道/模型'] : []),
      ...unavailableTiers.value.map(tierLabel),
    ].join('、')
    message.error(`已下线选择需先改选：${names}（红色标注项）`)
    return
  }
  // 必填校验：有可用渠道时默认必填（api-channel §4.1 default_channel_code ✅*）
  if (defaultPool.value.length > 0 && !defaultCombo.value) {
    message.warning('有可用渠道时必须设置默认渠道/模型')
    return
  }

  const def = splitModelValue(defaultCombo.value)
  if (defaultCombo.value && !def) {
    message.error('默认渠道/模型数据异常，请重新选择')
    return
  }

  const preferenceMap: Partial<PreferenceSaveAO['preferenceMap']> = {}
  for (const type of PREFERENCE_TASK_TYPES) {
    const combo = tierCombo[type]
    if (!combo) {
      preferenceMap[type] = null // 空值=清除档位回落默认（api-channel §4.4）
      continue
    }
    const parts = splitModelValue(combo)
    if (!parts) {
      message.error(`${tierLabel(type)} 档位数据异常，请重新选择`)
      return
    }
    preferenceMap[type] = { channelCode: parts.channelCode, modelCode: parts.modelCode }
  }

  saving.value = true
  try {
    await executeAction('channel.preferenceSave', {
      defaultChannelCode: def?.channelCode ?? '',
      defaultModelCode: def?.modelCode ?? '',
      preferenceMap: preferenceMap as PreferenceSaveAO['preferenceMap'],
    } satisfies PreferenceSaveAO)
    // §8：保存后任务路由即时生效，在途任务不受影响（文案说明）
    message.success('偏好已保存，新任务即时生效；进行中任务不受影响')
    await loadDetail()
  } finally {
    saving.value = false
  }
}

function onReset(): void {
  applyDetailToForm()
}
</script>

<template>
  <a-spin :spinning="loading">
    <!-- 默认渠道/模型 + 平台兜底（§4） -->
    <div class="dl-tab-section">
      <div class="dl-card-title">默认渠道 / 模型</div>

      <a-form class="dl-form" layout="vertical">
        <div class="pref-grid">
          <a-form-item label="默认渠道 / 模型（必填）">
            <a-select
              v-model:value="defaultCombo"
              :options="defaultOptions"
              :loading="loading"
              placeholder="请选择默认渠道 / 模型"
              show-search
              option-filter-prop="label"
              allow-clear
            >
              <template #option="{ label, capabilityTags }">
                <div class="pref-option">
                  <span>{{ label }}</span>
                  <span v-if="capabilityTags?.length" class="pref-option-tags">
                    <a-tag v-for="tag in capabilityTags" :key="tag" class="pref-option-tag">
                      {{ tag }}
                    </a-tag>
                  </span>
                </div>
              </template>
            </a-select>
          </a-form-item>

          <!-- 存量选择不可用：红色标注（§4） -->
          <div v-if="defaultUnavailable" class="pref-offline">
            <a-tag color="error">已下线，请改选</a-tag>
            <span class="pref-offline-text">
              {{ detail?.defaultChannel?.name }} / {{ detail?.defaultModel?.name }}
            </span>
          </div>
        </div>
      </a-form>

      <a-descriptions class="pref-fallback" :column="1" size="small" title="平台兜底渠道">
        <a-descriptions-item label="兜底渠道">
          <span v-if="detail?.fallbackChannel?.code">
            {{ detail.fallbackChannel.name }}（{{ detail.fallbackChannel.code }}）
          </span>
          <span v-else class="dl-empty-value">-</span>
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <!-- 分任务档位（§4：可空=回落默认） -->
    <div class="dl-tab-section">
      <div class="dl-card-title">按任务类型档位</div>
      <a-alert
        class="pref-tier-tip"
        type="info"
        show-icon
        message="未设置的档位回落默认渠道 / 模型；保存后新任务即时生效，进行中任务不受影响"
      />

      <div v-for="group in PREFERENCE_TIER_GROUPS" :key="group.key" class="pref-group">
        <div class="pref-group-title">{{ group.title }}</div>
        <div v-for="type in group.types" :key="type" class="pref-tier-row">
          <div class="pref-tier-label">
            <span>{{ tierLabel(type) }}</span>
            <a-tag v-if="tierHint(type)" color="blue">{{ tierHint(type) }}</a-tag>
            <a-tag v-if="tierUnavailable(type)" color="error">已下线，请改选</a-tag>
          </div>
          <a-select
            v-model:value="tierCombo[type]"
            class="pref-tier-select"
            :options="tierOptions(type)"
            :loading="loading"
            :placeholder="`未设置（回落默认）`"
            show-search
            option-filter-prop="label"
            allow-clear
          >
            <template #option="{ label, capabilityTags }">
              <div class="pref-option">
                <span>{{ label }}</span>
                <span v-if="capabilityTags?.length" class="pref-option-tags">
                  <a-tag v-for="tag in capabilityTags" :key="tag" class="pref-option-tag">
                    {{ tag }}
                  </a-tag>
                </span>
              </div>
            </template>
          </a-select>
          <span v-if="tierUnavailable(type)" class="pref-offline-text">
            {{ tierOf(type)?.channelName }} / {{ tierOf(type)?.modelName }}
          </span>
        </div>
      </div>

      <div class="pref-actions">
        <a-space>
          <a-button type="primary" :loading="saving" @click="onSave">保存</a-button>
          <a-button :disabled="saving" @click="onReset">重置</a-button>
        </a-space>
      </div>
    </div>
  </a-spin>
</template>

<style scoped>
.pref-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 0 16px;
  align-items: start;
}

.pref-offline {
  padding-top: 30px;
}

.pref-offline-text {
  color: var(--dl-danger-color);
  font-size: 13px;
}

.pref-fallback {
  margin-top: 4px;
}

.pref-tier-tip {
  margin-bottom: 12px;
}

.pref-group + .pref-group {
  margin-top: 12px;
}

.pref-group-title {
  font-weight: 600;
  color: var(--dl-text-secondary);
  margin-bottom: 8px;
}

.pref-tier-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}

.pref-tier-label {
  flex: none;
  width: 220px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pref-tier-select {
  flex: 1;
  max-width: 480px;
}

.pref-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--dl-border-light);
}

.pref-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pref-option-tags {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pref-option-tag {
  margin-inline-end: 0;
  font-size: 12px;
  line-height: 18px;
}
</style>
