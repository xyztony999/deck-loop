/**
 * deliver 模块共享契约：字典 key、状态常量、呈现层颜色映射、VO 类型、
 * 导出提交（needConfirm 语义）与下载链路工具。
 *
 * 字段来源：api-delivery.md §4.4（submit/list/download/present-data）、
 * PageSpec delivery.md §3/§4/§7、枚举池 ExportFormat/ExportStatus。
 *
 * ExportFormat/ExportStatus 的展示文案一律走字典（deliver.dictBatch），
 * 此处仅保留驱动前端交互的枚举值与呈现层配色（契约常量，非展示文案）。
 */
import { Modal, message } from 'ant-design-vue'
import { submitWithConfirmation } from '@/services/exportSubmit'
import {
  ExportFormatCode,
  renderDeckArtifact,
  reportRenderFailure,
  uploadArtifact,
} from '@/services/exportRender'

import { executeAction, getAction, rawAxios, registerDictColorMap } from '@/engine'
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
 * QUEUED gray / RENDERING blue / SUCCEEDED green / FAILED red / CANCELLED gray）。
 * registerDictColorMap 幂等合并，重复调用安全。
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

/** export/list 行 VO（含 operList：download/cancel/retry，§4.4） */
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
  /** 呈现层派生列（列表页载入后填充）：v{seq} */
  versionSeqText?: string
  /** 呈现层派生列（列表页载入后填充）：KB/MB 格式化 */
  fileSizeText?: string
  /** 呈现层派生列（列表页载入后填充）：字典 label + PPTX beta 标（§3） */
  exportFormatName?: string
}

/** export/submit VO（exportId/exportStatus；PPTX 首次响应 needConfirm=true） */
export interface ExportSubmitVO {
  exportId?: string
  exportStatus?: string
  /** PPTX beta 提示态：confirm=true 才受理（api-delivery.md §4.4） */
  needConfirm?: boolean
}

/** download-ticket VO（url + expiresIn；token 形态兼容） */
export interface DownloadTicketVO {
  /** 限时下载地址（相对 /deliver/export/download?... 或绝对 URL） */
  url?: string
  /** 凭证串（ticket 未回 url 时按 GET 契约自拼 query） */
  token?: string
  /** 凭证有效期（秒，30min） */
  expiresIn?: number
}

/** present/data VO（api-delivery.md §4.4：pages 为渲染就绪结构，边界处归一） */
export interface PresentDataVO extends Record<string, unknown> {
  deckName?: string
  finalVersionSeq?: number | null
  pages?: unknown
}

// ---------------------------------------------------------------
// 导出提交（needConfirm 回执语义，弹层与行内 retry 共用）
// ---------------------------------------------------------------

/**
 * 发起导出任务（ADR-015 客户端渲染全链，PageSpec delivery.md §4.2/§5）：
 * 提交（needConfirm 确认流）→ 本地渲染（隐藏窗口，进度反馈）→ 产物回传 →
 * SUCCEEDED。本地渲染失败自动经 export/fail 上报后抛错；取消确认不建任务。
 */
export async function submitExportTask(
  deckId: string,
  exportFormat: string,
): Promise<boolean> {
  // holder 规避 TS 对闭包内赋值的流式收窄（accepted 会被推为 never）
  const holder: { vo: ExportSubmitVO | null } = { vo: null }
  const acceptedSubmit = submitWithConfirmation(
    exportFormat,
    (confirm) =>
      executeAction<ExportSubmitVO>('deliver.exportSubmit', {
        deckId,
        exportFormat,
        ...(confirm ? { confirm: true } : {}),
      }).then((vo) => {
        if (vo?.exportId) {
          holder.vo = vo
        }
        return vo
      }),
    confirmPptxBeta,
  )
  if (!(await acceptedSubmit) || !holder.vo?.exportId) {
    return false
  }
  const exportId = holder.vo.exportId

  const progressKey = 'dl-export-progress'
  const progress = (text: string): void => {
    message.open({ key: progressKey, type: 'loading', content: text, duration: 0 })
  }
  const dismiss = (): void => {
    message.destroy(progressKey)
  }
  try {
    const artifact = await renderDeckArtifact(
      deckId,
      exportFormat as ExportFormatCode,
      (p) => progress(p.message),
    )
    progress('回传产物…')
    await uploadArtifact(exportId, artifact)
    dismiss()
    message.success('导出完成')
    return true
  } catch (err) {
    dismiss()
    await reportRenderFailure(exportId, err instanceof Error ? err.message : String(err))
    message.error(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

function confirmPptxBeta(): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: 'PPTX 导出为 beta 能力',
      content:
        'PPTX 导出处于 beta 阶段，版式与动画还原可能存在偏差。确认继续导出？',
      okText: '继续导出',
      cancelText: '取消',
      maskClosable: false,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

// ---------------------------------------------------------------
// 下载链路（ticket → GET 文件流；PageSpec delivery.md §7 失败自动重换一次）
// ---------------------------------------------------------------

export interface ExportFilePayload {
  blob: Blob
  filename: string
}

/**
 * 换 ticket 并 GET 文件流。
 *
 * 业务失败（凭证过期等）可能以 JSON 信封 200 返回，responseType: blob 下
 * 信封解包不生效——按 blob.type 兜底识别为失败，交由上层重试。
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
 * 组装下载地址：ticket.url 优先（相对路径补 /api 前缀，与 axios baseURL
 * 同规约）；未回 url 时按 GET download 契约（?exportId=&token=）自拼，
 * 路径取自注册表 action（不重复硬编码 URL）。
 */
function resolveDownloadHref(exportId: string, ticket: DownloadTicketVO): string {
  const url = typeof ticket.url === 'string' ? ticket.url.trim() : ''
  if (url) {
    if (/^https?:\/\//i.test(url)) return url
    return url.startsWith('/api') ? url : `/api${url.startsWith('/') ? '' : '/'}${url}`
  }
  const base = getAction('deliver.exportDownload')?.path ?? '/deliver/export/download'
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
 * 下载一条导出记录（PageSpec delivery.md §7：失败自动重换 ticket 一次，
 * 再失败提示重新下载）。
 */
export async function downloadExportRow(row: ExportListRow): Promise<void> {
  const fallbackName = row.exportCode || `export-${row.exportId}`
  try {
    const file = await fetchExportFile(row.exportId)
    triggerBlobSave(file.blob, file.filename || fallbackName)
    return
  } catch {
    // 凭证过期/瞬时失败：自动重换 ticket 重试一次（§7）
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
