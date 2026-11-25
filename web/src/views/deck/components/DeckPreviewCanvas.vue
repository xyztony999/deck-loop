<script setup lang="ts">
/**
 * 预览画布（PageSpec preview.md §4；deck 详情工作台右侧，hybrid 的 code 部分）。
 *
 * 浏览器侧渲染（ADR-018 §4.6）：version/detail 的 content 经共享 render-template
 * （parseSlides/slidesHtml/RENDER_STYLES，@render 别名）排版，隔离 iframe 承载
 * （文档表面永远白纸 --dl-doc-bg，1280×720 逻辑尺寸缩放适配）。画布外围控件
 * （页码器/缩放/版本徽标/放映按钮）属 chrome 暗色三层。**只读**：无选取/编辑交互。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  LeftOutlined,
  RightOutlined,
  ExpandOutlined,
} from '@ant-design/icons-vue'

import {
  RENDER_STYLES,
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  contentToSlides,
  slideHtmlSafe,
  toImageUrlMap,
  type SlideContent,
} from '@/render'

const props = defineProps<{
  /** 版本 content JSON（ver/version/detail）；null = 未加载 */
  content: Record<string, unknown> | null
  /** assetId → 限时签名 URL（useVersionContent 批量签发结果） */
  fileUrls?: Record<string, string>
  /** 版本头标签（v{seq} · branch） */
  versionLabel?: string
  loading?: boolean
  /** 当前预览版本 id（放映入口参数） */
  versionId?: string
}>()

const emit = defineEmits<{
  (e: 'present', versionId: string): void
}>()

// ---------------------------------------------------------------
// 版面解析（content → slides；非法结构降级失败态）
// ---------------------------------------------------------------

const parsed = computed<{ slides: SlideContent[]; error: string | null }>(() => {
  if (!props.content) return { slides: [], error: null }
  try {
    return { slides: contentToSlides(props.content), error: null }
  } catch (err) {
    return { slides: [], error: err instanceof Error ? err.message : '内容解析失败' }
  }
})

const slides = computed(() => parsed.value.slides)
const totalPages = computed(() => slides.value.length)
const pageIndex = ref(0)

watch(
  () => props.content,
  () => {
    pageIndex.value = 0
  },
)

const activeSlide = computed<SlideContent | null>(
  () => slides.value[pageIndex.value] ?? null,
)

const imageUrls = computed(() => toImageUrlMap(props.fileUrls ?? {}))

/** 单页隔离文档（共享 RENDER_STYLES + slidesHtml；缺失图片降级占位，不整页崩） */
const frameDoc = computed(() => {
  const slide = activeSlide.value
  if (!slide) return ''
  const inner = slideHtmlSafe(slide, imageUrls.value)
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<style>${RENDER_STYLES}</style></head>` +
    `<body><div id="render-root">${inner}</div></body></html>`
  )
})

// ---------------------------------------------------------------
// 翻页 / 缩放（chrome 控件）
// ---------------------------------------------------------------

const hasPrev = computed(() => pageIndex.value > 0)
const hasNext = computed(() => pageIndex.value < totalPages.value - 1)

function go(delta: number): void {
  const next = pageIndex.value + delta
  pageIndex.value = Math.min(Math.max(next, 0), Math.max(totalPages.value - 1, 0))
}

function onPageInput(v: string): void {
  const n = Number(v)
  if (Number.isFinite(n)) {
    pageIndex.value = Math.min(Math.max(Math.round(n) - 1, 0), Math.max(totalPages.value - 1, 0))
  }
}

const zoomMode = ref<'fit' | '100'>('fit')

// 舞台尺寸测量（适配缩放）
const stageRef = ref<HTMLElement | null>(null)
const stageSize = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null

onMounted(() => {
  if (stageRef.value) {
    observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) stageSize.value = { width: rect.width, height: rect.height }
    })
    observer.observe(stageRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

const scale = computed(() => {
  if (zoomMode.value === '100') return 1
  const { width, height } = stageSize.value
  if (width <= 0 || height <= 0) return 0.5
  return Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT)
})

const frameStyle = computed(() => ({
  width: `${SLIDE_WIDTH * scale.value}px`,
  height: `${SLIDE_HEIGHT * scale.value}px`,
}))

const iframeStyle = computed(() => ({
  width: `${SLIDE_WIDTH}px`,
  height: `${SLIDE_HEIGHT}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}))

// ---------------------------------------------------------------
// 演讲者备注（画布下方折叠小节）
// ---------------------------------------------------------------

const notesOpen = ref(false)
const activeNote = computed(() => activeSlide.value?.note ?? '')

function goPresent(): void {
  if (props.versionId) emit('present', props.versionId)
}
</script>

<template>
  <div class="dl-canvas">
    <!-- 画布头（chrome）：版本徽标 + 页码器 + 缩放 + 放映 -->
    <div class="dl-canvas-head">
      <a-tag v-if="versionLabel" color="blue">{{ versionLabel }}</a-tag>
      <div class="dl-canvas-pager">
        <a-button type="text" size="small" :disabled="!hasPrev" @click="go(-1)">
          <LeftOutlined />
        </a-button>
        <a-input
          class="dl-canvas-page-input"
          size="small"
          :value="totalPages === 0 ? '' : String(pageIndex + 1)"
          :disabled="totalPages === 0"
          @change="(e: Event) => onPageInput((e.target as HTMLInputElement).value)"
        />
        <span class="dl-canvas-page-total">/ {{ totalPages }}</span>
        <a-button type="text" size="small" :disabled="!hasNext" @click="go(1)">
          <RightOutlined />
        </a-button>
      </div>
      <a-select
        v-model:value="zoomMode"
        class="dl-canvas-zoom"
        size="small"
        :options="[
          { label: '适配', value: 'fit' },
          { label: '100%', value: '100' },
        ]"
      />
      <a-button
        type="primary"
        size="small"
        :disabled="!versionId || totalPages === 0"
        @click="goPresent"
      >
        <ExpandOutlined />
        放映
      </a-button>
    </div>

    <!-- 舞台：文档表面白纸内框（iframe 隔离共享排版），外围 chrome -->
    <div ref="stageRef" class="dl-canvas-stage">
      <div v-if="loading" class="dl-canvas-state">
        <a-spin />
        <span class="dl-canvas-state-tip">正在加载版本内容…</span>
      </div>
      <a-alert
        v-else-if="parsed.error"
        type="error"
        show-icon
        message="内容解析失败"
        :description="parsed.error"
      />
      <a-empty v-else-if="totalPages === 0" description="该版本暂无内容" />
      <div v-else class="dl-canvas-frame" :style="frameStyle">
        <iframe
          class="dl-canvas-iframe"
          :style="iframeStyle"
          :srcdoc="frameDoc"
          title="幻灯片预览"
          sandbox="allow-same-origin"
        />
      </div>
    </div>

    <!-- 演讲者备注（折叠小节，纯文本） -->
    <div v-if="activeSlide" class="dl-canvas-notes">
      <a-button type="link" size="small" @click="notesOpen = !notesOpen">
        {{ notesOpen ? '收起备注' : '演讲者备注' }}
      </a-button>
      <div v-if="notesOpen" class="dl-canvas-notes-body">
        {{ activeNote || '本页无备注' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 画布根 = chrome（表面色板 + 描边 + 圆角）；内框文档表面永远白纸（iframe 隔离） */
.dl-canvas {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--dl-card-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 8px;
  padding: 12px 16px;
}

.dl-canvas-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.dl-canvas-pager {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dl-canvas-page-input {
  width: 48px;
  text-align: center;
}

.dl-canvas-page-total {
  color: var(--dl-text-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.dl-canvas-zoom {
  width: 88px;
}

.dl-canvas-stage {
  flex: 1;
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: var(--dl-bg-page);
  border-radius: 8px;
  padding: 12px;
}

.dl-canvas-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.dl-canvas-state-tip {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

/* 白纸内框（文档表面域）：外框尺寸 = 逻辑尺寸 × 缩放 */
.dl-canvas-frame {
  flex: none;
  background: var(--dl-doc-bg);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.dl-canvas-iframe {
  border: none;
  display: block;
  background: var(--dl-doc-bg);
}

.dl-canvas-notes {
  flex: none;
  margin-top: 8px;
}

.dl-canvas-notes-body {
  margin-top: 4px;
  padding: 8px 12px;
  background: var(--dl-hover-bg);
  border-radius: 8px;
  color: var(--dl-title-color);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
</style>