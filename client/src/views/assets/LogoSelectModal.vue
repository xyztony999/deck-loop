<script setup lang="ts">
/**
 * Logo 素材选择弹窗（PageSpec assets.md §5 logoAssetId modalSelect：
 * asset.select.assetList 限 LOGO 类型启用态）。
 *
 * - 数据源：选择池 POST /asset/select/asset-list（action asset.selectAssetList，
 *   AO keyword + assetType=LOGO——启用态过滤由服务侧承担）；
 * - §5.11 选择器规范：数据量不可预估用查询列表弹窗（搜索 + 单选），
 *   SelectOption+扩展响应归一（value/label + assetId/assetName）。
 */
import { ref, watch } from 'vue'

import { executeAction } from '@/engine'

import { ASSET_TYPE } from './assets.shared'

/** 归一后的选择池选项 */
export interface LogoOption {
  assetId: string
  assetName: string
  thumbnailUrl: string | null
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** 确认选择（null = 清除） */
  (e: 'select', option: LogoOption | null): void
}>()

const keyword = ref('')
const loading = ref(false)
const options = ref<LogoOption[]>([])
const chosenId = ref<string | undefined>()
let searchTimer: number | undefined

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/** 选择池响应归一（SelectOption+扩展 / PageResult 两形态兼容） */
function normalize(raw: unknown): LogoOption[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { records?: unknown[] } | null)?.records)
      ? ((raw as { records?: unknown[] }).records as unknown[])
      : []
  const result: LogoOption[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const assetId = firstString(it.assetId, it.value)
    if (!assetId) continue
    result.push({
      assetId,
      assetName: firstString(it.assetName, it.label, assetId) as string,
      thumbnailUrl: firstString(it.thumbnailUrl, it.url) ?? null,
    })
  }
  return result
}

async function load(kw = ''): Promise<void> {
  loading.value = true
  try {
    const data = await executeAction<unknown>('asset.selectAssetList', {
      keyword: kw,
      assetType: ASSET_TYPE.LOGO,
    })
    options.value = normalize(data)
  } finally {
    loading.value = false
  }
}

function onSearch(v: string): void {
  if (searchTimer != null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void load(v.trim())
  }, 300)
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      keyword.value = ''
      chosenId.value = undefined
      void load()
    }
  },
)

function confirm(): void {
  const chosen = options.value.find((o) => o.assetId === chosenId.value)
  emit('select', chosen ?? null)
  emit('update:open', false)
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <a-modal
    :open="open"
    title="选择 Logo 素材（启用态）"
    :mask-closable="false"
    :destroy-on-close="true"
    ok-text="确定"
    cancel-text="取消"
    :ok-button-props="{ disabled: chosenId == null }"
    @update:open="(v: boolean) => emit('update:open', v)"
    @ok="confirm"
    @cancel="close"
  >
    <a-input-search
      v-model:value="keyword"
      placeholder="搜索素材名称"
      allow-clear
      :loading="loading"
      @search="() => load(keyword.trim())"
      @update:value="(v: string) => onSearch(v)"
    />
    <a-spin :spinning="loading" class="logo-select-body">
      <a-radio-group v-model:value="chosenId" class="logo-select-group">
        <div v-if="options.length === 0" class="logo-select-empty">
          <a-empty description="未找到匹配结果，请调整筛选条件" />
        </div>
        <label
          v-for="opt in options"
          :key="opt.assetId"
          class="logo-select-item"
          @click="chosenId = opt.assetId"
        >
          <a-radio :value="opt.assetId" />
          <img
            v-if="opt.thumbnailUrl"
            class="logo-select-thumb"
            :src="opt.thumbnailUrl"
            :alt="opt.assetName"
          />
          <span class="logo-select-name" :title="opt.assetName">
            {{ opt.assetName }}
          </span>
        </label>
      </a-radio-group>
    </a-spin>
  </a-modal>
</template>

<style scoped>
.logo-select-body {
  display: block;
  margin-top: 12px;
}

.logo-select-group {
  display: block;
  width: 100%;
}

.logo-select-empty {
  padding: 16px 0;
}

.logo-select-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.logo-select-item:hover {
  background: var(--dl-hover-bg);
}

.logo-select-thumb {
  width: 40px;
  height: 28px;
  object-fit: contain;
  border: 1px solid var(--dl-border-light);
  border-radius: 4px;
  background: var(--dl-bg-page);
}

.logo-select-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dl-title-color);
}
</style>
