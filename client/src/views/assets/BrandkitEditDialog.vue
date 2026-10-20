<script setup lang="ts">
/**
 * 品牌规范编辑弹窗（PageSpec assets.md §5 表单 Dialog：<5 字段组；
 * POST /asset/brandkit/save，brandKitId 空 = 新建）。
 *
 * - kitName ✅ ≤50；colors{primary ✅（色板选择）/assistants ≤5}；
 *   fonts{title/body}（预置字体下拉——api-assets.md §1.2 字体为预置清单，
 *   非后端字典）；logoAssetId（LogoSelectModal 选择池，限 LOGO 启用态，
 *   INV-16 启用态校验兜底在服务端）；
 * - antdv 4.2.6 无 ColorPicker 组件：色板选择用原生 input[type=color]
 *   + 十六进制文本双通道（hybrid code 区，ValueObject 仍为 {primary,
 *   assistants[]}）；
 * - 引擎层无 Dialog 组件（hybrid code 先例，a-modal 实现）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons-vue'

import { executeAction } from '@/engine'

import LogoSelectModal, { type LogoOption } from './LogoSelectModal.vue'
import {
  BRANDKIT_ASSISTANT_MAX,
  KIT_NAME_MAX,
  PRESET_FONTS,
  colorsOf,
  fontsOf,
  type BrandKitRow,
} from './assets.shared'

const props = defineProps<{
  open: boolean
  /** 编辑目标行（null = 新建） */
  row: BrandKitRow | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'success'): void
}>()

const submitting = ref(false)
const logoSelectOpen = ref(false)

const form = reactive({
  brandKitId: '' as string | null,
  kitName: '',
  primary: '#1677ff',
  assistants: [] as string[],
  fontTitle: '' as string | undefined,
  fontBody: '' as string | undefined,
  logoAssetId: '' as string | null,
  logoAssetName: '' as string | null,
})

const fontOptions = PRESET_FONTS.map((f) => ({ value: f, label: f }))

/** 全部色板（主色+辅色）预览序列 */
const swatches = computed(() => [form.primary, ...form.assistants])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    if (props.row) {
      const colors = colorsOf(props.row)
      const fonts = fontsOf(props.row)
      form.brandKitId = props.row.brandKitId
      form.kitName = props.row.kitName ?? ''
      form.primary = colors.primary
      form.assistants = [...colors.assistants]
      form.fontTitle = fonts.title ?? undefined
      form.fontBody = fonts.body ?? undefined
      form.logoAssetId = props.row.logoAssetId
      form.logoAssetName = props.row.logoAssetName ?? null
    } else {
      form.brandKitId = null
      form.kitName = ''
      form.primary = '#1677ff'
      form.assistants = []
      form.fontTitle = undefined
      form.fontBody = undefined
      form.logoAssetId = null
      form.logoAssetName = null
    }
  },
)

function addAssistant(): void {
  if (form.assistants.length >= BRANDKIT_ASSISTANT_MAX) {
    message.warning(`辅色最多 ${BRANDKIT_ASSISTANT_MAX} 个`)
    return
  }
  form.assistants.push('#52c41a')
}

function removeAssistant(index: number): void {
  form.assistants.splice(index, 1)
}

function onLogoSelect(option: LogoOption | null): void {
  form.logoAssetId = option?.assetId ?? null
  form.logoAssetName = option?.assetName ?? null
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

function validPrimary(v: string): boolean {
  return HEX_RE.test(v)
}

async function onOk(): Promise<void> {
  if (form.kitName.trim() === '') {
    message.warning(`请输入规范名称（≤${KIT_NAME_MAX} 字）`)
    return
  }
  if (form.kitName.trim().length > KIT_NAME_MAX) {
    message.warning(`规范名称不能超过 ${KIT_NAME_MAX} 字`)
    return
  }
  if (!validPrimary(form.primary)) {
    message.warning('主色须为 #RRGGBB 格式的十六进制色值')
    return
  }
  if (form.assistants.some((c) => !validPrimary(c))) {
    message.warning('辅色存在非法色值（须为 #RRGGBB）')
    return
  }
  submitting.value = true
  try {
    await executeAction('asset.brandkitSave', {
      brandKitId: form.brandKitId ?? undefined,
      kitName: form.kitName.trim(),
      colors: { primary: form.primary, assistants: form.assistants },
      fonts: {
        title: form.fontTitle ?? null,
        body: form.fontBody ?? null,
      },
      logoAssetId: form.logoAssetId ?? undefined,
    })
    message.success(form.brandKitId ? '规范已保存' : '规范已创建')
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
    :title="row ? '编辑品牌规范' : '新建品牌规范'"
    :mask-closable="false"
    :destroy-on-close="true"
    :confirm-loading="submitting"
    :width="620"
    ok-text="保存"
    cancel-text="取消"
    @update:open="(v: boolean) => emit('update:open', v)"
    @ok="onOk"
  >
    <a-form layout="vertical">
      <a-form-item label="规范名称" required>
        <a-input
          v-model:value="form.kitName"
          :maxlength="KIT_NAME_MAX"
          placeholder="如：2026 秋季发布会"
          allow-clear
        />
      </a-form-item>

      <!-- 色板：主色（必填）+ 辅色（≤5）；原生 color 输入 + 十六进制双通道 -->
      <a-form-item label="主色" required>
        <div class="brandkit-color-row">
          <input
            class="brandkit-color-native"
            type="color"
            :value="form.primary"
            @input="(e: Event) => (form.primary = (e.target as HTMLInputElement).value)"
          />
          <a-input
            v-model:value="form.primary"
            class="brandkit-color-hex"
            placeholder="#RRGGBB"
            :maxlength="7"
          />
        </div>
      </a-form-item>

      <a-form-item label="辅色（可选，最多 5 个）">
        <div
          v-for="(color, i) in form.assistants"
          :key="i"
          class="brandkit-color-row brandkit-color-row--stack"
        >
          <input
            class="brandkit-color-native"
            type="color"
            :value="color"
            @input="(e: Event) => (form.assistants[i] = (e.target as HTMLInputElement).value)"
          />
          <a-input
            v-model:value="form.assistants[i]"
            class="brandkit-color-hex"
            placeholder="#RRGGBB"
            :maxlength="7"
          />
          <a-button
            type="text"
            danger
            size="small"
            @click="removeAssistant(i)"
          >
            <DeleteOutlined />
          </a-button>
        </div>
        <a-button
          size="small"
          type="dashed"
          :disabled="form.assistants.length >= BRANDKIT_ASSISTANT_MAX"
          @click="addAssistant"
        >
          <PlusOutlined />
          添加辅色
        </a-button>
      </a-form-item>

      <a-form-item label="色板预览">
        <div class="brandkit-swatches">
          <span
            v-for="(color, i) in swatches"
            :key="`${color}-${i}`"
            class="brandkit-swatch"
            :style="{ background: color }"
            :title="color"
          />
        </div>
      </a-form-item>

      <div class="brandkit-grid-2">
        <a-form-item label="标题字体（预置清单）">
          <a-select
            v-model:value="form.fontTitle"
            :options="fontOptions"
            placeholder="请选择标题字体"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="正文字体（预置清单）">
          <a-select
            v-model:value="form.fontBody"
            :options="fontOptions"
            placeholder="请选择正文字体"
            allow-clear
          />
        </a-form-item>
      </div>

      <a-form-item label="Logo 素材（可选，启用态 LOGO 素材）">
        <div class="brandkit-color-row">
          <a-input
            :value="form.logoAssetName ?? form.logoAssetId ?? ''"
            placeholder="未选择"
            readonly
          />
          <a-button size="small" @click="logoSelectOpen = true">选择</a-button>
          <a-button
            v-if="form.logoAssetId"
            size="small"
            danger
            type="text"
            @click="onLogoSelect(null)"
          >
            <DeleteOutlined />
          </a-button>
        </div>
      </a-form-item>
    </a-form>

    <LogoSelectModal
      v-model:open="logoSelectOpen"
      @select="onLogoSelect"
    />
  </a-modal>
</template>

<style scoped>
.brandkit-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.brandkit-color-row--stack {
  margin-bottom: 8px;
}

.brandkit-color-native {
  width: 44px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--dl-border-light);
  border-radius: 6px;
  background: var(--dl-card-bg);
  cursor: pointer;
  flex: none;
}

.brandkit-color-hex {
  width: 140px;
  flex: none;
  font-family: monospace;
}

.brandkit-swatches {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brandkit-swatch {
  display: inline-block;
  width: 32px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.brandkit-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
</style>
