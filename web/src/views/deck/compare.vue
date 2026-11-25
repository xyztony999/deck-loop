<script setup lang="ts">
/**
 * 版本对比页（/deck/:deckId/compare?left=&right=；PageSpec version.md §5，code）。
 *
 * - 页头双版本选择器（树节点）可换版；数据 ver.version/compare + 两侧 detail；
 * - 左右双画布（文档表面白纸）逐页对齐；差异页 changeKind 色标（chrome accent
 *   边框）；页列表侧栏（差异计数徽标）；差异块点击定位描边；
 * - 同版本比较拒绝（BIZ_VERSION_SAME_COMPARE 文案透传）；只读，无编辑/指令入口。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { executeAction } from '@/engine'
import {
  CHANGE_KIND_COLORS,
  CHANGE_KIND_LABELS,
  type PageChangeKind,
  type VersionCompareVO,
  type VersionDetailVO,
  type VersionTreeNode,
  type VersionTreeVO,
} from './versionTypes'
import {
  collectAssetIds,
  normalizeVersionPages,
  signAssetFileUrls,
} from './composables/useVersionContent'

const route = useRoute()
const router = useRouter()

const deckId = computed(() => String(route.params.deckId ?? ''))

function queryString(v: unknown): string {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' ? raw : ''
}

const leftId = ref(queryString(route.query.left))
const rightId = ref(queryString(route.query.right))

// ---------------------------------------------------------------
// 版本选择器（树节点 ALL 展平）
// ---------------------------------------------------------------

interface VersionOption {
  value: string
  label: string
}

const versionOptions = ref<VersionOption[]>([])

function flatten(nodes: VersionTreeNode[], out: VersionOption[]): void {
  for (const n of nodes) {
    out.push({ value: n.versionId, label: `v${n.versionSeq} · ${n.branchName}` })
    if (n.children?.length) flatten(n.children, out)
  }
}

async function loadOptions(): Promise<void> {
  if (!deckId.value) return
  try {
    const vo = await executeAction<VersionTreeVO>('ver.versionTree', {
      deckId: deckId.value,
      branchScope: 'ALL',
    })
    const out: VersionOption[] = []
    flatten(vo?.tree ?? [], out)
    versionOptions.value = out
  } catch {
    versionOptions.value = []
  }
}

function onSideChange(side: 'left' | 'right', v: unknown): void {
  const id = typeof v === 'string' ? v : ''
  if (side === 'left') leftId.value = id
  else rightId.value = id
  void router.replace({
    path: `/deck/${deckId.value}/compare`,
    query: { left: leftId.value, right: rightId.value },
  })
}

// ---------------------------------------------------------------
// 对比数据加载
// ---------------------------------------------------------------

const loading = ref(false)
const loadFailed = ref(false)
const sameCompare = ref(false)
let loadSequence = 0
const compare = ref<VersionCompareVO | null>(null)
const leftDetail = ref<VersionDetailVO | null>(null)
const rightDetail = ref<VersionDetailVO | null>(null)
const fileUrls = ref<Record<string, string>>({})

async function load(): Promise<void> {
  if (!deckId.value || !leftId.value || !rightId.value) return
  const sequence = ++loadSequence
  loading.value = true
  loadFailed.value = false
  sameCompare.value = false
  compare.value = null
  leftDetail.value = null
  rightDetail.value = null
  fileUrls.value = {}
  try {
    const [cmp, left, right] = await Promise.all([
      executeAction<VersionCompareVO>('ver.versionCompare', {
        deckId: deckId.value,
        leftVersionId: leftId.value,
        rightVersionId: rightId.value,
      }),
      executeAction<VersionDetailVO>('ver.versionDetail', { versionId: leftId.value }),
      executeAction<VersionDetailVO>('ver.versionDetail', { versionId: rightId.value }),
    ])
    if (sequence !== loadSequence) return
    compare.value = cmp
    leftDetail.value = left
    rightDetail.value = right
    const leftPages = normalizeVersionPages(left?.content)
    const rightPages = normalizeVersionPages(right?.content)
    const assetIds = [...new Set([...collectAssetIds(leftPages), ...collectAssetIds(rightPages)])]
    const urls = await signAssetFileUrls(assetIds)
    if (sequence === loadSequence) fileUrls.value = urls
  } catch (err) {
    if (sequence !== loadSequence) return
    if ((err as { code?: string }).code === 'BIZ_VERSION_SAME_COMPARE') {
      sameCompare.value = true
    } else {
      loadFailed.value = true
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch(
  () => [deckId.value, leftId.value, rightId.value] as const,
  ([, l, r]) => {
    if (l && r) void load()
  },
  { immediate: true },
)

watch(deckId, () => void loadOptions(), { immediate: true })

// ---------------------------------------------------------------
// diff 索引 + 页列表侧栏
// ---------------------------------------------------------------

const pageDiffMap = computed(() => {
  const map = new Map<string, PageChangeKind>()
  for (const p of compare.value?.pages ?? []) map.set(p.pageId, p.changeKind)
  return map
})

const blockDiffMap = computed(() => {
  const map = new Map<string, Map<string, PageChangeKind>>()
  for (const p of compare.value?.pages ?? []) {
    const blocks = new Map<string, PageChangeKind>()
    for (const b of p.diffBlocks ?? []) blocks.set(b.blockId, b.changeKind)
    map.set(p.pageId, blocks)
  }
  return map
})

function pageKind(pageId: string): PageChangeKind {
  return pageDiffMap.value.get(pageId) ?? 'NONE'
}

function blockKind(pageId: string, blockId: string): PageChangeKind {
  return blockDiffMap.value.get(pageId)?.get(blockId) ?? 'NONE'
}

const leftPages = computed(() => normalizeVersionPages(leftDetail.value?.content))
const rightPages = computed(() => normalizeVersionPages(rightDetail.value?.content))

/** 页列表（按 pageId 合并左右，差异计数徽标） */
interface PageListItem {
  pageId: string
  title: string
  kind: PageChangeKind
  diffCount: number
}

const pageList = computed<PageListItem[]>(() => {
  const map = new Map<string, PageListItem>()
  const add = (pages: typeof leftPages.value): void => {
    for (const p of pages) {
      if (!map.has(p.pageId)) {
        map.set(p.pageId, {
          pageId: p.pageId,
          title: p.title || '未命名页',
          kind: pageKind(p.pageId),
          diffCount: (compare.value?.pages?.find((x) => x.pageId === p.pageId)?.diffBlocks ?? []).length,
        })
      }
    }
  }
  add(leftPages.value)
  add(rightPages.value)
  return [...map.values()]
})

const changedPageCount = computed(
  () => pageList.value.filter((p) => p.kind !== 'NONE').length,
)

const selectedBlock = ref<string>('')

function locateBlock(pageId: string, blockId: string): void {
  const key = `${pageId}:${blockId}`
  selectedBlock.value = selectedBlock.value === key ? '' : key
  const el = document.getElementById(`cmp-${pageId}-${blockId}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function isBlockSelected(pageId: string, blockId: string): boolean {
  return selectedBlock.value === `${pageId}:${blockId}`
}

function sideLabel(detail: VersionDetailVO | null): string {
  return detail ? `v${detail.versionSeq} · ${detail.branchName}` : '-'
}

function imageUrl(assetId: string | undefined): string | undefined {
  return assetId ? fileUrls.value[assetId] : undefined
}

function goBack(): void {
  void router.replace(`/deck/${deckId.value}`)
}
</script>

<template>
  <div class="dl-page compare-page">
    <!-- 页头行：标题 + 双版本选择器 + 返回 -->
    <div class="dl-page-header">
      <h1 class="dl-page-title">版本对比</h1>
      <div class="compare-selectors">
        <a-select
          class="compare-select"
          size="small"
          :value="leftId || undefined"
          :options="versionOptions"
          placeholder="左版本"
          show-search
          option-filter-prop="label"
          @update:value="(v: unknown) => onSideChange('left', v)"
        />
        <span class="compare-vs">对比</span>
        <a-select
          class="compare-select"
          size="small"
          :value="rightId || undefined"
          :options="versionOptions"
          placeholder="右版本"
          show-search
          option-filter-prop="label"
          @update:value="(v: unknown) => onSideChange('right', v)"
        />
      </div>
      <div class="dl-page-header-right">
        <span class="compare-legend">
          <span v-for="(color, kind) in CHANGE_KIND_COLORS" :key="kind" class="compare-legend-item">
            <span class="compare-dot" :style="{ background: color }"></span>
            {{ CHANGE_KIND_LABELS[kind as PageChangeKind] }}
          </span>
        </span>
        <a-button @click="goBack">返回工作台</a-button>
      </div>
    </div>

    <!-- 缺参 -->
    <div v-if="!leftId || !rightId" class="compare-body">
      <a-alert type="warning" show-icon message="缺少对比版本，请从版本树选择两个版本后对比" />
    </div>

    <div v-else class="compare-layout">
      <!-- 页列表侧栏（差异计数徽标） -->
      <aside class="compare-sidebar">
        <div class="compare-sidebar-head">页列表 · {{ changedPageCount }} 页有差异</div>
        <div
          v-for="item in pageList"
          :key="item.pageId"
          class="compare-sidebar-item"
          :style="{ borderLeftColor: CHANGE_KIND_COLORS[item.kind] }"
        >
          <span class="compare-sidebar-title">{{ item.title }}</span>
          <a-badge
            v-if="item.diffCount > 0"
            :count="item.diffCount"
            :number-style="{ backgroundColor: 'var(--dl-primary)' }"
          />
        </div>
        <a-empty v-if="pageList.length === 0" :image-style="{ height: '40px' }" description="暂无页" />
      </aside>

      <!-- 双画布主体 -->
      <div class="compare-body">
        <a-spin :spinning="loading">
          <a-alert v-if="loadFailed" type="error" show-icon message="版本对比加载失败，请重试">
            <template #action><a-button size="small" @click="load">重试</a-button></template>
          </a-alert>
          <a-alert
            v-else-if="sameCompare"
            type="warning"
            show-icon
            message="不能将版本与自身对比，请选择两个不同版本"
          />
          <a-alert
            v-else-if="compare?.sameHash"
            type="success"
            show-icon
            message="两个版本内容完全一致（content_hash 相同）"
          />
          <div v-else class="compare-cols">
            <div v-for="side in ['left', 'right']" :key="side" class="compare-col">
              <div class="compare-col-head">
                {{ side === 'left' ? '左' : '右' }} · {{ side === 'left' ? sideLabel(leftDetail) : sideLabel(rightDetail) }}
              </div>
              <div class="compare-pages">
                <div
                  v-for="(page, pi) in side === 'left' ? leftPages : rightPages"
                  :key="page.pageId"
                  class="compare-page"
                  :style="{ borderColor: CHANGE_KIND_COLORS[pageKind(page.pageId)] }"
                >
                  <div class="compare-page-head">
                    <span>第 {{ pi + 1 }} 页 · {{ page.title || '未命名页' }}</span>
                    <span
                      v-if="pageKind(page.pageId) !== 'NONE'"
                      class="compare-kind"
                      :style="{ color: CHANGE_KIND_COLORS[pageKind(page.pageId)] }"
                    >
                      {{ CHANGE_KIND_LABELS[pageKind(page.pageId)] }}
                    </span>
                  </div>
                  <div
                    v-for="block in page.blocks"
                    :id="`cmp-${page.pageId}-${block.blockId}`"
                    :key="block.blockId"
                    class="compare-block"
                    :class="{ 'is-located': isBlockSelected(page.pageId, block.blockId) }"
                    :style="{
                      borderColor:
                        blockKind(page.pageId, block.blockId) !== 'NONE'
                          ? CHANGE_KIND_COLORS[blockKind(page.pageId, block.blockId)]
                          : undefined,
                    }"
                    @click="locateBlock(page.pageId, block.blockId)"
                  >
                    <span
                      v-if="blockKind(page.pageId, block.blockId) !== 'NONE'"
                      class="compare-kind"
                      :style="{ color: CHANGE_KIND_COLORS[blockKind(page.pageId, block.blockId)] }"
                    >
                      {{ CHANGE_KIND_LABELS[blockKind(page.pageId, block.blockId)] }}
                    </span>
                    <template v-if="block.blockType === 'TEXT'">{{ block.text || '（空文本块）' }}</template>
                    <img
                      v-else-if="block.blockType === 'IMAGE' && imageUrl(block.assetId)"
                      :src="imageUrl(block.assetId)"
                      alt="图片块"
                    />
                    <span v-else-if="block.blockType === 'IMAGE'" class="compare-ph">图片素材加载中或不可用</span>
                    <span v-else class="compare-ph">占位块</span>
                  </div>
                  <a-empty
                    v-if="page.blocks.length === 0"
                    :image-style="{ height: '40px' }"
                    description="本页无内容块"
                  />
                </div>
                <a-empty
                  v-if="(side === 'left' ? leftPages : rightPages).length === 0"
                  description="该版本暂无内容"
                />
              </div>
            </div>
          </div>
        </a-spin>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare-page {
  height: 100%;
}

.compare-selectors {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compare-select {
  width: 200px;
}

.compare-vs {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.compare-legend {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.compare-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.compare-dot {
  width: 10px;
  height: 10px;
  border-radius: 4px;
  display: inline-block;
}

.compare-layout {
  flex: 1;
  min-height: 0;
  display: flex;
}

.compare-sidebar {
  flex: none;
  width: 220px;
  border-right: 1px solid var(--dl-border-light);
  overflow-y: auto;
  padding: 12px;
}

.compare-sidebar-head {
  font-size: 12px;
  color: var(--dl-text-secondary);
  margin-bottom: 8px;
}

.compare-sidebar-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-left: 3px solid var(--dl-border-light);
  border-radius: 4px;
  margin-bottom: 4px;
  background: var(--dl-hover-bg);
}

.compare-sidebar-title {
  font-size: 13px;
  color: var(--dl-title-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.compare-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 24px;
}

.compare-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.compare-col {
  min-width: 0;
}

.compare-col-head {
  font-weight: 600;
  color: var(--dl-title-color);
  margin-bottom: 8px;
}

.compare-pages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 文档表面：版本内容预览，永远白纸（07 §1/§6） */
.compare-page {
  background: var(--dl-doc-bg);
  border: 2px solid var(--dl-doc-border);
  border-radius: 8px;
  padding: 12px;
}

.compare-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--dl-doc-text);
}

.compare-kind {
  flex: none;
  font-size: 12px;
  font-weight: 600;
}

.compare-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1.5px solid var(--dl-doc-border);
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dl-doc-text);
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
}

.compare-block.is-located {
  outline: 2px solid var(--dl-primary);
  outline-offset: 1px;
}

.compare-block img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 4px;
}

.compare-ph {
  color: var(--dl-doc-text-secondary);
  text-align: center;
}
</style>