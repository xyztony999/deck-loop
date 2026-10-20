/**
 * 导出本地渲染编排（ADR-015：渲染下沉客户端；PageSpec delivery.md §5）。
 *
 * 链路：present/data 拉取（渲染源=演示数据契约）→ 素材签名 URL（复用 adjust 域
 * OHS，50/批）→ 隐藏渲染窗口（/export-render，屏幕外可见保渲染管线）→ 按格式
 * 产出：PDF=插件 PrintToPdf、PNG=逐页滚动+插件截屏+JSZip、PPTX=pptxgenjs
 * （复用同版面数值 + 渲染窗收缩后字号，可编辑文本）→ 产物回传 upload（multipart，
 * rawAxios 直连）→ SUCCEEDED；渲染失败经 fail 上报（≤512 截断）。
 *
 * 平台：Windows 先行（插件 WebView2）；浏览器 dev 无 Tauri 时明确报错。
 */
import { invoke } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

import { executeAction, rawAxios } from '@/engine'
import { getAction } from '@/engine'
import { signAssetFileUrls } from '@/views/adjust/composables/useVersionContent'
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  fetchImageAsDataUri,
  parseSlides,
  slidesHtml,
  type SlideContent,
} from '@/views/export/render-template'

const RENDER_WINDOW_LABEL = 'dl-export-render'
const PAYLOAD_KEY = 'dl_export_render_payload_v1'
const STATUS_KEY = 'dl_export_render_status_v1'
const SCROLL_KEY = 'dl_export_render_scroll_v1'
const SCROLLED_KEY = 'dl_export_render_scrolled_v1'
const CHANNEL_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 120_000

export type ExportFormatCode = 'PDF' | 'IMAGES' | 'PPTX'

export interface RenderProgress {
  stage: 'data' | 'render' | 'upload'
  message: string
}

interface PresentDataVO extends Record<string, unknown> {
  pages?: unknown
}

/** 本地渲染产物 */
export interface RenderedArtifact {
  bytes: Uint8Array
  extension: string
}

/** 渲染窗口就绪态（含 PPTX 复用的收缩字号测量） */
interface RenderReadyStatus {
  state: 'ready' | 'error'
  message?: string
  measurements?: Array<{ blockId: string; fontSize: number }>
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 打开隐藏渲染窗口（屏幕外可见：保渲染管线，不扰用户） */
async function openRenderWindow(): Promise<WebviewWindow> {
  const existing = await WebviewWindow.getByLabel(RENDER_WINDOW_LABEL)
  await existing?.close()
  localStorage.removeItem(STATUS_KEY)
  localStorage.removeItem(SCROLLED_KEY)
  return new WebviewWindow(RENDER_WINDOW_LABEL, {
    url: '/export-render',
    title: 'deck-loop-export-render',
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    x: -32_000,
    y: 0,
    resizable: false,
    decorations: false,
    skipTaskbar: true,
    focus: false,
    alwaysOnTop: false,
    visible: true,
  })
}

/** localStorage 通道：等待渲染窗口状态（storage 事件 + 轮询兜底） */
function waitForStatus(): Promise<RenderReadyStatus> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const read = (): RenderReadyStatus | null => {
      try {
        const raw = localStorage.getItem(STATUS_KEY)
        return raw ? (JSON.parse(raw) as RenderReadyStatus) : null
      } catch {
        return null
      }
    }
    const settle = (status: RenderReadyStatus): void => {
      window.removeEventListener('storage', onStorage)
      clearInterval(poller)
      if (status.state === 'ready') {
        resolve(status)
      } else {
        reject(new Error(status.message ?? '渲染窗口失败'))
      }
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STATUS_KEY || event.newValue == null) return
      const status = read()
      if (status) settle(status)
    }
    const poller = window.setInterval(() => {
      const status = read()
      if (status) {
        settle(status)
      } else if (Date.now() - startedAt > CHANNEL_TIMEOUT_MS) {
        window.removeEventListener('storage', onStorage)
        clearInterval(poller)
        reject(new Error('渲染窗口就绪超时'))
      }
    }, 120)
    window.addEventListener('storage', onStorage)
  })
}

/** 滚动到第 N 页并等待回执（逐页截图用） */
function scrollToPage(index: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const top = index * SLIDE_HEIGHT
    const startedAt = Date.now()
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== SCROLLED_KEY || event.newValue == null) return
      try {
        const ack = JSON.parse(event.newValue) as { top?: unknown }
        if (Number(ack.top ?? -1) === top) done()
      } catch {
        /* 忽略坏帧 */
      }
    }
    const done = (): void => {
      window.removeEventListener('storage', onStorage)
      clearInterval(poller)
      resolve()
    }
    const poller = window.setInterval(() => {
      if (Date.now() - startedAt > 10_000) {
        window.removeEventListener('storage', onStorage)
        clearInterval(poller)
        reject(new Error(`页面滚动定位超时：第${index + 1}页`))
      }
    }, 200)
    window.addEventListener('storage', onStorage)
    localStorage.setItem(SCROLL_KEY, JSON.stringify({ top, at: Date.now() }))
  })
}

/** 主入口：本地渲染三格式（调用方负责 fail 上报与窗口清理的异常路径回传） */
export async function renderDeckArtifact(
  deckId: string,
  format: ExportFormatCode,
  onProgress: (p: RenderProgress) => void,
): Promise<RenderedArtifact> {
  if (!isTauri()) {
    throw new Error('本地导出渲染需要桌面客户端（当前环境无 Tauri）')
  }
  onProgress({ stage: 'data', message: '拉取定稿数据…' })
  const data = await executeAction<PresentDataVO>('deliver.presentData', { deckId })
  const content = (data ?? {}) as Record<string, unknown>
  const slides = parseSlides(content)

  // 素材签名 URL（渲染窗 <img> 直载；PPTX 转内嵌 data URI）
  const assetIds = [
    ...new Set(
      slides.flatMap((slide) => slide.blocks.filter((b) => b.kind === 'IMAGE').map((b) => b.assetId)),
    ),
  ].filter((id) => id.length > 0)
  const imageUrls = new Map(Object.entries(await signAssetFileUrls(assetIds)))

  onProgress({ stage: 'render', message: '准备渲染窗口…' })
  const html = slidesHtml(slides, imageUrls)
  localStorage.setItem(PAYLOAD_KEY, JSON.stringify({ html, at: Date.now() }))
  const readyPromise = waitForStatus()
  const renderWindow = await openRenderWindow()
  try {
    const ready = await readyPromise

    if (format === 'PDF') {
      onProgress({ stage: 'render', message: '生成 PDF…' })
      const bytes = await invoke<number[]>('export_render_pdf', {
        label: RENDER_WINDOW_LABEL,
        params: { widthPx: SLIDE_WIDTH, heightPx: SLIDE_HEIGHT },
      })
      return { bytes: new Uint8Array(bytes), extension: 'pdf' }
    }

    if (format === 'IMAGES') {
      onProgress({ stage: 'render', message: '逐页截图…' })
      const pages: Uint8Array[] = []
      for (let i = 0; i < slides.length; i++) {
        await scrollToPage(i)
        const bytes = await invoke<number[]>('export_capture_window', {
          label: RENDER_WINDOW_LABEL,
        })
        pages.push(new Uint8Array(bytes))
        onProgress({ stage: 'render', message: `逐页截图 ${i + 1}/${slides.length}…` })
      }
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      pages.forEach((page, index) => {
        zip.file(`page-${index + 1}.png`, page)
      })
      const zipped = await zip.generateAsync({ type: 'uint8array' })
      return { bytes: zipped, extension: 'zip' }
    }

    onProgress({ stage: 'render', message: '生成可编辑 PPTX…' })
    const artifact = await buildPptx(slides, imageUrls, ready.measurements ?? [])
    return artifact
  } finally {
    localStorage.removeItem(PAYLOAD_KEY)
    localStorage.removeItem(SCROLL_KEY)
    await renderWindow.close().catch(() => undefined)
  }
}

/** 产物回传（multipart：file + exportId；api-delivery v1.3） */
export async function uploadArtifact(
  exportId: string,
  artifact: RenderedArtifact,
): Promise<void> {
  const path = getAction('deliver.exportUpload')?.path ?? '/deliver/export/upload'
  const form = new FormData()
  form.append('exportId', exportId)
  const ext = artifact.extension === 'zip' ? 'zip' : artifact.extension
  const name = artifact.extension === 'zip' ? 'deck-images.zip' : `deck.${ext}`
  form.append('file', new Blob([artifact.bytes as BlobPart]), name)
  const response = await rawAxios().post(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  })
  const body = response.data as { status?: unknown; message?: unknown }
  if (body?.status !== '0') {
    throw new Error(typeof body?.message === 'string' ? body.message : '产物回传失败')
  }
}

/** 渲染失败上报（QUEUED→FAILED；失败静默不覆盖原错误） */
export async function reportRenderFailure(exportId: string, message: string): Promise<void> {
  try {
    await executeAction('deliver.exportFail', {
      exportId,
      errorMsg: message.slice(0, 512),
    })
  } catch {
    /* 上报失败不追加报错（任务悬挂 QUEUED 由用户 cancel/重试清理） */
  }
}

/* ---------------- PPTX（pptxgenjs：可编辑文本层 + 收缩字号） ---------------- */

async function buildPptx(
  slides: SlideContent[],
  imageUrls: ReadonlyMap<string, string>,
  measurements: Array<{ blockId: string; fontSize: number }>,
): Promise<RenderedArtifact> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const fontSizeByBlock = new Map(measurements.map((m) => [m.blockId, m.fontSize]))
  const imageCache = new Map<string, string>()

  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'DECK', width: SLIDE_WIDTH / 96, height: SLIDE_HEIGHT / 96 })
  pptx.layout = 'DECK'
  pptx.author = 'Deck-Loop'

  for (const slide of slides) {
    const target = pptx.addSlide()
    target.background = { color: slide.background }
    const titleSize = (fontSizeByBlock.get(`${'title'}-${slides.indexOf(slide)}`) ?? 42) * 0.75
    target.addText(slide.title, {
      x: 64 / 96,
      y: 36 / 96,
      w: 1152 / 96,
      h: 76 / 96,
      fontFace: 'Noto Sans CJK SC',
      fontSize: titleSize || 31.5,
      bold: true,
      margin: 0,
      breakLine: false,
      fit: 'shrink',
    })
    for (const block of slide.blocks) {
      const position = { x: block.x / 96, y: block.y / 96, w: block.w / 96, h: block.h / 96 }
      if (block.kind === 'IMAGE') {
        let dataUri = imageCache.get(block.assetId)
        if (dataUri === undefined) {
          const url = imageUrls.get(block.assetId)
          if (!url) throw new Error(`图片素材不可用: ${block.assetId}`)
          dataUri = await fetchImageAsDataUri(url)
          imageCache.set(block.assetId, dataUri)
        }
        target.addImage({ ...position, data: dataUri })
      } else {
        const measured = (fontSizeByBlock.get(block.id) ?? block.fontSize) * 0.75
        target.addText(block.text, {
          ...position,
          color: block.color,
          fontFace: block.fontFamily,
          fontSize: measured || block.fontSize * 0.75,
          margin: 0,
          valign: 'top',
          align: block.align,
          fit: 'shrink',
        })
      }
    }
    if (slide.note) {
      target.addNotes(slide.note)
    }
  }

  const output = await pptx.write({ outputType: 'uint8array' })
  if (!(output instanceof Uint8Array)) {
    throw new Error('PPTX 渲染未返回二进制')
  }
  return { bytes: output, extension: 'pptx' }
}
