<script setup lang="ts">
/**
 * Tab1 素材库（PageSpec assets.md §4；DlListPage viewMode 'card' 网格卡片）。
 *
 * - 卡片映射 §4.3 列语义：缩略图+名称（link → OHS file-url 签发限时 URL
 *   预览大图）、分类、类型/状态字典 tag（assetStatus colorTag）、引用数
 *   （>0 锁定删除）、文件大小（格式化）、更新时间、行操作；
 * - 行操作 operList 驱动（§4.4）：edit / disable(ACTIVE) / enable(DISABLED) /
 *   delete(refCount=0；否则禁用+tooltip「被版本引用，仅可停用」)；
 * - 批量停用（§4.2）：卡片勾选（仅启用态可选），引擎表格 rowSelection 不
 *   作用于卡片视图，选择态本地维护；
 * - 上传（§4.2）：AssetUploadDialog（multipart 通道）；
 * - §8 工作台引用选择器直达：highlightAssetId 高亮目标卡片。
 */
import { computed, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { PictureOutlined } from '@ant-design/icons-vue'

import { DlListPage, executeAction, formatDatetime, useDict } from '@/engine'

import { assetListConfig } from './assets.config'
import {
  ASSET_DICT_STATUS,
  ASSET_DICT_TYPE,
  ASSET_STATUS,
  formatFileSize,
  registerAssetDictColors,
  signAssetFileUrl,
  type AssetListRow,
} from './assets.shared'
import AssetUploadDialog from './AssetUploadDialog.vue'
import AssetEditDialog from './AssetEditDialog.vue'

registerAssetDictColors()

defineProps<{
  /** 工作台引用选择器直达时的高亮素材（/assets?highlight={assetId}） */
  highlightAssetId?: string
}>()

const dict = useDict('asset', [ASSET_DICT_TYPE, ASSET_DICT_STATUS])

const listRef = ref<InstanceType<typeof DlListPage> | null>(null)
const records = computed<AssetListRow[]>(
  () => (listRef.value?.list.records.value ?? []) as AssetListRow[],
)

async function refresh(): Promise<void> {
  await listRef.value?.refresh()
}

// ---------------------------------------------------------------
// 弹窗：上传 / 编辑
// ---------------------------------------------------------------

const uploadOpen = ref(false)
const editOpen = ref(false)
const editTarget = ref<AssetListRow | null>(null)

// ---------------------------------------------------------------
// 大图预览（OHS file-url 限时 URL 签发，api-assets.md §5.1）
// ---------------------------------------------------------------

const previewUrl = ref('')
const previewVisible = ref(false)

async function openPreview(row: AssetListRow): Promise<void> {
  const url = await signAssetFileUrl(row.assetId)
  if (!url) {
    message.warning('图片地址签发失败，请稍后重试')
    return
  }
  previewUrl.value = url
  previewVisible.value = true
}

// ---------------------------------------------------------------
// 卡片行操作（§4.4 operList 映射；删除 refCount 守卫：禁用+tooltip）
// ---------------------------------------------------------------

interface CardOper {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  tooltip?: string
}

/** operList 存在时以其为准（后端按状态/refCount 计算）；空则按 §4.4 前端派生（过渡兜底） */
function operAllowed(row: AssetListRow, code: string): boolean {
  if (row.operList && row.operList.length > 0) {
    return row.operList.some((o) => o.code === code)
  }
  return true
}

function canDelete(row: AssetListRow): boolean {
  if (row.operList && row.operList.length > 0) {
    return row.operList.some((o) => o.code === 'delete')
  }
  return (row.refCount ?? 0) === 0
}

function cardOpers(row: AssetListRow): CardOper[] {
  const opers: CardOper[] = [{ key: 'edit', label: '编辑' }]
  if (
    row.assetStatus === ASSET_STATUS.ACTIVE &&
    operAllowed(row, 'disable')
  ) {
    opers.push({ key: 'disable', label: '停用' })
  } else if (
    row.assetStatus === ASSET_STATUS.DISABLED &&
    operAllowed(row, 'enable')
  ) {
    opers.push({ key: 'enable', label: '启用' })
  }
  const del: CardOper = { key: 'delete', label: '删除', danger: true }
  if (!canDelete(row)) {
    del.disabled = true
    del.tooltip = '被版本引用，仅可停用'
  }
  opers.push(del)
  return opers
}

async function onOper(btn: CardOper, row: AssetListRow): Promise<void> {
  if (btn.key === 'edit') {
    editTarget.value = row
    editOpen.value = true
    return
  }
  if (btn.key === 'disable') {
    await executeAction('asset.assetDisable', { assetId: row.assetId })
    message.success('已停用')
    await refresh()
    return
  }
  if (btn.key === 'enable') {
    await executeAction('asset.assetEnable', { assetId: row.assetId })
    message.success('已启用')
    await refresh()
    return
  }
  if (btn.key === 'delete') {
    if (btn.disabled) return
    Modal.confirm({
      title: '确认删除该素材？',
      content: `「${row.assetName}」删除后不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      async onOk() {
        await executeAction('asset.assetDelete', { assetId: row.assetId })
        message.success('已删除')
        await refresh()
      },
    })
  }
}

// ---------------------------------------------------------------
// 批量停用（§4.2；卡片勾选本地维护，仅启用态可选）
// ---------------------------------------------------------------

const selectedAssetIds = ref<string[]>([])

const selectedActiveRows = computed(() =>
  records.value.filter(
    (r) =>
      selectedAssetIds.value.includes(r.assetId) &&
      r.assetStatus === ASSET_STATUS.ACTIVE,
  ),
)

function toggleSelect(row: AssetListRow, checked: boolean): void {
  const idx = selectedAssetIds.value.indexOf(row.assetId)
  if (checked && idx < 0) selectedAssetIds.value.push(row.assetId)
  if (!checked && idx >= 0) selectedAssetIds.value.splice(idx, 1)
}

function clearSelection(): void {
  selectedAssetIds.value = []
}

function onBatchDisable(): void {
  const rows = selectedActiveRows.value
  if (rows.length === 0) {
    message.warning('请先勾选要停用的启用态素材')
    return
  }
  const names = rows.map((r) => r.assetName).join('、')
  Modal.confirm({
    title: `确认停用选中的 ${rows.length} 个素材？`,
    content: names,
    okText: '停用',
    cancelText: '取消',
    maskClosable: false,
    async onOk() {
      await Promise.all(
        rows.map((row) =>
          executeAction('asset.assetDisable', { assetId: row.assetId }),
        ),
      )
      message.success('已停用')
      clearSelection()
      await refresh()
    },
  })
}

function onToolbarClick(btn: { key: string }): void {
  if (btn.key === 'upload') {
    uploadOpen.value = true
  } else if (btn.key === 'batchDisable') {
    onBatchDisable()
  }
}
</script>

<template>
  <div class="asset-tab">
    <!-- 勾选状态条（批量停用选择反馈） -->
    <div v-if="selectedAssetIds.length > 0" class="dl-page-card asset-select-bar">
      <span>已选 {{ selectedActiveRows.length }} 项（仅启用态参与停用）</span>
      <a-button type="link" size="small" @click="clearSelection">清空选择</a-button>
    </div>

    <DlListPage ref="listRef" :config="assetListConfig" @toolbar-click="onToolbarClick">
      <template #card="{ row }">
        <div
          class="asset-card"
          :class="{
            'asset-card--disabled': row.assetStatus === ASSET_STATUS.DISABLED,
            'asset-card--highlight': highlightAssetId != null && row.assetId === highlightAssetId,
          }"
        >
          <div class="asset-card-head">
            <a-checkbox
              :disabled="row.assetStatus !== ASSET_STATUS.ACTIVE"
              :checked="selectedAssetIds.includes(row.assetId as string)"
              @update:checked="(v: boolean) => toggleSelect(row as AssetListRow, v)"
            />
            <a-button
              type="link"
              class="asset-card-name"
              :title="row.assetName as string"
              @click="openPreview(row as AssetListRow)"
            >
              {{ row.assetName }}
            </a-button>
          </div>

          <!-- 缩略图（点击预览大图：OHS 限时 URL） -->
          <button
            type="button"
            class="asset-thumb"
            :title="`预览 ${row.assetName}`"
            @click="openPreview(row as AssetListRow)"
          >
            <img
              v-if="row.thumbnailUrl"
              :src="row.thumbnailUrl as string"
              :alt="row.assetName as string"
              loading="lazy"
            />
            <PictureOutlined v-else class="asset-thumb-placeholder" />
          </button>

          <div class="asset-card-meta">
            <a-tag :color="dict.color(ASSET_DICT_TYPE, row.assetType as string | undefined)">
              {{ dict.label(ASSET_DICT_TYPE, row.assetType as string | undefined) }}
            </a-tag>
            <a-tag :color="dict.color(ASSET_DICT_STATUS, row.assetStatus as string | undefined)">
              {{ dict.label(ASSET_DICT_STATUS, row.assetStatus as string | undefined) }}
            </a-tag>
            <span class="asset-card-cat">{{ row.category || '—' }}</span>
          </div>

          <div class="asset-card-stats">
            <span>引用 {{ (row.refCount as number | undefined) ?? 0 }}</span>
            <span>{{ formatFileSize(row.fileSize as number | undefined) }}</span>
            <span>{{ formatDatetime(row.updatedTime as string | undefined) }}</span>
          </div>

          <!-- 行操作（operList 驱动；delete refCount 守卫：禁用+tooltip） -->
          <div class="asset-card-ops">
            <template v-for="btn in cardOpers(row as AssetListRow)" :key="btn.key">
              <a-tooltip v-if="btn.disabled" :title="btn.tooltip">
                <a-button type="link" size="small" disabled>
                  {{ btn.label }}
                </a-button>
              </a-tooltip>
              <a-button
                v-else
                type="link"
                size="small"
                :danger="btn.danger"
                @click="onOper(btn, row as AssetListRow)"
              >
                {{ btn.label }}
              </a-button>
            </template>
          </div>
        </div>
      </template>
    </DlListPage>

    <!-- 上传（multipart 通道） / 元信息编辑 -->
    <AssetUploadDialog
      v-model:open="uploadOpen"
      @success="refresh()"
    />
    <AssetEditDialog
      v-model:open="editOpen"
      :row="editTarget"
      @success="refresh()"
    />

    <!-- 大图预览（OHS 签发限时 URL） -->
    <a-image
      v-if="previewUrl"
      style="display: none"
      :src="previewUrl"
      :preview="{
        visible: previewVisible,
        src: previewUrl,
        onVisibleChange: (v: boolean) => (previewVisible = v),
      }"
    />
  </div>
</template>

<style scoped>
/* 覆盖 Tab 壳对内嵌 .dl-page-card 的展平（提高选择器优先级，稳定胜出） */
.asset-tab .dl-page-card.asset-select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--dl-text-secondary);
}

.asset-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dl-card-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 10px;
  box-shadow: var(--dl-card-shadow);
  padding: 12px 16px;
  height: 100%;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.asset-card:hover:not(.asset-card--highlight) {
  box-shadow: var(--dl-card-shadow-hover);
  transform: translateY(-1px);
}

/* 停用态视觉弱化（启停生命周期） */
.asset-card--disabled {
  opacity: 0.55;
}

/* 工作台引用选择器直达高亮（PageSpec §8） */
.asset-card--highlight {
  border-color: var(--dl-primary);
  box-shadow: 0 0 0 2px rgba(107, 138, 181, 0.2);
}

.asset-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.asset-card-name {
  padding: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
}

.asset-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 120px;
  padding: 0;
  border: 1px solid var(--dl-border-light);
  border-radius: 4px;
  background: var(--dl-bg-page);
  cursor: zoom-in;
  overflow: hidden;
}

.asset-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.asset-thumb-placeholder {
  font-size: 28px;
  color: var(--dl-text-secondary);
}

.asset-card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.asset-card-cat {
  color: var(--dl-text-secondary);
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.asset-card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.asset-card-ops {
  display: flex;
  align-items: center;
  gap: 4px;
  border-top: 1px solid var(--dl-border-light);
  padding-top: 8px;
  margin-top: auto;
}
</style>
