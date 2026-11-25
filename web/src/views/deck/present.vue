<script setup lang="ts">
/**
 * 全屏放映（/deck/:deckId/present?versionId=；PageSpec preview.md §5，bare 裸页）。
 *
 * 浏览器侧渲染（ADR-018 §4.6）：version/detail 取 content（任意版本可放映，
 * 不要求定稿）+ asset/file-url 签名取图 → 共享 render-template 排版（buildPresentHtml
 * 隔离 iframe，文档表面永远白纸，letterbox 黑边=页面底 var(--dl-bg-page)）。
 * 键盘 ←→/空格翻页 · Home/End 首末页 · F 全屏 · S 备注 · Esc 退出；底部悬浮
 * 控制条（chrome 浮层，自动隐藏）；演讲者备注侧栏（默认关）。退出 → 详情工作台。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CompressOutlined,
  ExpandOutlined,
  FileTextOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons-vue'

import { executeAction } from '@/engine'
import {
  buildPresentHtml,
  contentToSlides,
  toImageUrlMap,
  type SlideContent,
} from '@/render'
import { useVersionContent } from './composables/useVersionContent'
import type { DeckDetailVO } from './deck.shared'

const route = useRoute()
const router = useRouter()

const deckId = computed(() => {
  const v = route.params.deckId
  return typeof v === 'string' && v ? v : ''
})

const queryVersionId = computed(() => {
  const v = route.query.versionId
  return typeof v === 'string' && v ? v : ''
})

// ---------------------------------------------------------------
// 数据：deck 名称/当前指针 → 版本 content + 签名图 URL
// ---------------------------------------------------------------

const deckName = ref('')
const currentVersionId = ref('')
const loading = ref(false)
const loadFailed = ref(false)
const resolvedVersionId = ref('')

const version = useVersionContent()

const slides = computed<SlideContent[]>(() => {
  const content = version.detail.value?.content
  if (!content || typeof content !== 'object') return []
  try {
    return contentToSlides(content as Record<string, unknown>)
  } catch {
    return []
  }
})

const totalPages = computed(() => slides.value.length)

const presentHtml = computed(() => {
  if (slides.value.length === 0) return ''
  return buildPresentHtml(
    deckName.value || 'deck-loop',
    slides.value,
    toImageUrlMap(version.fileUrls.value),
  )
})

async function load(): Promise<void> {
  if (!deckId.value) return
  loading.value = true
  loadFailed.value = false
  try {
    const deck = await executeAction<DeckDetailVO>('deck.deckDetail', {
      deckId: deckId.value,
      withStats: false,
      withLatestTask: false,
    })
    deckName.value = deck?.deckName ?? ''
    currentVersionId.value = deck?.currentVersionId ?? ''
    const vid = queryVersionId.value || currentVersionId.value
    resolvedVersionId.value = vid
    if (vid) {
      await version.load(vid)
    }
    pageIndex.value = 0
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------
// 翻页态（P3 前端状态，不持久化）+ iframe 桥
// ---------------------------------------------------------------

const pageIndex = ref(0)
const totalFromFrame = ref(0)
const notesOpen = ref(false)
const iframeRef = ref<HTMLIFrameElement | null>(null)

function sendToFrame(msg: Record<string, unknown>): void {
  iframeRef.value?.contentWindow?.postMessage(msg, '*')
}

const displayTotal = computed(() => totalFromFrame.value || totalPages.value)
const hasPrev = computed(() => pageIndex.value > 0)
const hasNext = computed(() => pageIndex.value < displayTotal.value - 1)
const activeNote = computed(() => slides.value[pageIndex.value]?.note ?? '')

function onBridge(e: MessageEvent): void {
  const m = e.data as { source?: string; type?: string; index?: number; total?: number } | null
  if (!m || m.source !== 'dl-present') return
  if (m.type === 'slide') {
    pageIndex.value = m.index ?? 0
    totalFromFrame.value = m.total ?? 0
  } else if (m.type === 'exit') {
    exitPresent()
  } else if (m.type === 'toggleNotes') {
    notesOpen.value = !notesOpen.value
  }
}

// ---------------------------------------------------------------
// 全屏 / 退出 / 自动隐藏控制条
// ---------------------------------------------------------------

const isFullscreen = ref(false)
const controlsVisible = ref(true)
let hideTimer: number | undefined

function pokeControls(): void {
  controlsVisible.value = true
  if (hideTimer != null) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    controlsVisible.value = false
  }, 2500)
}

function onFullscreenChange(): void {
  isFullscreen.value = !!document.fullscreenElement
}

function toggleFullscreen(): void {
  sendToFrame({ type: 'fullscreen' })
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

function goDetail(): void {
  void router.replace(`/deck/${deckId.value}`)
}

/** 父页焦点时按键转发 iframe（iframe 焦点时其自身处理，跨帧不冒泡） */
function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  let handled = true
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      sendToFrame({ type: 'nav', delta: 1 })
      break
    case 'ArrowLeft':
    case 'PageUp':
      sendToFrame({ type: 'nav', delta: -1 })
      break
    case 'Home':
      sendToFrame({ type: 'goto', index: 0 })
      break
    case 'End':
      sendToFrame({ type: 'goto', index: displayTotal.value - 1 })
      break
    case 'f':
    case 'F':
      toggleFullscreen()
      break
    case 's':
    case 'S':
      notesOpen.value = !notesOpen.value
      break
    case 'Escape':
      exitPresent()
      break
    default:
      handled = false
  }
  if (handled) {
    e.preventDefault()
    pokeControls()
  }
}

onMounted(() => {
  window.addEventListener('message', onBridge)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  pokeControls()
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onBridge)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (hideTimer != null) window.clearTimeout(hideTimer)
})

watch(deckId, (next, prev) => {
  if (!next || next === prev) return
  notesOpen.value = false
  void load()
})
</script>

<template>
  <div class="present-root" @mousemove="pokeControls">
    <!-- 缺参守卫 -->
    <div v-if="!deckId" class="present-center">
      <a-alert type="warning" show-icon message="缺少创作物标识（deckId），请从创作物详情进入放映" />
      <a-button type="primary" @click="router.replace('/deck')">返回创作物列表</a-button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="present-center">
      <a-spin size="large" />
      <div class="present-center-tip">正在加载放映内容…</div>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadFailed" class="present-center">
      <a-alert type="error" show-icon message="放映内容加载失败" description="网络异常或服务暂不可用，可重试或返回稍后再试。" />
      <a-space>
        <a-button @click="load">重试</a-button>
        <a-button type="primary" @click="goDetail">返回详情</a-button>
      </a-space>
    </div>

    <!-- 无版本/空内容 -->
    <div v-else-if="totalPages === 0" class="present-center">
      <a-empty description="该创作物暂无可放映的版本内容" />
      <a-button type="primary" @click="goDetail">返回详情</a-button>
    </div>

    <!-- 放映主体：舞台（letterbox 页面底）+ 备注侧栏 + 控制条 -->
    <template v-else>
      <main class="present-stage" :class="{ 'has-notes': notesOpen }">
        <iframe
          ref="iframeRef"
          class="present-iframe"
          :srcdoc="presentHtml"
          title="全屏放映"
          sandbox="allow-scripts allow-same-origin"
        />

        <!-- 演讲者备注（chrome 浮层侧栏，默认关） -->
        <aside v-if="notesOpen" class="present-notes">
          <div class="present-notes-head">
            <FileTextOutlined />
            演讲者备注
          </div>
          <div class="present-notes-body">{{ activeNote || '本页无备注' }}</div>
        </aside>
      </main>

      <!-- 底部悬浮控制条（chrome 浮层，自动隐藏） -->
      <footer class="present-controls" :class="{ 'is-hidden': !controlsVisible }">
        <div class="present-controls-group">
          <button type="button" class="present-ctrl" :disabled="!hasPrev" aria-label="上一页" @click="sendToFrame({ type: 'nav', delta: -1 })">
            <LeftOutlined />
          </button>
          <span class="present-counter">{{ pageIndex + 1 }} / {{ displayTotal }}</span>
          <button type="button" class="present-ctrl" :disabled="!hasNext" aria-label="下一页" @click="sendToFrame({ type: 'nav', delta: 1 })">
            <RightOutlined />
          </button>
        </div>
        <div class="present-controls-group">
          <button type="button" class="present-ctrl" :class="{ 'is-active': notesOpen }" @click="notesOpen = !notesOpen">
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
/* chrome 域：页面壳/控制条/备注窗 = 三层色板 + 主题变量；舞台 letterbox = 页面底。
 * 幻灯片白纸文档表面在 iframe 内（共享 render-template），不随主题。 */
.present-root {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: var(--dl-bg-page);
  display: flex;
  flex-direction: column;
  color: var(--dl-title-color);
}

.present-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dl-bg-page);
}

.present-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: transparent;
}

/* 演讲者备注（chrome 浮层侧栏） */
.present-notes {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 76px;
  width: 316px;
  background: var(--dl-card-bg);
  color: var(--dl-title-color);
  border: 1px solid var(--dl-border-light);
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
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dl-border-light);
}

.present-notes-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 控制条（chrome 浮层，自动隐藏） */
.present-controls {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: var(--dl-card-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  transition: opacity 0.3s ease;
  max-width: calc(100vw - 32px);
}

.present-controls.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.present-controls-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.present-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--dl-border-light);
  background: transparent;
  color: var(--dl-title-color);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.present-ctrl:hover:not(:disabled) {
  background: var(--dl-hover-bg);
}

.present-ctrl:disabled {
  opacity: 0.35;
  cursor: default;
}

.present-ctrl.is-active {
  border-color: var(--dl-primary);
  color: var(--dl-primary);
}

.present-ctrl--exit:hover {
  border-color: var(--dl-danger-color);
  color: var(--dl-danger-color);
}

.present-counter {
  min-width: 64px;
  text-align: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--dl-title-color);
}

.present-keys {
  color: var(--dl-text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 居中状态 */
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
  color: var(--dl-text-secondary);
  font-size: 14px;
}

@media (max-width: 900px) {
  .present-notes {
    width: min(316px, calc(100vw - 40px));
  }
  .present-keys {
    display: none;
  }
}
</style>