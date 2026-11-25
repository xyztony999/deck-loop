<script setup lang="ts">
/**
 * 话术模板编辑弹窗（PageSpec assets.md §6 表单 Dialog；POST
 * /asset/prompt/save，templateId 空 = 新建）。
 *
 * - title ✅ ≤50 · content ✅ textarea ≤2000 · category ≤64 ·
 *   templateScene ✅ radio（字典 asset.TemplateScene，禁止硬编码选项）；
 * - INV-21 占位符 {名称} 语法（≤10 处）：实时校验 + 未闭合高亮预览
 *   （splitPromptSegments 分段着色；服务端 BIZ_PROMPT_PLACEHOLDER_SYNTAX
 *   为最终守卫，前端提示为前置校验）；
 * - 引擎层无 Dialog 组件（hybrid code 先例，a-modal 实现）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'

import { executeAction, useDict } from '@/engine'

import {
  ASSET_DICT_SCENE,
  CATEGORY_MAX,
  PROMPT_CONTENT_MAX,
  PROMPT_TITLE_MAX,
  promptPlaceholders,
  splitPromptSegments,
  validatePromptContent,
  type PromptRow,
} from './assets.shared'

const props = defineProps<{
  open: boolean
  /** 编辑目标行（null = 新建） */
  row: PromptRow | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'success'): void
}>()

const submitting = ref(false)

const form = reactive({
  templateId: '' as string | null,
  title: '',
  content: '',
  category: '',
  templateScene: '',
})

// 字典选项（asset 域缓存命中，不重复请求）
const dict = useDict('asset', [ASSET_DICT_SCENE])
const sceneOptions = computed(() =>
  dict.options(ASSET_DICT_SCENE).map(({ value, label }) => ({ value, label })),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    if (props.row) {
      form.templateId = props.row.templateId
      form.title = props.row.title ?? ''
      form.content = props.row.content ?? ''
      form.category = props.row.category ?? ''
      form.templateScene = props.row.templateScene ?? ''
    } else {
      form.templateId = null
      form.title = ''
      form.content = ''
      form.category = ''
      form.templateScene = ''
    }
  },
)

/** 占位符实时校验（null = 通过） */
const contentError = computed(() => validatePromptContent(form.content))

/** 高亮分段预览 */
const segments = computed(() => splitPromptSegments(form.content))

/** 已闭合占位符清单（提示可用变量） */
const placeholders = computed(() => promptPlaceholders(form.content))

async function onOk(): Promise<void> {
  if (form.title.trim() === '') {
    message.warning(`请输入话术标题（≤${PROMPT_TITLE_MAX} 字）`)
    return
  }
  if (form.title.trim().length > PROMPT_TITLE_MAX) {
    message.warning(`话术标题不能超过 ${PROMPT_TITLE_MAX} 字`)
    return
  }
  if (form.content.trim() === '') {
    message.warning(`请输入话术内容（≤${PROMPT_CONTENT_MAX} 字）`)
    return
  }
  if (contentError.value != null) {
    message.warning(contentError.value)
    return
  }
  if (form.templateScene === '') {
    message.warning('请选择适用场景')
    return
  }
  submitting.value = true
  try {
    await executeAction('asset.promptSave', {
      templateId: form.templateId ?? undefined,
      title: form.title.trim(),
      content: form.content,
      category: form.category.trim(),
      templateScene: form.templateScene,
    })
    message.success(form.templateId ? '话术已保存' : '话术已创建')
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
    :title="row ? '编辑话术模板' : '新建话术模板'"
    :mask-closable="false"
    :destroy-on-close="true"
    :confirm-loading="submitting"
    :width="640"
    ok-text="保存"
    cancel-text="取消"
    @update:open="(v: boolean) => emit('update:open', v)"
    @ok="onOk"
  >
    <a-form layout="vertical">
      <a-form-item label="话术标题" required>
        <a-input
          v-model:value="form.title"
          :maxlength="PROMPT_TITLE_MAX"
          placeholder="如：开场引入 / 数据强调 / 结尾行动号召"
          allow-clear
        />
      </a-form-item>

      <a-form-item required>
        <template #label>
          话术内容
          <span class="prompt-content-tip">
            （支持 {占位符}，最多 10 处，保存时保留原样供指令替换）
          </span>
        </template>
        <a-textarea
          v-model:value="form.content"
          :rows="6"
          :maxlength="PROMPT_CONTENT_MAX"
          placeholder="请输入话术内容，可用 {名称} 形式插入占位符，如：本页重点介绍{产品名}的核心优势。"
        />
        <!-- 占位符语法实时校验（INV-21 前置提示） -->
        <div v-if="contentError" class="prompt-error">{{ contentError }}</div>
        <div v-else-if="placeholders.length > 0" class="prompt-vars">
          占位符（{{ placeholders.length }} 处）：
          <a-tag v-for="name in placeholders" :key="name" color="blue">
            {{ name }}
          </a-tag>
        </div>
      </a-form-item>

      <!-- 高亮预览：closed 蓝 / 未闭合与孤立红（PageSpec §6 实时高亮未闭合） -->
      <a-form-item v-if="form.content !== ''" label="内容预览">
        <div class="prompt-preview">
          <template v-for="(seg, i) in segments" :key="i">
            <span
              v-if="seg.kind === 'closed'"
              class="prompt-seg prompt-seg--closed"
            >{{ seg.text }}</span>
            <span
              v-else-if="seg.kind === 'open' || seg.kind === 'stray'"
              class="prompt-seg prompt-seg--broken"
            >{{ seg.text }}</span>
            <span v-else>{{ seg.text }}</span>
          </template>
        </div>
      </a-form-item>

      <div class="prompt-grid-2">
        <a-form-item label="分类">
          <a-input
            v-model:value="form.category"
            :maxlength="CATEGORY_MAX"
            placeholder="如：开场 / 数据 / 收尾"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="适用场景" required>
          <a-radio-group
            v-model:value="form.templateScene"
            :options="sceneOptions"
          />
        </a-form-item>
      </div>
    </a-form>
  </a-modal>
</template>

<style scoped>
.prompt-content-tip {
  color: var(--dl-text-secondary);
  font-weight: 400;
  font-size: 12px;
}

.prompt-error {
  margin-top: 4px;
  color: var(--dl-danger-color);
  font-size: 12px;
}

.prompt-vars {
  margin-top: 4px;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.prompt-preview {
  padding: 8px 12px;
  background: var(--dl-bg-page);
  border: 1px solid var(--dl-border-light);
  border-radius: 4px;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.8;
  word-break: break-all;
}

.prompt-seg {
  border-radius: 4px;
  padding: 0 2px;
}

.prompt-seg--closed {
  color: var(--dl-primary);
  background: rgba(107, 138, 181, 0.15);
}

.prompt-seg--broken {
  color: var(--dl-danger-color);
  background: rgba(255, 77, 79, 0.12);
}

.prompt-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
</style>
