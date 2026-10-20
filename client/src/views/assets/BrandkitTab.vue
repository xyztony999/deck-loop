<script setup lang="ts">
/**
 * Tab2 品牌规范（PageSpec assets.md §5；DlListPage 标准表格）。
 *
 * - 列语义：kitName(link → 编辑弹窗) · 色板（主色色值+辅色数，呈现层派生
 *   colorsText——引擎表格无自定义单元格插槽，色块组预览在编辑弹窗内提供）
 *   · fonts（title/body 名） · logo（素材名） · isDefault(默认 tag) ·
 *   updatedTime · 操作；
 * - operList 驱动（§5）：edit · set_default(非默认) · delete(非默认且未被
 *   引用)——前端守卫兜底：is_default 拦截（BIZ_BRANDKIT_IS_DEFAULT 同语义），
 *   被 deck 引用的删除拦截由服务端 BIZ 错误承担；
 * - 设默认为全局唯一（INV-17，服务端事务切换）。
 */
import { computed, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'

import { DlListPage, executeAction } from '@/engine'
import type { ActionConfig, ColumnConfig, RowWithOperList } from '@/engine'

import { brandkitListConfig } from './assets.config'
import {
  colorsOf,
  fontsOf,
  isDefaultOf,
  registerAssetDictColors,
  type BrandKitRow,
} from './assets.shared'
import BrandkitEditDialog from './BrandkitEditDialog.vue'

registerAssetDictColors()

const listRef = ref<InstanceType<typeof DlListPage> | null>(null)
const records = computed<BrandKitRow[]>(
  () => (listRef.value?.list.records.value ?? []) as BrandKitRow[],
)

async function refresh(): Promise<void> {
  await listRef.value?.refresh()
}

// ---------------------------------------------------------------
// 呈现层派生列（colorsText / fontsText / logoText / isDefaultText）
// ---------------------------------------------------------------

watch(
  records,
  (rows) => {
    for (const row of rows) {
      const colors = colorsOf(row)
      row.colorsText =
        colors.assistants.length > 0
          ? `${colors.primary} · 辅色 ×${colors.assistants.length}`
          : colors.primary
      const fonts = fontsOf(row)
      row.fontsText =
        [fonts.title, fonts.body].filter((f) => f != null && f !== '').join(' / ') ||
        '—'
      row.logoText = row.logoAssetName || row.logoAssetId || '—'
      row.isDefaultText = isDefaultOf(row) ? '默认' : ''
    }
  },
  { immediate: true },
)

// ---------------------------------------------------------------
// 编辑弹窗
// ---------------------------------------------------------------

const editOpen = ref(false)
const editTarget = ref<BrandKitRow | null>(null)

function openEdit(row: BrandKitRow | null): void {
  editTarget.value = row
  editOpen.value = true
}

// ---------------------------------------------------------------
// 工具栏 / 链接 / 行操作（operList key 对齐 PageSpec §5）
// ---------------------------------------------------------------

function onToolbarClick(btn: ActionConfig): void {
  if (btn.key === 'create') {
    openEdit(null)
  }
}

/** kitName 链接列 → 编辑弹窗（§5 kitName link） */
function onLinkClick(column: ColumnConfig, row: RowWithOperList): void {
  if (column.dataIndex === 'kitName') {
    openEdit(row as BrandKitRow)
  }
}

async function onRowClick(
  btn: ActionConfig,
  row: RowWithOperList,
): Promise<void> {
  const kit = row as BrandKitRow
  if (btn.key === 'edit') {
    openEdit(kit)
    return
  }
  if (btn.key === 'set_default') {
    // 守卫：已是默认（operList 未拦截时的前端兜底，BIZ_BRANDKIT_IS_DEFAULT 同语义）
    if (isDefaultOf(kit)) {
      message.warning('该规范已是默认规范')
      return
    }
    Modal.confirm({
      title: '设为默认品牌规范？',
      content: `「${kit.kitName}」将设为默认规范，原默认规范将取消默认（全局仅一个默认）。`,
      okText: '设为默认',
      cancelText: '取消',
      maskClosable: false,
      async onOk() {
        await executeAction('asset.brandkitSetDefault', {
          brandKitId: kit.brandKitId,
        })
        message.success('已设为默认')
        await refresh()
      },
    })
    return
  }
  if (btn.key === 'delete') {
    // 删除守卫：默认规范不可删除（§5；服务端 BIZ_BRANDKIT_IS_DEFAULT 终审）
    if (isDefaultOf(kit)) {
      message.warning('默认规范不可删除，请先将其他规范设为默认')
      return
    }
    Modal.confirm({
      title: '确认删除该品牌规范？',
      content: `「${kit.kitName}」删除后不可恢复；被创作物引用时服务端将拒绝删除。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      async onOk() {
        await executeAction('asset.brandkitDelete', {
          brandKitId: kit.brandKitId,
        })
        message.success('已删除')
        await refresh()
      },
    })
  }
}
</script>

<template>
  <div class="brandkit-tab">
    <DlListPage
      ref="listRef"
      :config="brandkitListConfig"
      @toolbar-click="onToolbarClick"
      @row-click="onRowClick"
      @link-click="onLinkClick"
    />
    <BrandkitEditDialog
      v-model:open="editOpen"
      :row="editTarget"
      @success="refresh()"
    />
  </div>
</template>
