<script setup lang="ts">
/**
 * 版本对比视图（PageSpec adjustment.md §4.4「对比视图（抽屉全屏）」，
 * §6 路由 /deck/:deckId/compare 的页内实现——由版本树节点「与当前对比」打开）。
 *
 * - 数据：ver.version/compare（PageDiff/BlockDiff 过程数据）+ 两侧
 *   ver.version/detail 内容快照；
 * - 渲染：左右双栏页面流（左=当前版本基线，右=对比版本），
 *   diff 着色 STRUCTURE 紫 / TEXT 橙 / IMAGE 蓝 / NEW 绿 / REMOVED 灰；
 *   NEW 仅出现在右栏、REMOVED 仅出现在左栏；
 * - sameHash → 内容一致提示；
 * - 引擎层无抽屉组件（DlDrawer 未落地），按 hybrid code 区以自定义
 *   全屏覆盖层实现（Teleport to body，同 §5.8 悬浮锚点先例）。
 */
import { computed, ref, watch } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'

import { executeAction } from '@/engine'
import {
  CHANGE_KIND_COLORS,
  CHANGE_KIND_LABELS,
  type PageChangeKind,
  type VersionCompareTarget,
  type VersionCompareVO,
  type VersionDetailVO,
} from '../types'
import {
  collectAssetIds,
  normalizeVersionPages,
  signAssetFileUrls,
} from '../composables/useVersionContent'

const props = defineProps<{
  open: boolean
  deckId: string
  target?: VersionCompareTarget | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const loading = ref(false)
const loadFailed = ref(false)
let loadSequence = 0
const compare = ref<VersionCompareVO | null>(null)
const leftDetail = ref<VersionDetailVO | null>(null)
const rightDetail = ref<VersionDetailVO | null>(null)
const fileUrls = ref<Record<string, string>>({})

watch(
  () => [props.open, props.deckId, props.target?.leftVersionId, props.target?.rightVersionId] as const,
  ([open]) => {
    if (open && props.target) void load()
  },
  { immediate: true },
)

async function load(): Promise<void> {
  const t = props.target
  if (!t || !props.deckId) return
  const sequence = ++loadSequence
  loading.value = true
  loadFailed.value = false
  compare.value = null
  leftDetail.value = null
  rightDetail.value = null
  fileUrls.value = {}
  try {
    const [cmp, left, right] = await Promise.all([
      executeAction<VersionCompareVO>('ver.versionCompare', {
        deckId: props.deckId,
        leftVersionId: t.leftVersionId,
        rightVersionId: t.rightVersionId,
      }),
      executeAction<VersionDetailVO>('ver.versionDetail', {
        versionId: t.leftVersionId,
      }),
      executeAction<VersionDetailVO>('ver.versionDetail', {
        versionId: t.rightVersionId,
      }),
    ])
    if (sequence !== loadSequence) return
    compare.value = cmp
    leftDetail.value = left
    rightDetail.value = right
    // 两侧图片块素材统一签发限时 URL（失败静默：图片占位展示）
    const leftPages = normalizeVersionPages(left?.content)
    const rightPages = normalizeVersionPages(right?.content)
    const assetIds = [
      ...new Set([...collectAssetIds(leftPages), ...collectAssetIds(rightPages)]),
    ]
    const urls = await signAssetFileUrls(assetIds)
    if (sequence === loadSequence) fileUrls.value = urls
  } catch {
    if (sequence === loadSequence) loadFailed.value = true
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

// ---------------------------------------------------------------
// diff 索引（pageId → changeKind；blockId → changeKind）
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

function sideLabel(detail: VersionDetailVO | null): string {
  return detail ? `v${detail.versionSeq} · ${detail.branchName}` : '-'
}

function imageUrl(assetId: string | undefined): string | undefined {
  return assetId ? fileUrls.value[assetId] : undefined
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dl-compare-overlay">
      <div class="dl-compare-shell">
        <!-- 头部：对比对象 + 图例 + 关闭 -->
        <div class="dl-compare-head">
          <div class="dl-compare-title">
            <span class="dl-compare-title-text">版本对比</span>
            <a-tag color="blue">{{ sideLabel(leftDetail) }}</a-tag>
            <span class="dl-compare-vs">对比</span>
            <a-tag color="purple">{{ sideLabel(rightDetail) }}</a-tag>
            <span class="dl-compare-legend">
              <span
                v-for="(color, kind) in CHANGE_KIND_COLORS"
                :key="kind"
                class="dl-compare-legend-item"
              >
                <span class="dl-compare-dot" :style="{ background: color }"></span>
                {{ CHANGE_KIND_LABELS[kind as PageChangeKind] }}
              </span>
            </span>
          </div>
          <a-button @click="close">
            <CloseOutlined />
            关闭
          </a-button>
        </div>

        <div class="dl-compare-body">
          <a-spin :spinning="loading">
            <a-alert v-if="loadFailed" type="error" message="版本对比加载失败，请重试" show-icon>
              <template #action><a-button size="small" @click="load">重试</a-button></template>
            </a-alert>
            <!-- 内容一致（content_hash 相同，BIZ_VERSION_SAME_COMPARE 之外的正常空 diff） -->
            <a-alert
              v-else-if="compare?.sameHash"
              type="success"
              show-icon
              message="两个版本内容完全一致（content_hash 相同）"
              class="dl-compare-same"
            />

            <!-- 左右双栏页面流（NEW 仅右栏 / REMOVED 仅左栏） -->
            <div v-else class="dl-compare-cols">
              <div v-for="side in ['left', 'right']" :key="side" class="dl-compare-col">
                <div class="dl-compare-col-head">
                  {{ side === 'left' ? '左（基线 · 当前版本）' : '右（对比版本）' }} ·
                  {{ side === 'left' ? sideLabel(leftDetail) : sideLabel(rightDetail) }}
                </div>
                <div class="dl-compare-pages">
                  <div
                    v-for="(page, pi) in side === 'left' ? leftPages : rightPages"
                    :key="page.pageId"
                    class="dl-compare-page"
                    :style="{ borderColor: CHANGE_KIND_COLORS[pageKind(page.pageId)] }"
                  >
                    <div class="dl-compare-page-head">
                      <span>第 {{ pi + 1 }} 页 · {{ page.title || '未命名页' }}</span>
                      <span
                        v-if="pageKind(page.pageId) !== 'NONE'"
                        class="dl-compare-kind"
                        :style="{ color: CHANGE_KIND_COLORS[pageKind(page.pageId)] }"
                      >
                        {{ CHANGE_KIND_LABELS[pageKind(page.pageId)] }}
                      </span>
                    </div>
                    <div
                      v-for="block in page.blocks"
                      :key="block.blockId"
                      class="dl-compare-block"
                      :style="{
                        borderColor:
                          blockKind(page.pageId, block.blockId) !== 'NONE'
                            ? CHANGE_KIND_COLORS[blockKind(page.pageId, block.blockId)]
                            : undefined,
                      }"
                    >
                      <span
                        v-if="blockKind(page.pageId, block.blockId) !== 'NONE'"
                        class="dl-compare-kind"
                        :style="{
                          color: CHANGE_KIND_COLORS[blockKind(page.pageId, block.blockId)],
                        }"
                      >
                        {{ CHANGE_KIND_LABELS[blockKind(page.pageId, block.blockId)] }}
                      </span>
                      <template v-if="block.blockType === 'TEXT'">
                        {{ block.text || '（空文本块）' }}
                      </template>
                      <img
                        v-else-if="block.blockType === 'IMAGE' && imageUrl(block.assetId)"
                        :src="imageUrl(block.assetId)"
                        alt="图片块"
                      />
                      <span v-else-if="block.blockType === 'IMAGE'" class="dl-compare-ph">
                        图片素材加载中或不可用
                      </span>
                      <span v-else class="dl-compare-ph">占位块</span>
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
  </Teleport>
</template>

<style scoped>
.dl-compare-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.dl-compare-shell {
  margin: 24px;
  width: 100%;
  max-width: 1440px;
  background: var(--dl-bg-page);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dl-compare-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--dl-card-bg);
  padding: 12px 16px;
  border-bottom: 1px solid var(--dl-title-border);
}

.dl-compare-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dl-compare-title-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--dl-title-color);
}

.dl-compare-vs {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.dl-compare-legend {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-left: 12px;
  flex-wrap: wrap;
}

.dl-compare-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.dl-compare-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}

.dl-compare-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.dl-compare-same {
  margin-bottom: 12px;
}

.dl-compare-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.dl-compare-col {
  min-width: 0;
}

.dl-compare-col-head {
  font-weight: 600;
  color: var(--dl-title-color);
  margin-bottom: 8px;
}

.dl-compare-pages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dl-compare-page {
  background: #fff;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
}

.dl-compare-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
  color: #1f2937;
}

.dl-compare-kind {
  flex: none;
  font-size: 12px;
  font-weight: 600;
}

.dl-compare-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1.5px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: #374151;
  white-space: pre-wrap;
  word-break: break-word;
}

.dl-compare-block img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 4px;
}

.dl-compare-ph {
  color: #9ca3af;
  text-align: center;
}
</style>
