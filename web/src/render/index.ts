/**
 * 浏览器侧渲染入口（ADR-018 §4.6 / PageSpec preview.md §1/§3）。
 *
 * 经 TS 路径别名 `@render` 共享消费 mcp-server/src/render/render-template.ts
 * （纯 TS 零 node 依赖）——与 MCP headless 导出**同一排版模板**，所见即所得，
 * 单一源零复制零分叉。**严禁** import export-renderer.ts（含 playwright-core/
 * pptxgenjs/jszip 等 node 依赖，浏览器不可用）。
 *
 * 管线：version/detail → content → parseSlides → slidesHtml(slides, imageUrls)
 * → 画布/放映内框（文档表面永远白纸 --dl-doc-bg，1280×720 逻辑尺寸缩放适配）。
 */
export {
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  MAX_IMAGE_BYTES,
  RENDER_STYLES,
  parseSlides,
  slidesHtml,
  renderDocument,
  type SlideBlock,
  type SlideContent,
} from '@render/render-template'

import {
  parseSlides,
  renderDocument,
  slidesHtml,
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  type SlideContent,
} from '@render/render-template'

/** assetId → 签名 URL 映射（useVersionContent 批量签发结果）转渲染所需 ReadonlyMap */
export function toImageUrlMap(fileUrls: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(fileUrls))
}

/**
 * 单页幻灯片 HTML（画布/放映逐页渲染用）。
 *
 * slidesHtml 对缺失图片的 IMAGE 块会抛错（导出语义）；浏览器预览须容忍图片
 * 加载失败/未签发——此处对 IMAGE 块预检 imageUrls，缺失者降级为 PLACEHOLDER
 * 灰底标注（preview.md §3.4），保证预览不因个别素材缺失而整页崩。
 */
export function slideHtmlSafe(slide: SlideContent, imageUrls: ReadonlyMap<string, string>): string {
  const safe: SlideContent = {
    ...slide,
    blocks: slide.blocks.map((b) =>
      b.kind === 'IMAGE' && !imageUrls.get(b.assetId)
        ? { ...b, kind: 'PLACEHOLDER' as const, text: b.text || '图片素材加载中或不可用' }
        : b,
    ),
  }
  return slidesHtml([safe], imageUrls)
}

/** content JSON → 幻灯片数组（边界归一；非法结构抛错由调用方捕获展示失败态） */
export function contentToSlides(content: Record<string, unknown>): SlideContent[] {
  return parseSlides(content)
}

/**
 * 全屏放映 HTML（浏览器侧，PageSpec preview.md §5）。
 *
 * 排版完全取自共享 renderDocument（同一 RENDER_STYLES + slidesHtml，零复制）；
 * 本函数仅在隔离 iframe 文档内追加**放映 chrome 逻辑**（单页显示/键盘翻页/
 * 缩放适配/与父页 postMessage 桥），不改排版。letterbox 底色由父页舞台
 * （var(--dl-bg-page)）承担，iframe 文档背景透明，避免 chrome 域 hex 直写。
 *
 * 桥协议（iframe ↔ 父页）：
 * - iframe → 父：{source:'dl-present', type:'slide', index, total}（翻页同步备注/页码）
 *                {source:'dl-present', type:'exit'}（Esc 退出）
 *                {source:'dl-present', type:'toggleNotes'}（S 备注开关）
 * - 父 → iframe：{type:'nav', delta} / {type:'goto', index} / {type:'fullscreen'}
 *
 * 与 MCP previewDocument（B 阶段 W2 迁入 render-template.ts）语义一致：键盘
 * ←→/空格翻页、Home/End 首末页、F 全屏；父页另提供自动隐藏控制条与备注侧栏。
 */
export function buildPresentHtml(
  deckName: string,
  slides: SlideContent[],
  imageUrls: ReadonlyMap<string, string>,
): string {
  const doc = renderDocument(slides, imageUrls)
  const title = deckName.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
  const bridge =
    `<style>html,body{height:100%;background:transparent}` +
    `body{display:flex;align-items:center;justify-content:center;overflow:hidden}` +
    `#render-root{transform-origin:center center}.slide{display:none}.slide.active{display:block}</style>` +
    `<script>(function(){var slides=[].slice.call(document.querySelectorAll('.slide'));var i=0;` +
    `function fit(){var s=Math.min(innerWidth/${SLIDE_WIDTH},innerHeight/${SLIDE_HEIGHT});` +
    `document.getElementById('render-root').style.transform='scale('+s+')';}` +
    `function post(m){parent.postMessage(Object.assign({source:'dl-present'},m),'*');}` +
    `function show(n){i=Math.max(0,Math.min(slides.length-1,n));` +
    `slides.forEach(function(el,k){el.classList.toggle('active',k===i);});` +
    `post({type:'slide',index:i,total:slides.length});}` +
    `addEventListener('keydown',function(e){` +
    `if(e.ctrlKey||e.metaKey||e.altKey)return;` +
    `if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){show(i+1);e.preventDefault();}` +
    `else if(e.key==='ArrowLeft'||e.key==='PageUp'){show(i-1);e.preventDefault();}` +
    `else if(e.key==='Home'){show(0);e.preventDefault();}` +
    `else if(e.key==='End'){show(slides.length-1);e.preventDefault();}` +
    `else if(e.key==='f'||e.key==='F'){document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();}` +
    `else if(e.key==='s'||e.key==='S'){post({type:'toggleNotes'});}` +
    `else if(e.key==='Escape'){post({type:'exit'});}});` +
    `addEventListener('message',function(e){var m=e.data||{};` +
    `if(m.type==='nav')show(i+(m.delta||0));` +
    `else if(m.type==='goto')show(m.index||0);` +
    `else if(m.type==='fullscreen'){document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();}});` +
    `addEventListener('resize',fit);fit();show(0);})();</script>`
  return doc
    .replace('<meta charset="utf-8">', `<meta charset="utf-8"><title>${title} · deck-loop 放映</title>`)
    .replace('</body>', `${bridge}</body>`)
}