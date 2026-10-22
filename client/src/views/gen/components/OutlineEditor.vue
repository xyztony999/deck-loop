<script setup lang="ts">
/**
 * 大纲编辑器（PageSpec generation.md §4 步骤② 自定义 code 组件）。
 *
 * - 渲染 draftOutline 节点卡片：title（≤50）/ points（按行编辑）/ note / pageHint
 * - 节点增删改 + 拖拽排序（原生 HTML5 DnD，无第三方拖拽依赖）+ 上移/下移
 * - 节点数 1~50；编辑只发 change 事件，自动保存（debounce 2s）由页面负责
 * - 显式 [保存大纲] / [重新生成大纲]（confirm 由页面弹）经事件上抛
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  HolderOutlined,
  PlusOutlined,
  RedoOutlined,
  SaveOutlined,
} from '@ant-design/icons-vue'

import { OUTLINE_NODE_MAX, OUTLINE_TITLE_MAX, normalizePageHint, type OutlineNode } from '../types'

const props = defineProps<{
  nodes: OutlineNode[]
}>()

const emit = defineEmits<{
  /** 任一编辑动作后的完整节点树（不可变更新） */
  (e: 'change', nodes: OutlineNode[]): void
  /** 显式保存 */
  (e: 'save'): void
  /** 重新生成（覆盖提示由页面 confirm） */
  (e: 'regenerate'): void
}>()

const nodeCount = computed(() => props.nodes.length)
const canAdd = computed(() => nodeCount.value < OUTLINE_NODE_MAX)

// ---------------------------------------------------------------
// 不可变更新辅助
// ---------------------------------------------------------------

let nodeSeq = 0

function genNodeId(): string {
  nodeSeq += 1
  return `node-${Date.now().toString(36)}-${nodeSeq.toString(36)}`
}

function commit(next: OutlineNode[]): void {
  emit('change', next)
}

function patchNode(index: number, patch: Partial<OutlineNode>): void {
  commit(props.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)))
}

// ---------------------------------------------------------------
// 节点增删与排序
// ---------------------------------------------------------------

function addNode(): void {
  if (!canAdd.value) {
    message.warning(`大纲节点最多 ${OUTLINE_NODE_MAX} 个`)
    return
  }
  commit([
    ...props.nodes,
    { nodeId: genNodeId(), title: '', points: [], note: '' },
  ])
}

function removeNode(index: number): void {
  if (props.nodes.length <= 1) {
    message.warning('大纲至少保留 1 个节点')
    return
  }
  commit(props.nodes.filter((_, i) => i !== index))
}

function moveNode(from: number, to: number): void {
  if (from === to || to < 0 || to >= props.nodes.length) return
  const next = [...props.nodes]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as OutlineNode)
  commit(next)
}

// ---------------------------------------------------------------
// 拖拽排序（原生 DnD；上移/下移按钮兜底）
// ---------------------------------------------------------------

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(index: number, ev: DragEvent): void {
  dragIndex.value = index
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, ev: DragEvent): void {
  ev.preventDefault()
  dragOverIndex.value = index
}

function onDrop(index: number): void {
  if (dragIndex.value != null) moveNode(dragIndex.value, index)
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd(): void {
  dragIndex.value = null
  dragOverIndex.value = null
}

// ---------------------------------------------------------------
// 字段编辑
// ---------------------------------------------------------------

function onTitleInput(index: number, v: string): void {
  patchNode(index, { title: v })
}

/** points 按行编辑：textarea 值 = points.join('\n')，编辑期保留空行（保存前过滤） */
function pointsText(node: OutlineNode): string {
  return node.points.join('\n')
}

function onPointsInput(index: number, v: string): void {
  patchNode(index, { points: v.split('\n') })
}

function onNoteInput(index: number, v: string): void {
  patchNode(index, { note: v })
}

function onPageHintInput(index: number, v: number | string | null): void {
  // pageHint 为整数契约（服务端 OutlineNodeAO @IsInt）；InputNumber 中间态兜底清洗
  patchNode(index, { pageHint: normalizePageHint(v) })
}
</script>

<template>
  <div class="outline-editor">
    <div class="outline-toolbar">
      <span class="outline-count">节点 {{ nodeCount }}/{{ OUTLINE_NODE_MAX }}</span>
      <a-space>
        <a-button size="small" @click="emit('save')">
          <SaveOutlined />
          保存大纲
        </a-button>
        <a-button size="small" danger @click="emit('regenerate')">
          <RedoOutlined />
          重新生成大纲
        </a-button>
      </a-space>
    </div>

    <div
      v-for="(node, i) in nodes"
      :key="node.nodeId"
      class="outline-node"
      :class="{
        'outline-node-dragging': dragIndex === i,
        'outline-node-over': dragOverIndex === i && dragIndex !== i,
      }"
      draggable="true"
      @dragstart="(ev: DragEvent) => onDragStart(i, ev)"
      @dragover="(ev: DragEvent) => onDragOver(i, ev)"
      @drop="() => onDrop(i)"
      @dragend="onDragEnd"
    >
      <div class="outline-node-head">
        <HolderOutlined class="outline-handle" title="拖拽排序" />
        <span class="outline-node-no">{{ i + 1 }}</span>
        <a-input
          class="outline-title"
          :value="node.title"
          :maxlength="OUTLINE_TITLE_MAX"
          show-count
          placeholder="节点标题（≤50 字）"
          @update:value="(v: string) => onTitleInput(i, v)"
        />
        <a-button
          size="small"
          type="text"
          :disabled="i === 0"
          title="上移"
          @click="moveNode(i, i - 1)"
        >
          <ArrowUpOutlined />
        </a-button>
        <a-button
          size="small"
          type="text"
          :disabled="i === nodes.length - 1"
          title="下移"
          @click="moveNode(i, i + 1)"
        >
          <ArrowDownOutlined />
        </a-button>
        <a-button size="small" type="text" danger title="删除节点" @click="removeNode(i)">
          <DeleteOutlined />
        </a-button>
      </div>

      <div class="outline-node-body">
        <a-textarea
          class="outline-points"
          :value="pointsText(node)"
          :rows="3"
          placeholder="本页要点（每行一个）"
          @update:value="(v: string) => onPointsInput(i, v)"
        />
        <div class="outline-meta">
          <a-input
            :value="node.note"
            placeholder="备注（可空）"
            @update:value="(v: string) => onNoteInput(i, v)"
          />
          <a-input-number
            :value="node.pageHint"
            :min="1"
            :precision="0"
            :controls="false"
            class="outline-pagehint"
            placeholder="建议页数（可空）"
            @update:value="(v: number | string | null) => onPageHintInput(i, v)"
          />
        </div>
      </div>
    </div>

    <a-button
      v-if="canAdd"
      class="outline-add"
      type="dashed"
      block
      @click="addNode"
    >
      <PlusOutlined />
      添加节点
    </a-button>
    <div v-else class="outline-limit-hint">已达节点上限（{{ OUTLINE_NODE_MAX }}）</div>
  </div>
</template>

<style scoped>
.outline-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.outline-count {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.outline-node {
  border: 1px solid var(--dl-border-light);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--dl-bg-page);
  transition: border-color 0.15s;
}

.outline-node-dragging {
  opacity: 0.5;
}

.outline-node-over {
  border-color: var(--dl-primary);
}

.outline-node-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.outline-handle {
  color: var(--dl-text-secondary);
  cursor: grab;
}

.outline-node-no {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--dl-title-bar);
  color: #fff;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.outline-title {
  flex: 1;
}

.outline-node-body {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.outline-points {
  grid-row: span 2;
}

.outline-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.outline-pagehint {
  width: 100%;
}

.outline-add {
  margin-top: 4px;
}

.outline-limit-hint {
  color: var(--dl-text-secondary);
  text-align: center;
  font-size: 13px;
}
</style>
