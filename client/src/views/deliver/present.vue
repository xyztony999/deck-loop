<script setup lang="ts">
/**
 * 演示放映（/deck/:deckId/present；PageSpec delivery.md §5，S-03，
 * 页面类型 code 全屏；路由 meta.bare 脱离侧边导航骨架）。
 *
 * - 进入守卫：FINALIZED（否则 toast 引导定稿 + 页内引导态）——守卫由
 *   present/data 后端执行（BIZ_EXPORT_NOT_FINALIZED / BIZ_DECK_STATUS_
 *   FORBIDDEN），前端按错误码转入引导态；
 * - 数据：present/data 一次拉取定稿版本快照（pages[] 含 note 演讲者备注）；
 *   内容渲染语义复用 adjust 批的纯函数（normalizeVersionPages 归一 +
 *   signAssetFileUrls OHS 限时 URL 签发），渲染就绪结构直嵌的 fileUrl 优先；
 * - 交互（§5）：←/→/空格翻页 · Home/End 首末页 · F 全屏 · Esc 退出 ·
 *   S 演讲者备注开关（右侧小窗，仅演示者可见）；
 * - §7：演示模式独占窗口焦点，capture 阶段拦截按键并阻断全局快捷键
 *   （修饰键组合不拦截）；无任何编辑入口。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  CompressOutlined,
  ExpandOutlined,
  FileTextOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons-vue'

import { executeAction } from '@/engine'
import {
  collectAssetIds,
  normalizeVersionPages,
  signAssetFileUrls,
} from '@/views/adjust/composables/useVersionContent'
import type { VersionBlock, VersionPage } from '@/views/adjust/types'

import type { PresentDataVO } from './deliver.shared'

const route = useRoute()
const router = useRouter()

const deckId = computed(() => {
  const v = route.params.deckId
  return typeof v === 'string' && v ? v : ''
})

// ---------------------------------------------------------------
// 放映数据（present/data 一次拉取）
// ---------------------------------------------------------------

const loading = ref(false)
/** FINALIZED 守卫未过（引导定稿） */
const guardBlocked = ref(false)
const loadFailed = ref(false)
const deckName = ref('')
const finalVersionSeq = ref<number | null>(null)
const pages = ref<VersionPage[]>([])
const fileUrls = ref<Record<string, string>>({})

/** 渲染就绪结构直嵌的图片 URL（assetId → url；未直嵌的走 OHS 签发） */
function collectDirectFileUrls(raw: unknown): Record<string, string> {
  const root = raw as { pages?: unknown } | null
  const list = Array.isArray(root?.pages) ? root.pages : []
  const result: Record<string, string> = {}
  for (const p of list) {
    const page = p as { blocks?: unknown } | null
    const blocks = Array.isArray(page?.blocks) ? page.blocks : []
    for (const b of blocks) {
      const block = b as { assetId?: unknown; fileUrl?: unknown; url?: unknown } | null
      const assetId = typeof block?.assetId === 'string' ? block.assetId : ''
      const url = [block?.fileUrl, block?.url].find(
        (v): v is string => typeof v === 'string' && v !== '',
      )
      if (assetId && url) result[assetId] = url
    }
  }
  return result
}

async function loadPresent(): Promise<void> {
  if (!deckId.value) return
  loading.value = true
  guardBlocked.value = false
  loadFailed.value = false
  try {
    const vo = await executeAction<PresentDataVO>('deliver.presentData', {
      deckId: deckId.value,
    })
    deckName.value = vo?.deckName ?? ''
    finalVersionSeq.value = vo?.finalVersionSeq ?? null
    pages.value = normalizeVersionPages(vo)
    // 图片经限时 URL：直嵌 fileUrl 优先，其余批量签发（失败静默：占位展示）
    const direct = collectDirectFileUrls(vo)
    const signed = await signAssetFileUrls(collectAssetIds(pages.value))
    fileUrls.value = { ...signed, ...direct }
    pageIndex.value = 0
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'BIZ_EXPORT_NOT_FINALIZED' || code === 'BIZ_DECK_STATUS_FORBIDDEN') {
      guardBlocked.value = true
      message.warning('该创作物尚未定稿，请先定稿后再演示')
    } else {
      loadFailed.value = true
    }
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------
// 翻页 / 备注开关（§5）
// ---------------------------------------------------------------

const pageIndex = ref(0)
const notesOpen = ref(false)

const totalPages = computed(() => pages.value.length)
const currentPage = computed<VersionPage | null>(
  () => pages.value[pageIndex.value] ?? null,
)
const hasPrev = computed(() => pageIndex.value > 0)
const hasNext = computed(() => pageIndex.value < totalPages.value - 1)

function go(delta: number): void {
  const next = pageIndex.value + delta
  pageIndex.value = Math.min(Math.max(next, 0), Math.max(totalPages.value - 1, 0))
}

function goFirst(): void {
  pageIndex.value = 0
}

function goLast(): void {
  pageIndex.value = Math.max(totalPages.value - 1, 0)
}

function toggleNotes(): void {
  notesOpen.value = !notesOpen.value
}

function imageUrl(block: VersionBlock): string | undefined {
  return block.assetId ? fileUrls.value[block.assetId] : undefined
}

// ---------------------------------------------------------------
// 全屏与退出（§5 F / Esc；§7 独占焦点）
// ---------------------------------------------------------------

const isFullscreen = ref(false)

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
  } catch {
    // 全屏被拒绝（权限/环境）：忽略，放映继续
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = !!document.fullscreenElement
}

function exitPresent(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined)
  }
  const back = (window.history.state as { back?: string } | null)?.back
  if (back) {
    void router.back()
  } else {
    void router.replace(`/deck/${deckId.value}`)
  }
}

function goDeckDetail(): void {
  void router.replace(`/deck/${deckId.value}`)
}

/** capture 阶段拦截：屏蔽全局快捷键，演示独占窗口焦点（§7） */
function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  let handled = true
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      go(1)
      break
    case 'ArrowLeft':
    case 'PageUp':
      go(-1)
      break
    case 'Home':
      goFirst()
      break
    case 'End':
      goLast()
      break
    case 'f':
    case 'F':
      void toggleFullscreen()
      break
    case 's':
    case 'S':
      toggleNotes()
      break
    case 'Escape':
      exitPresent()
      break
    default:
      handled = false
  }
  if (handled) {
    e.preventDefault()
    e.stopPropagation()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, { capture: true })
  document.addEventListener('fullscreenchange', onFullscreenChange)
  void loadPresent()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, { capture: true })
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})

// 路由 deckId 变更（同组件复用）：重置放映状态后重拉
watch(deckId, (next, prev) => {
  if (!next || next === prev) return
  pageIndex.value = 0
  notesOpen.value = false
  pages.value = []
  fileUrls.value = {}
  deckName.value = ''
  finalVersionSeq.value = null
  void loadPresent()
})
</script>

<template>
  <div class="present-root">
    <!-- 顶栏：deckName · 定稿版本 tag（无编辑入口） -->
    <header class="present-topbar">
      <div class="present-topbar-title">
        <span class="present-deck-name">{{ deckName || '演示模式' }}</span>
        <a-tag v-if="finalVersionSeq != null" color="geekblue">
          定稿 v{{ finalVersionSeq }}
        </a-tag>
      </div>
    </header>

    <!-- 缺参守卫：无 deckId 无法锚定 -->
    <div v-if="!deckId" class="present-center">
      <a-alert
        type="warning"
        show-icon
        message="缺少创作物标识（deckId），请从创作物详情或迭代工作台进入演示"
      />
      <a-button type="primary" @click="router.replace('/deck')">返回创作物列表</a-button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="present-center">
      <a-spin size="large" />
      <div class="present-center-tip">正在加载演示数据…</div>
    </div>

    <!-- FINALIZED 守卫：引导定稿（§5） -->
    <div v-else-if="guardBlocked" class="present-center">
      <a-alert
        type="warning"
        show-icon
        message="该创作物尚未定稿"
        description="演示模式仅对定稿版本开放，请先在创作物详情执行定稿后再进入演示。"
      />
      <a-button type="primary" @click="goDeckDetail">返回创作物详情</a-button>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadFailed" class="present-center">
      <a-alert
        type="error"
        show-icon
        message="演示数据加载失败"
        description="网络异常或服务暂不可用，可重试或返回稍后再试。"
      />
      <a-space>
        <a-button @click="loadPresent">重试</a-button>
        <a-button type="primary" @click="goDeckDetail">返回详情</a-button>
      </a-space>
    </div>

    <!-- 放映主体：舞台 + 演讲者备注（右侧小窗，仅演示者可见） -->
    <template v-else>
      <main class="present-stage" :class="{ 'has-notes': notesOpen }">
        <!-- 左右翻页热区 -->
        <button
          type="button"
          class="present-hotzone present-hotzone--prev"
          :disabled="!hasPrev"
          aria-label="上一页"
          @click="go(-1)"
        >
          <LeftOutlined />
        </button>

        <div class="present-slide-area">
          <!-- 空版本 -->
          <div v-if="totalPages === 0" class="present-slide present-slide--empty">
            <a-empty description="该定稿版本暂无内容" />
          </div>

          <!-- 当前页幻灯片（页面流式布局渲染） -->
          <section v-else-if="currentPage" class="present-slide" :key="currentPage.pageId">
            <header class="present-slide-head">
              <span class="present-slide-no">{{ pageIndex + 1 }} / {{ totalPages }}</span>
              <span class="present-slide-title">{{ currentPage.title || '未命名页' }}</span>
            </header>
            <div class="present-slide-blocks">
              <template v-for="block in currentPage.blocks" :key="block.blockId">
                <div v-if="block.blockType === 'TEXT'" class="present-blk present-blk-text">
                  {{ block.text || '（空文本块）' }}
                </div>
                <div
                  v-else-if="block.blockType === 'IMAGE'"
                  class="present-blk present-blk-image"
                >
                  <img v-if="imageUrl(block)" :src="imageUrl(block)" alt="图片块" />
                  <div v-else class="present-blk-image-ph">图片素材加载中或不可用</div>
                </div>
                <div v-else class="present-blk present-blk-placeholder">占位块</div>
              </template>
              <a-empty
                v-if="currentPage.blocks.length === 0"
                :image-style="{ height: '48px' }"
                description="本页无内容块"
              />
            </div>
          </section>
        </div>

        <button
          type="button"
          class="present-hotzone present-hotzone--next"
          :disabled="!hasNext"
          aria-label="下一页"
          @click="go(1)"
        >
          <RightOutlined />
        </button>

        <!-- 演讲者备注（§5：右侧小窗，仅演示者可见） -->
        <aside v-if="notesOpen" class="present-notes">
          <div class="present-notes-head">
            <FileTextOutlined />
            演讲者备注（仅演示者可见）
          </div>
          <div class="present-notes-body">
            {{ currentPage?.note || '本页无备注' }}
          </div>
        </aside>
      </main>

      <!-- 控制条：翻页 / 页码 / 备注 / 全屏 / 退出 + 快捷键提示 -->
      <footer class="present-controls">
        <div class="present-controls-group">
          <button
            type="button"
            class="present-ctrl"
            :disabled="!hasPrev"
            aria-label="上一页"
            @click="go(-1)"
          >
            <LeftOutlined />
          </button>
          <span class="present-counter">{{ totalPages === 0 ? 0 : pageIndex + 1 }} / {{ totalPages }}</span>
          <button
            type="button"
            class="present-ctrl"
            :disabled="!hasNext"
            aria-label="下一页"
            @click="go(1)"
          >
            <RightOutlined />
          </button>
        </div>
        <div class="present-controls-group">
          <button
            type="button"
            class="present-ctrl"
            :class="{ 'is-active': notesOpen }"
            @click="toggleNotes"
          >
            <FileTextOutlined />
            备注 (S)
          </button>
          <button type="button" class="present-ctrl" @click="toggleFullscreen">
            <CompressOutlined v-if="isFullscreen" />
            <ExpandOutlined v-else />
            全屏 (F)
          </button>
          <button type="button" class="present-ctrl present-ctrl--exit" @click="exitPresent">
            退出 (Esc)
          </button>
        </div>
        <span class="present-keys">←/→/空格 翻页 · Home/End 首末页 · S 备注 · F 全屏 · Esc 退出</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.present-root {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: #111827;
  display: flex;
  flex-direction: column;
  color: #f9fafb;
}

/* ---------- 顶栏 ---------- */
.present-topbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: rgba(17, 24, 39, 0.9);
}

.present-topbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.present-deck-name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---------- 主体舞台 ---------- */
.present-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 16px 20px;
}

.present-stage.has-notes {
  padding-right: 348px;
  transition: padding-right 0.2s;
}

/* 左右翻页热区 */
.present-hotzone {
  flex: none;
  width: 56px;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  font-size: 22px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.present-hotzone:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.present-hotzone:disabled {
  opacity: 0.25;
  cursor: default;
}

/* 幻灯片 */
.present-slide-area {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.present-slide {
  width: min(1120px, 100%, calc((100vh - 170px) * 16 / 9));
  aspect-ratio: 16 / 9;
  background: #fff;
  color: #1f2937;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.present-slide--empty {
  align-items: center;
  justify-content: center;
}

.present-slide-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 18px 36px 10px;
  border-bottom: 1px solid #f0f0f0;
}

.present-slide-no {
  font-size: 13px;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}

.present-slide-title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.present-slide-blocks {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 36px;
}

.present-blk {
  border-radius: 8px;
  font-size: 17px;
  line-height: 1.7;
}

.present-blk-text {
  background: #f9fafb;
  color: #374151;
  padding: 10px 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.present-blk-image {
  background: #f5f6f8;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.present-blk-image img {
  max-width: 100%;
  max-height: 46vh;
  object-fit: contain;
  border-radius: 6px;
}

.present-blk-image-ph {
  color: #9ca3af;
  font-size: 14px;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  padding: 18px 24px;
}

.present-blk-placeholder {
  border: 1px dashed #d1d5db;
  color: #9ca3af;
  text-align: center;
  padding: 10px;
  font-size: 14px;
}

/* 演讲者备注（右侧小窗，仅演示者可见） */
.present-notes {
  position: absolute;
  top: 56px;
  right: 20px;
  bottom: 76px;
  width: 316px;
  background: #fff;
  color: #1f2937;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.present-notes-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f0f0;
}

.present-notes-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------- 控制条 ---------- */
.present-controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: rgba(17, 24, 39, 0.95);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.present-controls-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.present-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.06);
  color: #f9fafb;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.present-ctrl:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.present-ctrl:disabled {
  opacity: 0.35;
  cursor: default;
}

.present-ctrl.is-active {
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.22);
}

.present-ctrl--exit:hover {
  border-color: #f87171;
  background: rgba(248, 113, 113, 0.18);
}

.present-counter {
  min-width: 64px;
  text-align: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.85);
}

.present-keys {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 居中状态（加载/守卫/失败/缺参） ---------- */
.present-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
}

.present-center :deep(.ant-alert) {
  width: min(520px, 100%);
}

.present-center-tip {
  margin-top: 12px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 14px;
}

@media (max-width: 900px) {
  .present-stage.has-notes {
    padding-right: 20px;
  }

  .present-notes {
    width: min(316px, calc(100vw - 40px));
  }

  .present-keys {
    display: none;
  }
}
</style>
