<script setup lang="ts">
/**
 * 版本树面板（PageSpec adjustment.md §4.4 Tab2）。
 *
 * - ver.version/tree 渲染谱系树（branchScope ACTIVE 默认 / ALL 切换）；
 *   当前版本★、定稿版本🏁标记；来源 tag 走 ver.VersionSourceType 字典；
 * - 节点操作（confirm 二次确认，operList 语义）：设为当前（rollback）/
 *   从此分叉（fork，branchName ≤50 唯一）/ 与当前对比（→对比视图）；
 *   后端节点 operList（set-current/fork-from）存在时优先驱动，前端
 *   readonly 态双保险隐藏写操作（§7）；
 * - 节点行点击 = 预览该版本（父页画布加载 detail）。
 */
import { h, computed, onMounted, ref } from 'vue'
import { Input, message, Modal } from 'ant-design-vue'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  StarFilled,
  FlagFilled,
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
} from '../types'

const props = defineProps<{
  deckId: string
  /** Deck 当前版本指针（设为当前/对比的参照） */
  currentVersionId?: string
  /** 只读（FINALIZED/ARCHIVED）：隐藏写操作（§7 双保险） */
  readonly?: boolean
}>()

const emit = defineEmits<{
  /** 树节点点击 → 父页画布加载该版本 detail（§4.1 版本切换预览） */
  (e: 'preview', versionId: string): void
  /** 回退/分叉后 Deck 指针已变 → 父页刷新 deck 与画布 */
  (e: 'changed'): void
  /** 与当前对比 → 父页打开对比视图 */
  (e: 'compare', target: VersionCompareTarget): void
}>()

const dict = useDict('ver', ['ver.VersionSourceType'])

// ---------------------------------------------------------------
// 数据加载（tree：branchScope ACTIVE 默认 / ALL）
// ---------------------------------------------------------------

const branchScope = ref<string>(BRANCH_SCOPE_DEFAULT)
const tree = ref<VersionTreeNode[]>([])
const branches = ref<VersionBranchInfo[]>([])
const loading = ref(false)
const previewVersionId = ref<string>()
const expandedIds = ref(new Set<string>())

async function load(): Promise<void> {
  if (!props.deckId) return
  loading.value = true
  try {
    const vo = await executeAction<VersionTreeVO>('ver.versionTree', {
      deckId: props.deckId,
      branchScope: branchScope.value,
    })
    tree.value = vo?.tree ?? []
    branches.value = vo?.branches ?? []
    // 默认展开首层（谱系可逐层下钻）
    expandedIds.value = new Set(
      tree.value
        .filter((n) => (n.children?.length ?? 0) > 0)
        .map((n) => n.versionId),
    )
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

defineExpose({ reload: load })

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
  return dict.label('ver.VersionSourceType', node.sourceType) || node.sourceType
}

function sourceTypeColor(node: VersionTreeNode): string | undefined {
  return dict.color('ver.VersionSourceType', node.sourceType)
}

function nodeTime(node: VersionTreeNode): string {
  return node.createdTime ? formatDatetime(node.createdTime) : ''
}

// ---------------------------------------------------------------
// 节点操作（operList 驱动优先 + 前端状态双保险）
// ---------------------------------------------------------------

interface NodeOp {
  key: 'rollback' | 'fork' | 'compare'
  label: string
}

function nodeOps(node: VersionTreeNode): NodeOp[] {
  const ops: NodeOp[] = []
  if (!props.readonly) {
    // 后端 operList（set-current/fork-from，Deck 状态驱动）优先（规则 6）
    const operList = Array.isArray(node.operList) ? node.operList : []
    if (operList.length > 0) {
      for (const it of operList) {
        if (it.code === 'set-current') {
          ops.push({ key: 'rollback', label: it.label || '设为当前' })
        } else if (it.code === 'fork-from') {
          ops.push({ key: 'fork', label: it.label || '从此分叉' })
        }
        // export-from 属导出交付域，不在本工作台展示
      }
    } else {
      // 兜底派生（同 deck.md §6「状态驱动，同 operList 语义」）：
      // 当前节点不可回退；其余节点可回退/分叉
      if (!node.isCurrent) ops.push({ key: 'rollback', label: '设为当前' })
      ops.push({ key: 'fork', label: '从此分叉' })
    }
  }
  if (!node.isCurrent) ops.push({ key: 'compare', label: '与当前对比' })
  return ops
}

function onNodeClick(node: VersionTreeNode): void {
  previewVersionId.value = node.versionId
  emit('preview', node.versionId)
}

async function onOp(key: NodeOp['key'], node: VersionTreeNode): Promise<void> {
  if (key === 'rollback') {
    confirmRollback(node)
  } else if (key === 'fork') {
    openForkModal(node)
  } else if (key === 'compare') {
    const current = props.currentVersionId
    if (!current) {
      message.warning('该创作物暂无当前版本，无法对比')
      return
    }
    // 左=当前版本（基线），右=所选版本
    emit('compare', { leftVersionId: current, rightVersionId: node.versionId })
  }
}

/** 回退=移指针（api-version D3）：历史不可变，继续调整将从该版本追加 */
function confirmRollback(node: VersionTreeNode): void {
  Modal.confirm({
    title: `设为当前版本（回退到 v${node.versionSeq}）`,
    content:
      '回退仅移动当前版本指针，历史版本不会删除；随后的调整将从该版本继续追加新版本。确定回退？',
    okText: '回退',
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
    title: `从 v${node.versionSeq}（${node.branchName}）创建分叉`,
    content: () =>
      h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' }, [
        h(
          'p',
          { style: 'color:#6b7280;margin:0' },
          `将以 v${node.versionSeq} 为分叉头创建新分支并切换为活动分支（≤${BRANCH_NAME_MAX} 字，同创作物内唯一）。`,
        ),
        h(Input, {
          maxlength: BRANCH_NAME_MAX,
          placeholder: `分叉分支名（≤${BRANCH_NAME_MAX} 字）`,
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
        message.warning('请填写分叉分支名')
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
    <!-- 分支口径切换（ACTIVE 默认 / ALL）+ 分支概览 -->
    <div class="dl-tree-scope">
      <a-radio-group
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
            'is-preview': row.node.versionId === previewVersionId,
          }"
          :style="{ paddingLeft: `${8 + row.depth * 20}px` }"
          @click="onNodeClick(row.node)"
        >
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
          <span v-if="row.node.branchName" class="dl-tree-branch-name">
            {{ row.node.branchName }}
          </span>

          <!-- 当前★ / 定稿🏁（§4.4） -->
          <span v-if="row.node.isCurrent" class="dl-tree-mark dl-tree-mark-current">
            <StarFilled /> 当前
          </span>
          <span v-if="row.node.isFinal" class="dl-tree-mark dl-tree-mark-final">
            <FlagFilled /> 定稿
          </span>

          <span class="dl-tree-time">{{ nodeTime(row.node) }}</span>

          <!-- 节点操作（confirm 二次确认，operList 语义） -->
          <span class="dl-tree-ops" @click.stop>
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
      <a-empty v-else description="暂无版本（请先完成初稿生成）" />
    </a-spin>

    <div class="dl-tree-tip">点击版本行可在左侧画布预览该版本</div>
  </div>
</template>

<style scoped>
.dl-tree-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dl-tree-scope {
  display: flex;
  justify-content: flex-end;
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
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  flex-wrap: wrap;
  transition: background-color 0.2s ease;
}

.dl-tree-row:hover {
  background: var(--dl-hover-bg);
}

.dl-tree-row.is-preview {
  background: rgba(22, 119, 255, 0.12);
}

.dl-tree-row.is-current {
  font-weight: 600;
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

.dl-tree-branch-name {
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.dl-tree-mark {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
}

.dl-tree-mark-current {
  color: #faad14;
}

.dl-tree-mark-final {
  color: #52c41a;
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
