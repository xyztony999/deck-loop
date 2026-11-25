<script setup lang="ts">
/**
 * 素材元信息编辑弹窗（PageSpec assets.md §4.4 operList edit：
 * 重命名 / 改分类；POST /asset/asset/save）。
 *
 * 引擎层无 Dialog 组件（hybrid code 先例，a-modal 实现）。
 */
import { reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { Rule } from 'ant-design-vue/es/form'

import { executeAction } from '@/engine'

import {
  ASSET_NAME_MAX,
  CATEGORY_MAX,
  type AssetListRow,
} from './assets.shared'

const props = defineProps<{
  open: boolean
  /** 编辑目标行（null = 不应打开） */
  row: AssetListRow | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'success'): void
}>()

const formRef = ref()
const submitting = ref(false)
const form = reactive({ assetName: '', category: '' })

const rules: Record<string, Rule[]> = {
  assetName: [
    { required: true, message: `请输入素材名称（≤${ASSET_NAME_MAX} 字）` },
    { max: ASSET_NAME_MAX, message: `素材名称不能超过 ${ASSET_NAME_MAX} 字` },
  ],
  category: [{ max: CATEGORY_MAX, message: `分类不能超过 ${CATEGORY_MAX} 字` }],
}

watch(
  () => props.open,
  (open) => {
    if (open && props.row) {
      form.assetName = props.row.assetName ?? ''
      form.category = props.row.category ?? ''
    }
  },
)

async function onOk(): Promise<void> {
  if (!props.row) return
  await formRef.value?.validate()
  submitting.value = true
  try {
    await executeAction('asset.assetSave', {
      assetId: props.row.assetId,
      assetName: form.assetName.trim(),
      category: form.category.trim(),
    })
    message.success('素材已保存')
    emit('success')
    emit('update:open', false)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="编辑素材"
    :mask-closable="false"
    :destroy-on-close="true"
    :confirm-loading="submitting"
    ok-text="保存"
    cancel-text="取消"
    @update:open="(v: boolean) => emit('update:open', v)"
    @ok="onOk"
  >
    <a-form ref="formRef" layout="vertical" :model="form" :rules="rules">
      <a-form-item label="素材名称" name="assetName">
        <a-input
          v-model:value="form.assetName"
          :maxlength="ASSET_NAME_MAX"
          placeholder="请输入素材名称"
          allow-clear
        />
      </a-form-item>
      <a-form-item label="分类" name="category">
        <a-input
          v-model:value="form.category"
          :maxlength="CATEGORY_MAX"
          placeholder="如：品牌图 / 产品截图 / 图标"
          allow-clear
        />
      </a-form-item>
    </a-form>
  </a-modal>
</template>
