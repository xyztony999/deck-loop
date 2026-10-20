/**
 * assets 模块共享契约：字典 key、枚举常量、呈现层颜色映射、行/VO 类型、
 * 话术占位符校验（INV-21）、素材文件大小格式化、OHS 限时 URL 签发。
 *
 * 字段来源：api-assets.md §4.1（dl_asset / dl_brand_kit / dl_prompt_template
 * DDL 与字段表）、§4.4（list 行 VO / upload VO / 接口 AO）、§5.1（OHS）；
 * 枚举值来源：DDL 注释与 PageSpec assets.md §3/§6（IMAGE/LOGO、
 * ACTIVE/DISABLED、WHOLE/TARGETED）——仅用于状态守卫派生，字典选项
 * 一律来自后端 /asset/dict/batch（禁止硬编码 options）。
 */
import { executeAction, getAction, registerDictColorMap } from '@/engine'
import type { RowWithOperList } from '@/engine'

// ---------------------------------------------------------------
// 字典 key（PageSpec assets.md §3；POST /asset/dict/batch keys 原样上送）
// ---------------------------------------------------------------

export const ASSET_DICT_TYPE = 'asset.AssetType'
export const ASSET_DICT_STATUS = 'asset.AssetStatus'
export const ASSET_DICT_SCENE = 'asset.TemplateScene'

/** AssetType 枚举值（api-assets.md §4.1 DDL 注释 'IMAGE/LOGO'） */
export const ASSET_TYPE = {
  IMAGE: 'IMAGE',
  LOGO: 'LOGO',
} as const

/** AssetStatus 枚举值（启停生命周期，api-assets.md §4.2） */
export const ASSET_STATUS = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const

/**
 * asset.AssetStatus 呈现层 Tag 颜色（PageSpec assets.md §3：
 * ACTIVE green / DISABLED gray）。registerDictColorMap 幂等合并。
 */
export function registerAssetDictColors(): void {
  registerDictColorMap('asset', {
    [ASSET_DICT_STATUS]: {
      ACTIVE: 'green',
      DISABLED: 'default',
    },
  })
}

// ---------------------------------------------------------------
// 上传限制（INV-19/INV-20，api-assets.md §4.1）
// ---------------------------------------------------------------

/** 单文件上限 10MB */
export const ASSET_UPLOAD_MAX_SIZE_MB = 10
export const ASSET_UPLOAD_MAX_SIZE = ASSET_UPLOAD_MAX_SIZE_MB * 1024 * 1024

/** 允许类型 jpg/png/svg/webp（INV-19）；扩展名 + MIME 双口径校验 */
export const ASSET_UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.svg,.webp'
const ASSET_UPLOAD_EXTS = ['.jpg', '.jpeg', '.png', '.svg', '.webp']
const ASSET_UPLOAD_MIMES = [
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
]

/** INV-19 前置校验：类型 + 大小；违例返回错误文案，通过返回 null */
export function validateUploadFile(file: File): string | null {
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
  const extOk = ASSET_UPLOAD_EXTS.includes(ext)
  const mimeOk = file.type === '' || ASSET_UPLOAD_MIMES.includes(file.type)
  if (!extOk || !mimeOk) {
    return `不支持的文件类型（仅 jpg / png / svg / webp）：${file.name}`
  }
  if (file.size > ASSET_UPLOAD_MAX_SIZE) {
    return `文件超过 ${ASSET_UPLOAD_MAX_SIZE_MB}MB 上限：${file.name}`
  }
  return null
}

/** 字段长度上限（api-assets.md §4.1 DDL） */
export const ASSET_NAME_MAX = 128
export const CATEGORY_MAX = 64
export const KIT_NAME_MAX = 50
export const PROMPT_TITLE_MAX = 50
export const PROMPT_CONTENT_MAX = 2000

/**
 * 预置字体清单（api-assets.md §1.2：字体文件上传不在范围，fonts 为预置
 * 清单下的字体名下拉）。非后端字典（/asset/dict/batch 仅 AssetType/
 * AssetStatus/TemplateScene 三 key），属 UI 常量，不构成字典硬编码。
 */
export const PRESET_FONTS = [
  '思源黑体',
  '思源宋体',
  '阿里巴巴普惠体',
  'HarmonyOS Sans',
  'MiSans',
  '霞鹜文楷',
] as const

/** 品牌规范辅色数量上限（PageSpec assets.md §5 colors.assistants ≤5） */
export const BRANDKIT_ASSISTANT_MAX = 5

// ---------------------------------------------------------------
// 上传 multipart 通道（action 注册表为唯一 URL 来源，经 postForm 发送）
// ---------------------------------------------------------------

/** 取素材上传接口路径（不含 /api 前缀，由 request 层 baseURL 承担） */
export function assetUploadPath(): string {
  const def = getAction('asset.assetUpload')
  if (!def) {
    throw new Error('[assets] action 未注册: asset.assetUpload')
  }
  return def.path
}

// ---------------------------------------------------------------
// 行 / VO 类型
// ---------------------------------------------------------------

/** 素材列表行 VO（api-assets.md §4.4 asset/list 行 VO） */
export interface AssetListRow extends RowWithOperList {
  assetId: string
  assetName: string
  /** 缩略图（上传响应即时返回；列表行 VO 同名限时 URL） */
  thumbnailUrl: string | null
  category: string | null
  assetType: string
  assetStatus: string
  /** 被引用计数（>0 锁定删除，INV-18/§4.4） */
  refCount: number
  fileSize: number
  updatedTime: string
}

/** 上传响应 VO（api-assets.md §4.4 upload：hash 命中不新建，duplicated=true） */
export interface AssetUploadVO {
  assetId: string
  assetUrl: string | null
  thumbnailUrl: string | null
  width: number | null
  height: number | null
  fileHash: string
  duplicated: boolean
}

/** 品牌规范 colors JSON 值对象（api-assets.md §4.1） */
export interface BrandKitColors {
  primary: string
  assistants: string[]
}

/** 品牌规范 fonts JSON 值对象（可空） */
export interface BrandKitFonts {
  title: string | null
  body: string | null
}

/** 品牌规范列表行 VO（列语义来自 PageSpec assets.md §5） */
export interface BrandKitRow extends RowWithOperList {
  brandKitId: string
  kitName: string
  colors: BrandKitColors | string | null
  fonts: BrandKitFonts | string | null
  logoAssetId: string | null
  /** 行 VO 冗余（列「logo（缩略）」展示用；后端未返回时回退 assetId） */
  logoAssetName?: string | null
  logoUrl?: string | null
  /** INT(1)/boolean 双口径防御读取（isDefaultOf 归一） */
  isDefault: number | boolean | null
  updatedTime: string
  /** 呈现层派生列（列表页载入后填充，deck 先例 currentVersionText） */
  colorsText?: string
  fontsText?: string
  logoText?: string
  isDefaultText?: string
}

/** 话术模板列表行 VO（PageSpec assets.md §6） */
export interface PromptRow extends RowWithOperList {
  templateId: string
  title: string
  content: string
  category: string | null
  templateScene: string
  useCount: number
  updatedTime: string
}

// ---------------------------------------------------------------
// 品牌规范 JSON 值对象归一（colors/fonts 后端为 JSON 列，防御字符串形态）
// ---------------------------------------------------------------

function parseMaybeJson<T>(value: T | string | null): T | null {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function colorsOf(row: BrandKitRow): BrandKitColors {
  const parsed = parseMaybeJson<BrandKitColors>(row?.colors ?? null)
  const primary =
    parsed && typeof parsed.primary === 'string' && parsed.primary !== ''
      ? parsed.primary
      : '#1677ff'
  const assistants = Array.isArray(parsed?.assistants)
    ? (parsed?.assistants ?? []).filter(
        (c): c is string => typeof c === 'string' && c !== '',
      )
    : []
  return { primary, assistants }
}

export function fontsOf(row: BrandKitRow): BrandKitFonts {
  const parsed = parseMaybeJson<BrandKitFonts>(row?.fonts ?? null)
  return {
    title: typeof parsed?.title === 'string' ? parsed.title : null,
    body: typeof parsed?.body === 'string' ? parsed.body : null,
  }
}

/** isDefault 归一（DDL INT(1) / VO boolean 双口径） */
export function isDefaultOf(row: BrandKitRow): boolean {
  return row?.isDefault === 1 || row?.isDefault === true
}

// ---------------------------------------------------------------
// 呈现层辅助
// ---------------------------------------------------------------

/** 素材文件大小格式化（PageSpec assets.md §4.3 fileSize 格式化） */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ---------------------------------------------------------------
// OHS 限时 URL 签发（api-assets.md §5.1；对 [{assetId,fileUrl}] 与
// { assetId: url } 两形态兼容归一，同 useVersionContent 先例）
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

/** 单素材限时 URL 签发（卡片大图预览）；失败返回 null 由调用方提示 */
export async function signAssetFileUrl(assetId: string): Promise<string | null> {
  try {
    const data = await executeAction<unknown>('asset.assetFileUrl', {
      assetIds: [assetId],
    })
    if (Array.isArray(data)) {
      for (const item of data) {
        const rec = asRecord(item)
        if (firstString(rec?.assetId) === assetId) {
          return firstString(rec?.fileUrl, rec?.url, rec?.assetUrl) ?? null
        }
      }
      return null
    }
    const map = asRecord(data)
    const url = map ? map[assetId] : undefined
    return typeof url === 'string' && url !== '' ? url : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------
// 话术占位符语法（INV-21：{名称}，≤10 处；未闭合实时校验）
// ---------------------------------------------------------------

export const PROMPT_PLACEHOLDER_MAX = 10

/** 校验结果：违例文案（null = 通过） */
export function validatePromptContent(content: string): string | null {
  let open = false
  let closed = 0
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') {
      if (open) return '占位符语法错误：出现嵌套的「{」'
      open = true
    } else if (ch === '}') {
      if (!open) return '占位符语法错误：存在未配对的「}」'
      open = false
      closed += 1
    }
  }
  if (open) return '占位符语法错误：存在未闭合的「{」'
  if (closed > PROMPT_PLACEHOLDER_MAX) {
    return `占位符最多 ${PROMPT_PLACEHOLDER_MAX} 处，当前 ${closed} 处`
  }
  return null
}

/** 提取已闭合占位符名列表（表单提示「可用占位符」） */
export function promptPlaceholders(content: string): string[] {
  const result: string[] = []
  const re = /\{([^{}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) != null) {
    result.push(m[1] as string)
  }
  return result
}

/** 高亮分段（表单实时预览：closed 蓝 / 未闭合与孤立红） */
export interface PromptSegment {
  text: string
  kind: 'plain' | 'closed' | 'open' | 'stray'
}

export function splitPromptSegments(content: string): PromptSegment[] {
  const segments: PromptSegment[] = []
  let buf = ''
  let open = false
  const flush = (kind: PromptSegment['kind'] = 'plain'): void => {
    if (buf !== '') segments.push({ text: buf, kind })
    buf = ''
  }
  for (const ch of content) {
    if (ch === '{') {
      if (open) {
        flush('open') // 嵌套 {：连同前一个未闭合段按 open 提示
        buf = ''
      } else {
        flush()
      }
      open = true
      buf += ch
    } else if (ch === '}') {
      if (open) {
        buf += ch
        flush('closed')
        open = false
      } else {
        flush()
        segments.push({ text: ch, kind: 'stray' })
      }
    } else {
      buf += ch
    }
  }
  flush(open ? 'open' : 'plain')
  return segments
}
