<script setup lang="ts">
/**
 * 新建导出弹层（PageSpec delivery.md §4.2 工具栏「新建导出」）。
 *
 * - 引擎层无弹窗组件（DlDialog 未落地），按 adjust VersionCompareDrawer
 *   先例以 Teleport 自定义覆盖层实现（§5.8 悬浮锚点同先例）；
 * - 表单：deckId（deck.select.deckList 选择池，限 FINALIZED）+
 *   exportFormat radio（deliver.ExportFormat 字典，禁止硬编码 options）；
 *   PPTX 选项带 beta 标注，选中即展示 beta 提示条；
 * - 提交走 deliver.exportSubmit：PPTX 首次响应 needConfirm=true 时由
 *   submitExportTask 统一弹 beta 二次确认并携 confirm=true 重提；
 * - ?deckId= 入口预选：presetDeckId/presetDeckName 由父页传入。
 */
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CloseOutlined } from '@ant-design/icons-vue'

import { useDict } from '@/engine'
import { DECK_STATUS } from '@/views/deck/deck.shared'

import DeckSelectField from './DeckSelectField.vue'
import {
  DELIVER_DICT_FORMAT,
  EXPORT_FORMAT,
  submitExportTask,
} from '../deliver.shared'

const props = defineProps<{
  open: boolean
  /** 入口预选（?deckId=）：deckId 与已解析名称 */
  presetDeckId?: string
  presetDeckName?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'success'): void
}>()

// 字典（与列表页同 key，命中缓存不重复请求）
const dict = useDict('deliver', [DELIVER_DICT_FORMAT])

const formatOptions = computed(() => dict.options(DELIVER_DICT_FORMAT))

const form = reactive({
  deckId: '',
  deckName: '',
  exportFormat: '',
})
const submitting = ref(false)

const isPptx = computed(() => form.exportFormat === EXPORT_FORMAT.PPTX)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    form.deckId = props.presetDeckId ?? ''
    form.deckName = props.presetDeckName ?? ''
    form.exportFormat = ''
    submitting.value = false
  },
)

function close(): void {
  if (submitting.value) return
  emit('update:open', false)
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return
  if (!form.deckId) {
    message.warning('请选择定稿创作物')
    return
  }
  if (!form.exportFormat) {
    message.warning('请选择导出格式')
    return
  }
  submitting.value = true
  try {
    const accepted = await submitExportTask(form.deckId, form.exportFormat)
    if (accepted) {
      message.success('导出任务已提交，完成后可下载')
      emit('success')
      emit('update:open', false)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dl-dialog-overlay">
      <div class="dl-dialog" role="dialog" aria-modal="true">
        <div class="dl-dialog-head">
          <span class="dl-dialog-title">新建导出</span>
          <a-button type="text" size="small" :disabled="submitting" @click="close">
            <CloseOutlined />
          </a-button>
        </div>

        <div class="dl-dialog-body">
          <a-form class="dl-form" layout="vertical">
            <a-form-item label="定稿创作物" required>
              <DeckSelectField
                v-model="form.deckId"
                :initial-label="form.deckName || presetDeckName"
                :extra-params="{ deckStatus: DECK_STATUS.FINALIZED }"
                placeholder="搜索选择定稿创作物"
                @update:label="form.deckName = $event"
              />
              <div class="dl-dialog-tip">仅已定稿（FINALIZED）的创作物可发起导出</div>
            </a-form-item>

            <a-form-item label="导出格式" required>
              <a-radio-group v-model:value="form.exportFormat">
                <a-radio
                  v-for="opt in formatOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                  <a-tag
                    v-if="opt.value === EXPORT_FORMAT.PPTX"
                    color="orange"
                    class="dl-dialog-beta-tag"
                  >
                    beta
                  </a-tag>
                </a-radio>
              </a-radio-group>
            </a-form-item>

            <!-- PPTX beta 提示（§4.2 PPTX beta 确认；提交后仍按 needConfirm 回执二次确认） -->
            <a-alert
              v-if="isPptx"
              type="warning"
              show-icon
              message="PPTX 导出为 beta 能力"
              description="处于 beta 阶段，版式与动画还原可能存在偏差；提交后将再次请求确认。"
            />
          </a-form>
        </div>

        <div class="dl-dialog-foot">
          <a-button :disabled="submitting" @click="close">取消</a-button>
          <a-button type="primary" :loading="submitting" @click="onSubmit">
            开始导出
          </a-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dl-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 96px 16px;
}

/* 简单表单弹层：520px（§5.11 简单表单），字段 ≤3 单列 */
.dl-dialog {
  width: 520px;
  background: var(--dl-card-bg);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dl-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px;
  border-bottom: 1px solid var(--dl-title-border);
}

.dl-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dl-title-color);
}

.dl-dialog-body {
  padding: 16px;
}

.dl-dialog-tip {
  margin-top: 4px;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.dl-dialog-beta-tag {
  margin-left: 4px;
  transform: translateY(-1px);
}

.dl-dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--dl-border-light);
}
</style>
