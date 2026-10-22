<script setup lang="ts">
/**
 * 新建/编辑创作物向导（/deck/new；?deckId= 为编辑态。PageSpec deck.md §5）。
 *
 * - DlCardPage steps 三步：基本信息 → 品牌规范（可跳过）→ 创建
 * - 提交 deck.deckSave；新建成功 → 跳转生成向导 /deck/:deckId/generate
 *   （§5 ③「保存→跳转生成向导 generation」，路由见 generation.md §6）；
 *   编辑成功 → 跳转创作物详情
 * - 取消带 dirty 检测（§5 按钮「取消（dirty 检测）」）：仅跟踪用户可编辑
 *   字段，呈现层派生字段（deckTypeName/defaultBrandKitName）不参与
 * - deckType：字典 radio，DECK 可选、DOC/POSTER 置灰「即将支持」
 *   （§5；选项仍全部来自后端字典，置灰为发布期能力限制）
 * - 品牌规范：asset.select.brandkitList 选择池（内联 ActionDef，见
 *   api/actions/deck.ts 说明），选择池数据量小的个人产品场景用
 *   select+showSearch 承载（05-ui-ux §5.11）
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal, message } from 'ant-design-vue'

import { DlCardPage, executeAction, useDict } from '@/engine'
import type { SelectOption } from '@/engine'
import { brandkitSelectAction } from '@/api/actions/deck'

import { deckWizardConfig } from './DeckWizard.config'
import {
  DECK_DICT_TYPE,
  DECK_TYPE_DECK,
  registerDeckDictColors,
} from './deck.shared'

registerDeckDictColors()

const route = useRoute()
const router = useRouter()

const wizardRef = ref<InstanceType<typeof DlCardPage> | null>(null)

const editDeckId = computed<string | undefined>(() => {
  const v = route.query.deckId
  return typeof v === 'string' && v ? v : undefined
})
const isEdit = computed(() => editDeckId.value != null)

const config = computed(() => ({
  ...deckWizardConfig,
  title: isEdit.value ? '编辑创作物' : '新建创作物',
}))

/** 类型字典（radio 选项 + 确认步反查 label；与引擎同 key 命中缓存） */
const deckTypeDict = useDict('deck', [DECK_DICT_TYPE])

// ---------------------------------------------------------------
// 品牌规范选择池（asset.select.brandkitList；失败不阻断向导——该步可跳过）
// ---------------------------------------------------------------

const brandkitOptions = ref<SelectOption[]>([])

onMounted(async () => {
  try {
    const options = await executeAction<SelectOption[]>(brandkitSelectAction)
    brandkitOptions.value = options ?? []
  } catch {
    brandkitOptions.value = []
  }
})

// ---------------------------------------------------------------
// 新建默认值（首期仅 DECK，api-deck SaveAO）+ dirty 检测
// ---------------------------------------------------------------

const dirty = ref(false)
let dirtyArmed = false

onMounted(() => {
  if (!isEdit.value) {
    const fd = wizardRef.value?.formData
    if (fd && fd.deckType == null) fd.deckType = DECK_TYPE_DECK
  }
})

watch(
  () => ({
    deckId: wizardRef.value?.formData?.deckId,
    deckName: wizardRef.value?.formData?.deckName,
    deckType: wizardRef.value?.formData?.deckType,
    topic: wizardRef.value?.formData?.topic,
    requirement: wizardRef.value?.formData?.requirement,
    brandKitId: wizardRef.value?.formData?.defaultBrandKitId,
  }),
  (v) => {
    if (!dirtyArmed) {
      // 回填/默认值不计为 dirty：编辑态等详情回填（deckId 出现），
      // 新建态等默认类型写入（deckType 出现）后开始跟踪
      const ready = isEdit.value ? v.deckId != null : v.deckType != null
      if (!ready) return
      dirtyArmed = true
      return
    }
    dirty.value = true
  },
)

// ---------------------------------------------------------------
// 确认步派生展示字段（deckTypeName / defaultBrandKitName）
// ---------------------------------------------------------------

watch(
  () => ({
    deckType: wizardRef.value?.formData?.deckType,
    brandKitId: wizardRef.value?.formData?.defaultBrandKitId,
    dictReady: deckTypeDict.ready.value,
    options: brandkitOptions.value,
  }),
  ({ deckType, brandKitId }) => {
    const fd = wizardRef.value?.formData
    if (!fd) return
    fd.deckTypeName = deckType
      ? deckTypeDict.label(DECK_DICT_TYPE, String(deckType))
      : undefined
    fd.defaultBrandKitName =
      brandKitId == null || brandKitId === ''
        ? undefined
        : brandkitOptions.value.find((o) => o.value === String(brandKitId))?.label
  },
  { immediate: true },
)

// ---------------------------------------------------------------
// 提交 / 取消
// ---------------------------------------------------------------

function onSaveSuccess(data: unknown): void {
  const deckId = (data as { deckId?: string } | null | undefined)?.deckId
  if (!isEdit.value && deckId) {
    // deck.md §5 ③：保存 → 跳转生成向导（generation.md §6 路由）
    message.success('创作物已创建，正在进入生成向导')
    void router.push(`/deck/${deckId}/generate`)
    return
  }
  message.success('保存成功')
  void router.push(deckId ? `/deck/${deckId}` : '/deck')
}

function onCancel(): void {
  if (dirty.value) {
    Modal.confirm({
      title: '取消并离开？',
      content: '当前未保存的修改将丢失。',
      okText: '丢弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      maskClosable: false,
      onOk: () => router.push('/deck'),
    })
    return
  }
  void router.push('/deck')
}
</script>

<template>
  <!-- 07 v2.0：引擎即页面根（单表面）；deck.md §5 无「暂存」——引擎仅在
       config 声明 saveDraftAction 时渲染暂存按钮，本向导未声明，天然无暂存 -->
  <DlCardPage
    ref="wizardRef"
    :config="config"
    :detail-id="editDeckId"
    @success="onSaveSuccess"
    @cancel="onCancel"
  >
    <!-- deckType：字典 radio；DOC/POSTER 置灰「即将支持」（deck.md §5） -->
    <template #field-deckType="{ formData }">
      <a-radio-group
        :value="(formData.deckType as string | undefined)"
        @update:value="(v: unknown) => (formData.deckType = v)"
      >
        <a-radio
          v-for="opt in deckTypeDict.options(DECK_DICT_TYPE)"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.value !== DECK_TYPE_DECK"
        >
          {{ opt.label }}{{ opt.value === DECK_TYPE_DECK ? '' : '（即将支持）' }}
        </a-radio>
      </a-radio-group>
    </template>

    <!-- 品牌规范：asset.select.brandkitList 选择池（可跳过） -->
    <template #field-defaultBrandKitId="{ formData }">
      <a-select
        :value="(formData.defaultBrandKitId as string | undefined)"
        :options="brandkitOptions"
        placeholder="请选择品牌规范（可跳过）"
        show-search
        option-filter-prop="label"
        allow-clear
        @update:value="(v: unknown) => (formData.defaultBrandKitId = v)"
      />
    </template>
  </DlCardPage>
</template>
