<script setup lang="ts">
/**
 * 版本树面板（PageSpec version.md §4；deck 详情工作台左侧，自 adjust 迁移）。
 *
 * - ver.version/tree（branchScope ACTIVE 默认 / ALL 切换）+ branches[] 分支概览；
 * - 节点：v{seq} · sourceType tag · instructionBrief（ellipsis，hover 全文）·
 *   createdTime · isCurrent（主色描边）/ isFinal（green 徽标）；taskStatusOfSource
 *   =null（agent 版本）不显示任务态；
 * - 节点操作（operList 驱动）：set-current（回退）/ fork-from（分叉）/ export-from
 *   （→/deliver?deckId=，父页导航）；
 * - 面板头：「对比」选择态（勾选两节点 → emit compare）+ 刷新 + 分支口径切换；
 * - 轻轮询 10s（document.hidden 暂停，ADR-018 §4.6 无 SSE）+ 手动刷新。
 */
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { Input, message, Modal } from 'ant-design-vue'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  StarFilled,
  FlagFilled,
  ReloadOutlined,
} from '@ant-design/icons-vue'

import { executeAction, formatDatetime, useDict } from '@/engine'
import {
  BRANCH_NAME_MAX,
  BRANCH_SCOPE_DEFAULT,
  BRANCH_SCOPE_OPTIONS,
  type VersionBranchInfo,
  type VersionTreeNode,
  type VersionCompareTarget,
  type VersionTreeVO,
} from '../versionTypes'

const props = defineProps<{
  deckId: string
  /** Deck 当前版本指针 */
  currentVersionId?: string
  /** 只读（FINALIZED/ARCHIVED）：隐藏写操作（双保险） */
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'preview', versionId: string): void
  (e: 'changed'): void
  (e: 'compare', target: VersionCompareTarget): void
  (e: 'export-from'): void
}>()

const dict = useDict('ver', ['versionSourceType'])

// ---------------------------------------------------------------
// 数据加载 + 轻轮询（10s，页面隐藏暂停）
// ---------------------------------------------------------------

const branchScope = ref<string>(BRANCH_SCOPE_DEFAULT)
const tree = ref<VersionTreeNode[]>([])
const branches = ref<VersionBranchInfo[]>([])
const loading = ref(false)
const previewVersionId = ref<string>()
const expandedIds = ref(new Set<string>())

async function load(silent = false): Promise<void> {
  if (!props.deckId) return
  if (!silent) loading.value = true
  try {
    const vo = await executeAction<VersionTreeVO>('ver.versionTree', {
      deckId: props.deckId,
      branchScope: branchScope.value,
    })
    tree.value = vo?.tree ?? []
    branches.value = vo?.branches ?? []
    if (!silent) {
      expandedIds.value = new Set(
        tree.value
          .filter((n) => (n.children?.length ?? 0) > 0)
          .map((n) => n.versionId),
      )
    }
  } finally {
    if (!silent) loading.value = false
  }
}

const POLL_INTERVAL = 10_000
let pollTimer: number | undefined

onMounted(() => {
  void load()
  pollTimer = window.setInterval(() => {
    if (!document.hidden) void load(true)
  }, POLL_INTERVAL)
})

onBeforeUnmount(() => {
  if (pollTimer != null) window.clearInterval(pollTimer)
})

defineExpose({ reload: () => load() })

// ---------------------------------------------------------------
// 展平渲染（depth 缩进 + 展开折叠）
// ---------------------------------------------------------------

interface TreeRow {
  node: VersionTreeNode
  depth: number
  hasChildren: boolean
  expanded: boolean
}

const rows = computed<TreeRow[]>(() => {
  const out: TreeRow[] = []
  const walk = (nodes: VersionTreeNode[], depth: number): void => {
    for (const n of nodes) {
      const children = n.children ?? []
      const expanded = expandedIds.value.has(n.versionId)
      out.push({ node: n, depth, hasChildren: children.length > 0, expanded })
      if (children.length > 0 && expanded) walk(children, depth + 1)
    }
  }
  walk(tree.value, 0)
  return out
})

function toggleExpand(node: VersionTreeNode): void {
  const next = new Set(expandedIds.value)
  if (next.has(node.versionId)) next.delete(node.versionId)
  else next.add(node.versionId)
  expandedIds.value = next
}

function sourceTypeLabel(node: VersionTreeNode): string {
  return dict.label('versionSourceType', node.sourceType) || node.sourceType
}

function sourceTypeColor(node: VersionTreeNode): string | undefined {
  return dict.color('versionSourceType', node.sourceType)
}

function nodeTime(node: VersionTreeNode): string {
  return node.createdTime ? formatDatetime(node.createdTime) : ''
}

// ---------------------------------------------------------------
// 对比选择态（勾选两节点 → emit compare）
// ---------------------------------------------------------------

const selecting = ref(false)
const selectedIds = ref<string[]>([])

function toggleSelectMode(): void {
  selecting.value = !selecting.value
  selectedIds.value = []
}

function onNodeClick(node: VersionTreeNode): void {
  if (selecting.value) {
    const ids = selectedIds.value
    if (ids.includes(node.versionId)) {
      selectedIds.value = ids.filter((id) => id !== node.versionId)
    } else if (ids.length < 2) {
      selectedIds.value = [...ids, node.versionId]
    } else {
      message.warning('最多选择两个版本进行对比')
    }
    return
  }
  previewVersionId.value = node.versionId
  emit('preview', node.versionId)
}

function startCompare(): void {
  if (selectedIds.value.length !== 2) {
    message.warning('请勾选两个版本')
    return
  }
  emit('compare', {
    leftVersionId: selectedIds.value[0] as string,
    rightVersionId: selectedIds.value[1] as string,
  })
  selecting.value = false
  selectedIds.value = []
}

// ---------------------------------------------------------------
// 节点操作（operList 驱动优先 + 前端状态双保险）
// ---------------------------------------------------------------

interface NodeOp {
  key: 'rollback' | 'fork' | 'export'
  label: string
}

function nodeOps(node: VersionTreeNode): NodeOp[] {
  const ops: NodeOp[] = []
  const operList = Array.isArray(node.operList) ? node.operList : []
  if (!props.readonly) {
    if (operList.length > 0) {
      for (const it of operList) {
        if (it.code === 'set-current') ops.push({ key: 'rollback', label: it.label || '设为当前' })
        else if (it.code === 'fork-from') ops.push({ key: 'fork', label: it.label || '从此分叉' })
        else if (it.code === 'export-from') ops.push({ key: 'export', label: it.label || '导出' })
      }
    } else {
      if (!node.isCurrent) ops.push({ key: 'rollback', label: '设为当前' })
      ops.push({ key: 'fork', label: '从此分叉' })
    }
  }
  return ops
}

async function onOp(key: NodeOp['key'], node: VersionTreeNode): Promise<void> {
  if (key === 'rollback') confirmRollback(node)
  else if (key === 'fork') openForkModal(node)
  else if (key === 'export') emit('export-from')
}

/** 回退=移指针（api-version D3）：历史不可变 */
function confirmRollback(node: VersionTreeNode): void {
  Modal.confirm({
    title: `将 v${node.versionSeq} 设为当前版本？`,
    content: '历史版本不会改动，随后的调整将从该版本继续追加新版本。',
    okText: '设为当前',
    cancelText: '取消',
    maskClosable: false,
    onOk: async () => {
      await executeAction('ver.versionRollback', {
        deckId: props.deckId,
        versionId: node.versionId,
        confirm: true,
      })
      message.success(`已回退到 v${node.versionSeq}`)
      await load()
      emit('changed')
    },
  })
}

/** 分叉：弹窗填 branchName（≤50，同 deck 唯一由后端 BIZ_VERSION_BRANCH_EXISTS 守卫） */
function openForkModal(node: VersionTreeNode): void {
  let branchName = ''
  Modal.confirm({
    title: `从 v${node.versionSeq} 另起分支`,
    content: () =>
      h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' }, [
        h(
          'p',
          { style: 'color:var(--dl-text-secondary);margin:0' },
          `快照复制为新分支首版并切换为活动分支（≤${BRANCH_NAME_MAX} 字，同创作物内唯一）。`,
        ),
        h(Input, {
          maxlength: BRANCH_NAME_MAX,
          placeholder: `分支名（≤${BRANCH_NAME_MAX} 字）`,
          'onUpdate:value': (v: string) => {
            branchName = v
          },
        }),
      ]),
    okText: '创建分叉',
    cancelText: '取消',
    maskClosable: false,
    onOk: async () => {
      const name = branchName.trim()
      if (!name) {
        message.warning('请填写分支名')
        return Promise.reject(new Error('branchName required'))
      }
      if (name.length > BRANCH_NAME_MAX) {
        message.warning(`分支名不能超过 ${BRANCH_NAME_MAX} 字`)
        return Promise.reject(new Error('branchName too long'))
      }
      await executeAction('ver.versionFork', {
        deckId: props.deckId,
        versionId: node.versionId,
        branchName: name,
      })
      message.success(`已创建分叉「${name}」并切换为活动分支`)
      await load()
      emit('changed')
    },
  })
}
</script>

<template>
  <div class="dl-tree-panel">
    <!-- 面板头：对比选择态 + 刷新 + 分支口径 -->
    <div class="dl-tree-head">
      <a-button
        size="small"
        :type="selecting ? 'primary' : 'default'"
        :disabled="rows.length < 2"
        @click="toggleSelectMode"
      >
        {{ selecting ? '退出对比' : '对比' }}
      </a-button>
      <a-button
        v-if="selecting"
        size="small"
        type="primary"
        :disabled="selectedIds.length !== 2"
        @click="startCompare"
      >
        开始对比（{{ selectedIds.length }}/2）
      </a-button>
      <a-button size="small" type="text" :loading="loading" @click="load()">
        <ReloadOutlined />
      </a-button>
      <a-radio-group
        class="dl-tree-scope"
        :value="branchScope"
        size="small"
        :options="BRANCH_SCOPE_OPTIONS"
        @update:value="
          (v: unknown) => {
            branchScope = String(v)
            void load()
          }
        "
      />
    </div>

    <div v-if="branches.length > 0" class="dl-tree-branches">
      <a-tag
        v-for="b in branches"
        :key="b.branchName"
        :color="b.isActive ? 'blue' : 'default'"
      >
        {{ b.branchName }} · {{ b.versionCount }} 版
      </a-tag>
    </div>

    <a-spin :spinning="loading">
      <div v-if="rows.length > 0" class="dl-tree-rows">
        <div
          v-for="row in rows"
          :key="row.node.versionId"
          class="dl-tree-row"
          :class="{
            'is-current': row.node.isCurrent,
            'is-preview': !selecting && row.node.versionId === previewVersionId,
            'is-selected': selecting && selectedIds.includes(row.node.versionId),
          }"
          :style="{ paddingLeft: `${8 + row.depth * 20}px` }"
          @click="onNodeClick(row.node)"
        >
          <a-checkbox
            v-if="selecting"
            class="dl-tree-check"
            :checked="selectedIds.includes(row.node.versionId)"
            @click.stop
            @update:checked="onNodeClick(row.node)"
          />
          <span
            v-if="row.hasChildren"
            class="dl-tree-caret"
            @click.stop="toggleExpand(row.node)"
          >
            <CaretDownOutlined v-if="row.expanded" />
            <CaretRightOutlined v-else />
          </span>
          <span v-else class="dl-tree-caret dl-tree-caret-ph"></span>

          <span class="dl-tree-seq">v{{ row.node.versionSeq }}</span>
          <a-tag :color="sourceTypeColor(row.node)" class="dl-tree-source">
            {{ sourceTypeLabel(row.node) }}
          </a-tag>

          <a-tooltip v-if="row.node.instructionBrief" :title="row.node.instructionBrief">
            <span class="dl-tree-brief">{{ row.node.instructionBrief }}</span>
          </a-tooltip>

          <span v-if="row.node.isCurrent" class="dl-tree-mark dl-tree-mark-current">
            <StarFilled /> 当前
          </span>
          <span v-if="row.node.isFinal" class="dl-tree-mark dl-tree-mark-final">
            <FlagFilled /> 定稿
          </span>

          <span class="dl-tree-time">{{ nodeTime(row.node) }}</span>

          <span v-if="!selecting" class="dl-tree-ops" @click.stop>
            <a-button
              v-for="op in nodeOps(row.node)"
              :key="op.key"
              type="link"
              size="small"
              @click="void onOp(op.key, row.node)"
            >
              {{ op.label }}
            </a-button>
          </span>
        </div>
      </div>
      <a-empty v-else description="暂无版本（请在 coding agent 中经 MCP 产出）" />
    </a-spin>

    <div class="dl-tree-tip">
      {{ selecting ? '勾选两个版本后开始对比' : '点击版本行可在右侧画布预览该版本' }}
    </div>
  </div>
</template>

<style scoped>
.dl-tree-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dl-tree-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dl-tree-scope {
  margin-left: auto;
}

.dl-tree-branches {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dl-tree-rows {
  display: flex;
  flex-direction: column;
}

.dl-tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  flex-wrap: wrap;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.dl-tree-row:hover {
  background: var(--dl-hover-bg);
}

.dl-tree-row.is-preview {
  background: var(--dl-hover-bg);
}

/* 当前版本：主色描边（ADR-014 主色仅 accent） */
.dl-tree-row.is-current {
  border-color: var(--dl-primary);
  font-weight: 600;
}

.dl-tree-row.is-selected {
  border-color: var(--dl-primary);
  background: var(--dl-hover-bg);
}

.dl-tree-check {
  flex: none;
}

.dl-tree-caret {
  flex: none;
  width: 16px;
  color: var(--dl-text-secondary);
  display: inline-flex;
  justify-content: center;
}

.dl-tree-caret-ph {
  pointer-events: none;
}

.dl-tree-seq {
  flex: none;
  color: var(--dl-title-color);
}

.dl-tree-source {
  flex: none;
  margin-inline-end: 0;
}

.dl-tree-brief {
  color: var(--dl-text-secondary);
  font-size: 12px;
  max-width: 160px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dl-tree-mark {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
}

.dl-tree-mark-current {
  color: var(--dl-primary);
}

.dl-tree-mark-final {
  color: var(--dl-success-color);
}

.dl-tree-time {
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.dl-tree-ops {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
}

.dl-tree-tip {
  color: var(--dl-text-secondary);
  font-size: 12px;
  text-align: center;
}
</style>