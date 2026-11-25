/**
 * headless 导出渲染器（ADR-017 Phase 2）。
 *
 * ADR-015 删服务端 headless 的理由是 VPS 1GB OOM；本渲染器跑在用户本地桌面
 * （MCP 进程），不冲突，且换来跨平台。三格式同源 render-template 版面：
 * - PDF：系统 Edge（playwright-core channel msedge，免浏览器下载）打印分页；
 * - IMAGES：逐页 .slide 元素截图 + JSZip；
 * - PPTX：pptxgenjs 可编辑文本层，fit:shrink 替代 client DOM 测量字号（beta）。
 *
 * 素材：本地文件直读 → data URI（无 HTTP 签名链路）。
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {
  MAX_IMAGE_BYTES,
  RENDER_STYLES,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  renderDocument,
  type SlideContent,
} from './render-template';

export interface RenderedArtifact {
  bytes: Buffer;
  extension: 'pdf' | 'zip' | 'pptx';
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** 本地素材文件 → data URI（INV-19 同口径 10MB 上限） */
export async function fileToDataUri(filePath: string): Promise<string> {
  const mime = MIME_BY_EXT[extname(filePath).slice(1).toLowerCase()];
  if (mime == null) {
    throw new Error(`图片格式不支持: ${filePath}`);
  }
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('图片素材超过10MB');
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** 启动 headless 浏览器（优先系统 Edge；无 Edge 回退默认 chromium——需已安装） */
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

/** PDF / IMAGES（headless 浏览器） */
export async function renderBrowserArtifact(
  format: 'PDF' | 'IMAGES',
  slides: SlideContent[],
  imageUrls: ReadonlyMap<string, string>,
): Promise<RenderedArtifact> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
    });
    await page.setContent(renderDocument(slides, imageUrls), { waitUntil: 'networkidle' });
    await page.evaluate('document.fonts.ready');

    if (format === 'PDF') {
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
      });
      return { bytes: Buffer.from(pdf), extension: 'pdf' };
    }

    const zip = new JSZip();
    const sections = page.locator('.slide');
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const png = await sections.nth(i).screenshot({ type: 'png' });
      zip.file(`slide-${String(i + 1).padStart(3, '0')}.png`, png);
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { bytes, extension: 'zip' };
  } finally {
    await browser.close();
  }
}

/**
 * PPTX（pptxgenjs 可编辑文本层；平移 client exportRender.buildPptx 版面数值，
 * DOM 测量字号 → parseSlides 默认字号 + fit:shrink；默认字体映射 Microsoft YaHei
 * 保证 Windows PowerPoint 中文显示）。
 */
export async function renderPptxArtifact(
  slides: SlideContent[],
  imageUrls: ReadonlyMap<string, string>,
): Promise<RenderedArtifact> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DECK', width: SLIDE_WIDTH / 96, height: SLIDE_HEIGHT / 96 });
  pptx.layout = 'DECK';
  pptx.author = 'Deck-Loop';

  const fontFaceOf = (family: string): string =>
    family === 'Noto Sans CJK SC' ? 'Microsoft YaHei' : family;

  for (const slide of slides) {
    const target = pptx.addSlide();
    target.background = { color: slide.background };
    target.addText(slide.title, {
      x: 64 / 96,
      y: 36 / 96,
      w: 1152 / 96,
      h: 76 / 96,
      fontFace: 'Microsoft YaHei',
      fontSize: 42 * 0.75,
      bold: true,
      margin: 0,
      breakLine: false,
      fit: 'shrink',
    });
    for (const block of slide.blocks) {
      const position = { x: block.x / 96, y: block.y / 96, w: block.w / 96, h: block.h / 96 };
      if (block.kind === 'IMAGE') {
        const dataUri = imageUrls.get(block.assetId);
        if (!dataUri) throw new Error(`图片素材不可用: ${block.assetId}`);
        target.addImage({ ...position, data: dataUri });
      } else {
        target.addText(block.text, {
          ...position,
          color: block.color,
          fontFace: fontFaceOf(block.fontFamily),
          fontSize: block.fontSize * 0.75,
          margin: 0,
          valign: 'top',
          align: block.align,
          fit: 'shrink',
        });
      }
    }
    if (slide.note) {
      target.addNotes(slide.note);
    }
  }

  const output = await pptx.write({ outputType: 'uint8array' });
  if (!(output instanceof Uint8Array)) {
    throw new Error('PPTX 渲染未返回二进制');
  }
  return { bytes: Buffer.from(output), extension: 'pptx' };
}

/** 独立 HTML 预览（键盘翻页放映，替代 Tauri 放映；本地浏览器打开） */
export function previewDocument(
  deckName: string,
  slides: SlideContent[],
  imageUrls: ReadonlyMap<string, string>,
): string {
  const body = renderDocument(slides, imageUrls);
  const inner = body.slice(body.indexOf('<body>') + 6, body.indexOf('</body>'));
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
  );
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}