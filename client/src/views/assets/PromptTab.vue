<script setup lang="ts">
/**
 * Tab3 话术库（PageSpec assets.md §6；DlListPage 标准表格）。
 *
 * - 列语义：title(link → 编辑弹窗) · content(两行截断) · category ·
 *   templateScene(dict tag) · useCount（使用次数展示；工作台选用模板
 *   提交后经 prompt_touch +1 的结果落点）· updatedTime · 操作；
 * - operList 驱动（§6）：edit · delete(confirm)；
 * - 占位符 {xxx} 的实时高亮与未闭合校验在编辑弹窗（INV-21 前置提示；
 *   服务端 BIZ_PROMPT_PLACEHOLDER_SYNTAX 终审）。
 */
import { ref } from 'vue'
import { Modal, message } from 'ant-design-vue'

import { DlListPage, executeAction } from '@/engine'
import type { ActionConfig, ColumnConfig, RowWithOperList } from '@/engine'

import { promptListConfig } from './assets.config'
import { registerAssetDictColors, type PromptRow } from './assets.shared'
import PromptEditDialog from './PromptEditDialog.vue'

registerAssetDictColors()

const listRef = ref<InstanceType<typeof DlListPage> | null>(null)

async function refresh(): Promise<void> {
  await listRef.value?.refresh()
}

// ---------------------------------------------------------------
// 编辑弹窗
// ---------------------------------------------------------------

const editOpen = ref(false)
const editTarget = ref<PromptRow | null>(null)

function openEdit(row: PromptRow | null): void {
  editTarget.value = row
  editOpen.value = true
}

// ---------------------------------------------------------------
// 工具栏 / 链接 / 行操作（operList key 对齐 PageSpec §6）
// ---------------------------------------------------------------

function onToolbarClick(btn: ActionConfig): void {
  if (btn.key === 'create') {
    openEdit(null)
  }
}

/** title 链接列 → 编辑弹窗（§6 title link） */
function onLinkClick(column: ColumnConfig, row: RowWithOperList): void {
  if (column.dataIndex === 'title') {
    openEdit(row as PromptRow)
  }
}

async function onRowClick(
  btn: ActionConfig,
  row: RowWithOperList,
): Promise<void> {
  const tpl = row as PromptRow
  if (btn.key === 'edit') {
    openEdit(tpl)
    return
  }
  if (btn.key === 'delete') {
    Modal.confirm({
      title: '确认删除该话术模板？',
      content: `「${tpl.title}」删除后不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      async onOk() {
        await executeAction('asset.promptDelete', {
          templateId: tpl.templateId,
        })
        message.success('已删除')
        await refresh()
      },
    })
  }
}
</script>

<template>
  <div class="prompt-tab">
    <DlListPage
      ref="listRef"
      :config="promptListConfig"
      @toolbar-click="onToolbarClick"
      @row-click="onRowClick"
      @link-click="onLinkClick"
    />
    <PromptEditDialog
      v-model:open="editOpen"
      :row="editTarget"
      @success="refresh()"
    />
  </div>
</template>
