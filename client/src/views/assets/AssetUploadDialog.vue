<script setup lang="ts">
/**
 * 素材上传弹窗（PageSpec assets.md §4.2 工具栏「上传」）。
 *
 * - a-upload 拖拽区 + 多选；自定义请求经引擎 postForm（multipart）发送
 *   FormData（file / assetName 默认文件名 / category 弹窗级共享），
 *   URL 取自 action 注册表 asset.assetUpload（不复制路径字面量）；
 * - INV-19 前置校验：类型 jpg/png/svg/webp、单文件 ≤10MB（beforeUpload
 *   拦截并 LIST_IGNORE 不入列表）；
 * - INV-20 hash 重复：上传响应 duplicated=true 时提示已复用现有素材
 *   （后端不重复存储，不新建记录，前端为告知性提示）；
 * - 引擎层无 Dialog 组件（DlDialog 未落地），按 deck-loop hybrid code
 *   先例以 a-modal 实现（VersionCompareDrawer 同例）。
 */
import { computed, ref, watch } from 'vue'
import { Upload, message } from 'ant-design-vue'
import type { UploadRequestOption } from 'ant-design-vue/es/vc-upload/interface'
import { InboxOutlined } from '@ant-design/icons-vue'

import { postForm } from '@/engine'

import {
  ASSET_UPLOAD_ACCEPT,
  CATEGORY_MAX,
  assetUploadPath,
  validateUploadFile,
  type AssetUploadVO,
} from './assets.shared'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** 全部文件处理完成（父级刷新列表） */
  (e: 'success'): void
}>()

const category = ref('')
const uploadingCount = ref(0)

const uploadTip = computed(
  () => `单击或拖拽文件到此区域上传（支持多选，jpg / png / svg / webp，单文件 ≤10MB）`,
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      category.value = ''
    }
  },
)

/** a-upload 自定义请求（antdv 官方参数类型，文件体收窄在 asFile 内部处理） */
type CustomRequestOptions = UploadRequestOption

function asFile(raw: UploadRequestOption['file']): File | null {
  if (raw instanceof File) return raw
  const inner = (raw as { raw?: unknown })?.raw
  return inner instanceof File ? inner : null
}

function beforeUpload(file: File): boolean | typeof Upload.LIST_IGNORE {
  const err = validateUploadFile(file)
  if (err) {
    message.error(err)
    return Upload.LIST_IGNORE
  }
  return true
}

async function customRequest(options: CustomRequestOptions): Promise<void> {
  const file = asFile(options.file)
  if (!file) {
    options.onError?.(new Error('无法读取文件'))
    return
  }
  const form = new FormData()
  form.append('file', file)
  // assetName 缺省即文件名（api-assets.md §4.4 upload AO）
  form.append('assetName', file.name)
  if (category.value.trim() !== '') {
    form.append('category', category.value.trim())
  }
  uploadingCount.value += 1
  try {
    const vo = await postForm<AssetUploadVO>(assetUploadPath(), form)
    if (vo?.duplicated) {
      // INV-20：hash 命中返回 existingAssetId，不新建——「是否复用」为告知性提示
      message.warning(`已存在相同文件（内容一致），已复用现有素材：${file.name}`)
    } else {
      message.success(`上传成功：${file.name}`)
    }
    options.onSuccess?.(vo)
  } catch (err) {
    // request 层已 toast 错误信息；这里仅把该文件标记失败
    options.onError?.(err instanceof Error ? err : new Error('上传失败'))
  } finally {
    uploadingCount.value -= 1
    if (uploadingCount.value === 0) {
      emit('success')
    }
  }
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <a-modal
    :open="open"
    title="上传素材"
    :mask-closable="false"
    :destroy-on-close="true"
    :footer="null"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <a-form layout="vertical">
      <a-form-item label="素材分类（可选，本批共用）">
        <a-input
          v-model:value="category"
          :maxlength="CATEGORY_MAX"
          placeholder="如：品牌图 / 产品截图 / 图标"
          allow-clear
        />
      </a-form-item>
      <a-form-item label="文件">
        <a-upload-dragger
          :multiple="true"
          :accept="ASSET_UPLOAD_ACCEPT"
          :before-upload="beforeUpload"
          :custom-request="customRequest"
        >
          <p class="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p class="ant-upload-text">单击或拖拽文件到此区域上传</p>
          <p class="ant-upload-hint">{{ uploadTip }}</p>
        </a-upload-dragger>
      </a-form-item>
      <div class="asset-upload-foot">
        <a-button :loading="uploadingCount > 0" @click="close">
          {{ uploadingCount > 0 ? '后台继续上传…' : '完成' }}
        </a-button>
      </div>
    </a-form>
  </a-modal>
</template>

<style scoped>
.asset-upload-foot {
  display: flex;
  justify-content: flex-end;
}
</style>
