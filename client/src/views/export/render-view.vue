<script setup lang="ts">
/**
 * 导出渲染视图（ADR-015：隐藏窗口 /export-render，bare 路由）。
 *
 * 主窗口编排（services/exportRender.ts）经 localStorage 通道驱动：
 * - payload_v1（主→本窗）：{ html } 全量幻灯片 HTML；
 * - status_v1（本窗→主）：ready/error + 收缩后字号测量值（PPTX 复用）；
 * - scroll_v1（主→本窗）：{ top } 逐页截图滚动定位；scrolled_v1 回执。
 * 同源多窗口共享 localStorage + storage 事件（Tauri WebView2 同 profile）。
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { RENDER_STYLES } from './render-template'

const PAYLOAD_KEY = 'dl_export_render_payload_v1'
const STATUS_KEY = 'dl_export_render_status_v1'
const SCROLL_KEY = 'dl_export_render_scroll_v1'
const SCROLLED_KEY = 'dl_export_render_scrolled_v1'

function writeStatus(state: 'ready' | 'error', extra?: Record<string, unknown>): void {
  localStorage.setItem(
    STATUS_KEY,
    JSON.stringify({ state, at: Date.now(), ...extra }),
  )
}

function onStorage(event: StorageEvent): void {
  if (event.key !== SCROLL_KEY || event.newValue == null) return
  let top = 0
  try {
    top = Number((JSON.parse(event.newValue) as { top?: unknown }).top ?? 0)
  } catch {
    top = 0
  }
  window.scrollTo(0, top)
  localStorage.setItem(SCROLLED_KEY, JSON.stringify({ top, at: Date.now() }))
}

onMounted(() => {
  window.addEventListener('storage', onStorage)
  void (async () => {
    try {
      const payload = JSON.parse(localStorage.getItem(PAYLOAD_KEY) ?? 'null') as {
        html?: string
      } | null
      if (!payload || typeof payload.html !== 'string' || payload.html.length === 0) {
        throw new Error('渲染载荷缺失')
      }
      const style = document.createElement('style')
      style.textContent = RENDER_STYLES
      document.head.appendChild(style)

      const root = document.createElement('div')
      root.id = 'render-root'
      root.innerHTML = payload.html
      document.body.appendChild(root)

      // 版面就绪：字体加载 + 图片解码 + 文本字号自适应收缩（服务端模板同款算法）
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true })
                img.addEventListener('error', () => resolve(), { once: true })
              }),
        ),
      )
      shrinkTextBlocks()

      const measurements = collectMeasurements()
      writeStatus('ready', { measurements })
    } catch (error) {
      writeStatus('error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', onStorage)
})

/** 字号自适应：逐 .text 块收缩至可容纳（>10px 下限；仍溢出则报错拒绝产物） */
function shrinkTextBlocks(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.text'))) {
    let size = Number.parseFloat(getComputedStyle(el).fontSize)
    while (
      (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) &&
      size > 10
    ) {
      size -= 1
      el.style.fontSize = `${size}px`
    }
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      throw new Error('页面内容超出可读版面，请减少内容或调整布局')
    }
  }
}

/** 收缩后字号测量（PPTX 文本层复用；含每块页序与块序） */
function collectMeasurements(): Array<{ blockId: string; fontSize: number }> {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-block-id]')).map((el) => ({
    blockId: el.dataset.blockId ?? '',
    fontSize: Number.parseFloat(getComputedStyle(el).fontSize) || 0,
  }))
}
</script>

<template>
  <div class="export-render-view" aria-hidden="true">
    <!-- 渲染根节点由脚本注入（#render-root）；此处仅作挂载占位 -->
  </div>
</template>

<style scoped>
.export-render-view {
  min-height: 100vh;
}
</style>
