/**
 * 导出渲染共享模板（ADR-017 平移自原 client/src/views/export/render-template.ts，
 * 原模板平移自服务端 ContentExportRenderer commit 74d4412 前；client 已移除，
 * 本副本为唯一权威）。
 *
 * 排版语言：解析 content.pages → 定版面块坐标/字号 → HTML 模板 → headless 浏览器
 * 消费（PDF 打印分页 / 逐页截图）。PPTX 复用同一套版面数值（fit:shrink 替代
 * DOM 测量，见 export-renderer）。
 *
 * 本地化差异（相对 client 副本）：
 * - 块级字体栈补 'Microsoft YaHei','Noto Sans CJK SC' 回退（Windows headless
 *   未必装 Noto，保证中文确定性渲染）；
 * - fetchImageAsDataUri（http-only）不平移——本地素材经 fileToDataUri 直读。
 */

export const SLIDE_WIDTH = 1280
export const SLIDE_HEIGHT = 720
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

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

/** 版面解析（content.pages → 定坐标块；非法结构抛错——数据源为契约数据） */
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
            `font-family:${escapeAttr(JSON.stringify(block.fontFamily))},'Microsoft YaHei','Noto Sans CJK SC',sans-serif`
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

/** 渲染视图全局样式（@page 供 PDF 分页；viewport 供逐页截图） */
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

/** 完整渲染文档（headless 浏览器 setContent 消费） */
export function renderDocument(slides: SlideContent[], imageUrls: ReadonlyMap<string, string>): string {
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<style>${RENDER_STYLES}</style></head>` +
    `<body><div id="render-root">${slidesHtml(slides, imageUrls)}</div></body></html>`
  )
}

/**
 * 独立 HTML 预览（键盘翻页放映；本地浏览器打开）。
 * W2（ADR-018）：自 export-renderer.ts 迁入——本文件为**零 node 依赖单一源**，
 * web 浏览器侧经 TS 路径别名直接消费（禁 import export-renderer）。
 */
export function previewDocument(
  deckName: string,
  slides: SlideContent[],
  imageUrls: ReadonlyMap<string, string>,
): string {
  const body = renderDocument(slides, imageUrls)
  const inner = body.slice(body.indexOf('<body>') + 6, body.indexOf('</body>'))
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<title>${escapeText(deckName)} · deck-loop 预览</title><style>${RENDER_STYLES}` +
    `html,body{height:100%;background:#111}body{display:flex;align-items:center;justify-content:center;overflow:hidden}` +
    `#render-root{transform-origin:center center}.slide{display:none}.slide.active{display:block}` +
    `#hud{position:fixed;right:16px;bottom:12px;color:#9ca3af;font:12px/1.4 system-ui;user-select:none}` +
    `</style></head><body>${inner}<div id="hud"></div>` +
    `<script>(function(){var slides=[].slice.call(document.querySelectorAll('.slide'));var i=0;` +
    `var hud=document.getElementById('hud');` +
    `function fit(){var s=Math.min(innerWidth/${SLIDE_WIDTH},innerHeight/${SLIDE_HEIGHT});` +
    `document.getElementById('render-root').style.transform='scale('+s+')';}` +
    `function show(n){i=Math.max(0,Math.min(slides.length-1,n));` +
    `slides.forEach(function(el,k){el.classList.toggle('active',k===i);});` +
    `hud.textContent=(i+1)+' / '+slides.length+' · ←→ 翻页 · F 全屏';}` +
    `addEventListener('keydown',function(e){` +
    `if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(i+1);` +
    `else if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);` +
    `else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);` +
    `else if(e.key==='f'||e.key==='F'){document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();}});` +
    `addEventListener('resize',fit);fit();show(0);})();</script></body></html>`
  )
}

/** HTML 文本转义（previewDocument 标题等纯文本插入点；与 escapeHtml 同口径） */
export function escapeText(value: string): string {
  return escapeHtml(value)
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