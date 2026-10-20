/**
 * 版本内容预览组合式（adjust 模块）。
 *
 * - ver.version/detail 拉取版本全量 detail（含 content 页面树快照）；
 * - 图片块经 OHS 素材文件签发（POST /asset/asset/file-url，action 注册为
 *   adjust.assetFileUrl）批量换取限时 URL，assetId → url 映射响应式填充；
 * - content 为宽松 JSON（后端快照），此处在边界处归一为强类型页面树，
 *   脏数据静默降级为空页（预览不因个别块缺失而崩）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { executeAction } from '@/engine'
import { mapBatches } from '@/services/batches'
import type { VersionBlock, VersionDetailVO, VersionPage } from '../types'

// ---------------------------------------------------------------
// 归一化（宽松 JSON → 强类型页面树）
// ---------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/** content JSON → 页面树（api-version.md §4.1 契约） */
export function normalizeVersionPages(raw: unknown): VersionPage[] {
  const root = asRecord(raw)
  const pagesRaw = Array.isArray(root?.pages) ? (root?.pages as unknown[]) : []
  const pages: VersionPage[] = []
  for (const p of pagesRaw) {
    const page = asRecord(p)
    const pageId = firstString(page?.pageId)
    if (!page) continue
    const blocksRaw = Array.isArray(page.blocks) ? (page.blocks as unknown[]) : []
    const blocks: VersionBlock[] = []
    for (const b of blocksRaw) {
      const block = asRecord(b)
      const blockId = firstString(block?.blockId)
      const blockType = firstString(block?.blockType)
      if (!block || !blockId || !blockType) continue
      if (blockType !== 'TEXT' && blockType !== 'IMAGE' && blockType !== 'PLACEHOLDER') {
        continue
      }
      blocks.push({
        blockId,
        blockType,
        text: firstString(block.text),
        assetId: firstString(block.assetId),
        style: asRecord(block.style) ?? undefined,
      })
    }
    pages.push({
      pageId: pageId ?? `page-${pages.length + 1}`,
      layout: firstString(page.layout),
      title: firstString(page.title),
      note: firstString(page.note),
      blocks,
    })
  }
  return pages
}

/** 收集图片块引用的 assetId（去重） */
export function collectAssetIds(pages: VersionPage[]): string[] {
  const ids = new Set<string>()
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.blockType === 'IMAGE' && block.assetId) ids.add(block.assetId)
    }
  }
  return [...ids]
}

/**
 * 批量签发素材限时 URL（OHS POST /asset/asset/file-url）。
 *
 * TODO 请确认：api-assets.md §5.1 仅给出端点，AO/VO 未逐字段定义——
 * 此处按批量语义上送 { assetIds } 并对 [{assetId,fileUrl}] /
 * { assetId: url } 映射两形态兼容归一，后端契约定稿后收紧。
 */
export async function signAssetFileUrls(
  assetIds: string[],
): Promise<Record<string, string>> {
  if (assetIds.length === 0) return {}
  const result: Record<string, string> = {}
  try {
    const batches = await mapBatches([...new Set(assetIds)], 50, async (batch) => {
      // Keep each response intact, including compatibility map responses.
      return [await executeAction<unknown>('adjust.assetFileUrl', { assetIds: batch })]
    })
    for (const data of batches) {
      if (Array.isArray(data)) {
        for (const item of data) {
          const rec = asRecord(item)
          const assetId = firstString(rec?.assetId)
          const url = firstString(rec?.fileUrl, rec?.url, rec?.assetUrl)
          if (assetId && url) result[assetId] = url
        }
      } else {
        const map = asRecord(data)
        if (map) {
          for (const [assetId, url] of Object.entries(map)) {
            if (typeof url === 'string' && url !== '') result[assetId] = url
          }
        }
      }
    }
  } catch {
    // 签发失败静默降级：画布图片块展示占位态，不阻塞文本预览
  }
  return result
}

// ---------------------------------------------------------------
// 组合式（单实例绑定一个「正在预览的版本」）
// ---------------------------------------------------------------

export interface UseVersionContentReturn {
  detail: Ref<VersionDetailVO | null>
  loading: Ref<boolean>
  pages: ComputedRef<VersionPage[]>
  fileUrls: Ref<Record<string, string>>
  /** 版本头标签：v{seq} · branch（回显/基线只读展示用） */
  versionLabel: ComputedRef<string>
  load(versionId: string): Promise<void>
  clear(): void
}

export function useVersionContent(): UseVersionContentReturn {
  const detail = ref<VersionDetailVO | null>(null)
  const loading = ref(false)
  const fileUrls = ref<Record<string, string>>({})

  const pages = computed(() => normalizeVersionPages(detail.value?.content))

  const versionLabel = computed(() => {
    const d = detail.value
    if (!d) return ''
    return `v${d.versionSeq} · ${d.branchName}`
  })

  async function load(versionId: string): Promise<void> {
    if (!versionId) return
    loading.value = true
    try {
      detail.value = await executeAction<VersionDetailVO>('ver.versionDetail', {
        versionId,
      })
      // 图片块限时 URL 批量签发（签发失败静默：图片占位展示）
      const urls = await signAssetFileUrls(collectAssetIds(pages.value))
      fileUrls.value = urls
    } finally {
      loading.value = false
    }
  }

  function clear(): void {
    detail.value = null
    fileUrls.value = {}
  }

  return { detail, loading, pages, fileUrls, versionLabel, load, clear }
}
