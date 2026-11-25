/**
 * deliver 模块共享契约：字典 key、状态常量、呈现层颜色映射、VO 类型、下载链路工具。
 *
 * 字段来源：api-delivery.md §4.4（list/download-ticket/download）、
 * PageSpec delivery.md §3/§4、枚举池 ExportFormat/ExportStatus。
 *
 * ADR-018：网站仅下载已导出产物——新导出由 MCP export_deck 触发（本地 headless
 * 渲染→upload 回传），网站无 submit/cancel/retry/渲染器（ADR-015/018 红线）。
 * ExportFormat/ExportStatus 展示文案一律走字典（deliver.dictBatch）。
 */
import { message } from 'ant-design-vue'

import { API_BASE_URL, executeAction, getAction, rawAxios, registerDictColorMap } from '@/engine'
import type { RowWithOperList } from '@/engine'

// ---------------------------------------------------------------
// 字典 key（PageSpec delivery.md §3；POST /deliver/dict/batch keys 原样上送）
// ---------------------------------------------------------------

export const DELIVER_DICT_FORMAT = 'exportFormat'
export const DELIVER_DICT_STATUS = 'exportStatus'

/** ExportFormat 枚举值（api-delivery.md §4.1 DDL 注释 PDF/IMAGES/PPTX） */
export const EXPORT_FORMAT = {
  PDF: 'PDF',
  IMAGES: 'IMAGES',
  PPTX: 'PPTX',
} as const

/** ExportStatus 枚举值（api-delivery.md §4.2 状态模型；仅驱动交互判断） */
export const EXPORT_STATUS = {
  QUEUED: 'QUEUED',
  RENDERING: 'RENDERING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

/**
 * deliver.ExportStatus 呈现层 Tag 颜色（PageSpec delivery.md §3：
 * QUEUED gray / RENDERING blue（历史兼容）/ SUCCEEDED green / FAILED red / CANCELLED gray）。
 */
export function registerDeliverDictColors(): void {
  registerDictColorMap('deliver', {
    [DELIVER_DICT_STATUS]: {
      QUEUED: 'default',
      RENDERING: 'blue',
      SUCCEEDED: 'green',
      FAILED: 'red',
      CANCELLED: 'default',
    },
  })
}

// ---------------------------------------------------------------
// VO 契约（api-delivery.md §4.4）
// ---------------------------------------------------------------

/** export/list 行 VO（含 operList；网站仅消费 download，§4.4） */
export interface ExportListRow extends RowWithOperList {
  exportId: string
  exportCode: string
  deckId: string
  deckName: string
  versionSeq: number | null
  exportFormat: string
  exportStatus: string
  fileSize: number | null
  createdTime: string
  /** 呈现层派生列：v{seq} */
  versionSeqText?: string
  /** 呈现层派生列：KB/MB 格式化 */
  fileSizeText?: string
  /** 呈现层派生列：字典 label + PPTX beta 标（§3） */
  exportFormatName?: string
}

/** download-ticket VO（url + expiresIn；token 形态兼容） */
export interface DownloadTicketVO {
  url?: string
  token?: string
  expiresIn?: number
}

// ---------------------------------------------------------------
// 下载链路（ticket → GET 文件流；PageSpec delivery.md §4.4 失败自动重换一次）
// ---------------------------------------------------------------

export interface ExportFilePayload {
  blob: Blob
  filename: string
}

/**
 * 换 ticket 并 GET 文件流。业务失败（凭证过期等）可能以 JSON 信封 200 返回，
 * responseType: blob 下信封解包不生效——按 blob.type 兜底识别为失败，交由上层重试。
 */
async function fetchExportFile(exportId: string): Promise<ExportFilePayload> {
  const ticket = await executeAction<DownloadTicketVO>('deliver.downloadTicket', {
    exportId,
  })
  const href = resolveDownloadHref(exportId, ticket ?? {})
  const resp = await rawAxios().get<Blob>(href, { responseType: 'blob' })
  const blob = resp.data
  if (!blob || blob.type.includes('application/json')) {
    throw new Error('EXPORT_DOWNLOAD_REJECTED')
  }
  return {
    blob,
    filename: filenameFromDisposition(readDisposition(resp.headers)),
  }
}

/**
 * 组装下载地址：ticket.url 优先（相对路径补 API 基址，与 axios baseURL 同规约）；
 * 未回 url 时按 GET download 契约（?exportId=&token=）自拼，路径取自注册表 action。
 */
function resolveDownloadHref(exportId: string, ticket: DownloadTicketVO): string {
  const url = typeof ticket.url === 'string' ? ticket.url.trim() : ''
  if (url) {
    if (/^https?:\/\//i.test(url)) return url
    const path = url === '/api' || url.startsWith('/api/') ? url.slice(4) : url
    return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`
  }
  const actionPath = getAction('deliver.exportDownload')?.path ?? '/deliver/export/download'
  const base = `${API_BASE_URL}${actionPath.startsWith('/') ? '' : '/'}${actionPath}`
  const token = typeof ticket.token === 'string' ? ticket.token : ''
  return `${base}?exportId=${encodeURIComponent(exportId)}&token=${encodeURIComponent(token)}`
}

function readDisposition(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const v = (headers as unknown as Record<string, unknown>)['content-disposition']
  return typeof v === 'string' ? v : undefined
}

/** 从 Content-Disposition 解析附件名（filename* UTF-8 优先；失败回退空串） */
export function filenameFromDisposition(disposition: string | undefined): string {
  if (!disposition) return ''
  const utf8 = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^["']|["']$/g, ''))
    } catch {
      // 脏编码回退 plain 匹配
    }
  }
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)
  return plain?.[1]?.trim() ?? ''
}

/** 触发浏览器另存（a[href] + download；文件名由后端 Content-Disposition 定） */
function triggerBlobSave(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 下载一条导出记录（PageSpec delivery.md §4.4：失败自动重换 ticket 一次，
 * 再失败提示重新下载）。
 */
export async function downloadExportRow(row: ExportListRow): Promise<void> {
  const fallbackName = row.exportCode || `export-${row.exportId}`
  try {
    const file = await fetchExportFile(row.exportId)
    triggerBlobSave(file.blob, file.filename || fallbackName)
    return
  } catch {
    // 凭证过期/瞬时失败：自动重换 ticket 重试一次
  }
  try {
    const file = await fetchExportFile(row.exportId)
    triggerBlobSave(file.blob, file.filename || fallbackName)
  } catch {
    message.error('下载失败，请重新下载')
  }
}

// ---------------------------------------------------------------
// 呈现层格式化
// ---------------------------------------------------------------

/** fileSize 字节 → B/KB/MB/GB 展示（PageSpec §4.3 KB/MB 格式化；空值 '-'） */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(Number(bytes))) return '-'
  const n = Number(bytes)
  if (n <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  const text = i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1)
  return `${text} ${units[i]}`
}