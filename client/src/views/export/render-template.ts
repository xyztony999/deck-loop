/**
 * 导出渲染共享模板（ADR-015 客户端渲染）。
 *
 * 自服务端 ContentExportRenderer（commit 74d4412 前）平移的排版语言：
 * 解析 present/data 的 pages 结构 → 定版面块坐标/字号 → HTML 模板（隐藏渲染
 * 窗口消费）→ 字号自适应收缩（视窗内执行，见 render-view）。
 * PPTX 复用同一套版面数值 + 收缩后字号（测量值回传），保证三格式同源。
 */

export const SLIDE_WIDTH = 1280
export const SLIDE_HEIGHT = 720
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface SlideBlock {
  id: string
  kind: 'TEXT' | 'IMAGE' | 'PLACEHOLDER'
  text: string
  assetId: string
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFamily: string
  color: string
  align: 'left' | 'center' | 'right'
}

export interface SlideContent {
  title: string
  note: string
  background: string
  blocks: SlideBlock[]
}

/** 版面解析（content.pages → 定坐标块；非法结构抛错——数据源为云端契约数据） */
export function parseSlides(content: Record<string, unknown>): SlideContent[] {
  const rawPages = content['pages']
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new Error('导出内容必须包含至少一页')
  }
  return rawPages.map((raw, pageIndex) => {
    const page = recordOf(raw)
    if (!page || !Array.isArray(page['blocks'])) {
      throw new Error(`第${pageIndex + 1}页内容格式无效`)
    }
    const rows = Math.max(1, page['blocks'].length)
    const blocks = (page['blocks'] as unknown[]).map((value, blockIndex): SlideBlock => {
      const block = recordOf(value)
      if (!block || !['TEXT', 'IMAGE', 'PLACEHOLDER'].includes(String(block['blockType']))) {
        throw new Error(`第${pageIndex + 1}页包含未知类型的内容块`)
      }
      const style = recordOf(block['style']) ?? {}
      const x = numeric(style['x'], 64, 0, SLIDE_WIDTH - 1)
      const y = numeric(style['y'], 132 + blockIndex * (520 / rows), 0, SLIDE_HEIGHT - 1)
      return {
        id: `p${pageIndex}-b${blockIndex}`,
        kind: String(block['blockType']) as SlideBlock['kind'],
        text: textOf(block['text']),
        assetId: textOf(block['assetId']),
        x,
        y,
        w: numeric(style['width'] ?? style['w'], SLIDE_WIDTH - 128, 1, SLIDE_WIDTH - x),
        h: numeric(style['height'] ?? style['h'], 520 / rows - 12, 1, SLIDE_HEIGHT - y),
        fontSize: numeric(style['fontSize'], 28, 10, 100),
        fontFamily: textOf(style['fontFamily']) || 'Noto Sans CJK SC',
        color: colorOf(style['color'], '1F2937'),
        align:
          style['textAlign'] === 'center' || style['textAlign'] === 'right'
            ? style['textAlign']
            : 'left',
      }
    })
    return {
      title: textOf(page['title']),
      note: textOf(page['note']),
      background: colorOf(recordOf(page['style'])?.['backgroundColor'], 'FFFFFF'),
      blocks,
    }
  })
}

/** 幻灯片主体 HTML（标题 + 逐块绝对定位；页高固定垂直堆叠，@page 打印分页） */
export function slidesHtml(slides: SlideContent[], imageUrls: ReadonlyMap<string, string>): string {
  return slides
    .map((slide) => {
      const blocks = slide.blocks
        .map((block) => {
          const style =
            `left:${block.x}px;top:${block.y}px;width:${block.w}px;height:${block.h}px;` +
            `font-size:${block.fontSize}px;color:#${block.color};text-align:${block.align};` +
            `font-family:${escapeAttr(JSON.stringify(block.fontFamily))},sans-serif`
          if (block.kind === 'IMAGE') {
            const url = imageUrls.get(block.assetId)
            if (!url) throw new Error(`图片素材不可用: ${block.assetId}`)
            return `<div data-block-id="${block.id}" class="block image" style="${style}"><img src="${escapeAttr(url)}" alt=""></div>`
          }
          return `<div data-block-id="${block.id}" class="block text" style="${style}">${escapeHtml(block.text)}</div>`
        })
        .join('')
      return (
        `<section class="slide" data-slide-index="${slides.indexOf(slide)}" style="background:#${slide.background}">` +
        `<h1 class="text slide-title" style="left:64px;top:36px;width:1152px;height:76px;font-size:42px">${escapeHtml(slide.title)}</h1>` +
        `${blocks}</section>`
      )
    })
    .join('')
}

/** 渲染视图全局样式（@page 供 PrintToPdf 分页；viewport 供逐页截图滚动） */
export const RENDER_STYLES = `@page{size:${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${SLIDE_WIDTH}px;font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif}
#render-root{width:${SLIDE_WIDTH}px}
.slide{width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;position:relative;overflow:hidden;break-after:page}
.slide:last-child{break-after:auto}
h1{margin:0;font-weight:700}
.text{position:absolute;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.3}
.block{position:absolute}
.image{display:flex;align-items:center;justify-content:center}
.image img{max-width:100%;max-height:100%;object-fit:contain}`

/** 客户端取图大小上限（与 INV-19 同口径；签名 URL 拉取后转 data URI 供 PPTX） */
export async function fetchImageAsDataUri(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`图片地址非法: ${url}`)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    throw new Error(`图片读取失败: HTTP ${response.status}`)
  }
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(mime)) {
    throw new Error(`图片格式不支持: ${mime}`)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('图片素材超过10MB')
  }
  return `data:${mime};base64,${arrayBufferToBase64(buffer)}`
}

/* ---------------- 内部 ---------------- */

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numeric(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(
    min,
    Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback),
  )
}

function colorOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)
    ? value.replace(/^#/, '')
    : fallback
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return map[char] ?? char
  })
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
