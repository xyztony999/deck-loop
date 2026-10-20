/**
 * 大纲纯函数（gen 向导保存链路；api-generation.md §4.4 outline/save 契约）。
 *
 * pageHint 契约为整数（服务端 OutlineNodeAO @IsInt「页数提示：建议占页数」，
 * MOCK 渠道产物即为 number）。历史客户端曾按自由文本处理该字段，加载与
 * 保存路径统一经 normalizePageHint 清洗，旧数据形态不得击穿保存链路
 * （2026-10-20 教训：pageHint 为 number 时 .trim() 抛 TypeError，
 * beforeNext 未捕获 → 向导「下一步」静默卡死）。
 */

/** 大纲节点（api-generation.md §4.3 outline/save AO） */
export interface OutlineNode {
  nodeId: string
  /** ≤50 字（INV 校验：节点 1~50、title ≤50） */
  title: string
  /** 要点列表（编辑态按行拆分，保存前过滤空行） */
  points: string[]
  note?: string
  /** 页数提示（该节点建议占页数，整数） */
  pageHint?: number
}

/** 节点数上限（INV：节点 1~50） */
export const OUTLINE_NODE_MAX = 50
/** 节点标题字数上限 */
export const OUTLINE_TITLE_MAX = 50

/**
 * pageHint 清洗：数字/纯数字串 → ≥1 整数；空串/null/undefined/非法 → undefined。
 * 容忍 number（契约形态与 MOCK 产物）与数字串（InputNumber 中间态）。
 */
export function normalizePageHint(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : undefined
}

/** 落盘前清洗：标题/要点/备注去空白、过滤空要点、pageHint 归一为契约整数 */
export function sanitizeOutline(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.map((n) => ({
    nodeId: n.nodeId,
    title: n.title.trim(),
    points: (n.points ?? []).map((p) => p.trim()).filter((p) => p !== ''),
    note: (n.note ?? '').trim(),
    pageHint: normalizePageHint(n.pageHint),
  }))
}

/** 大纲校验（api-generation §4.4 outline/save：节点 1~50、title ≤50） */
export function validateOutline(nodes: OutlineNode[]): string | null {
  if (nodes.length === 0) return '大纲不能为空，请先生成或添加节点'
  if (nodes.length > OUTLINE_NODE_MAX) return `大纲节点最多 ${OUTLINE_NODE_MAX} 个`
  for (const n of nodes) {
    if (n.title.trim() === '') return '存在未填写标题的节点'
    if (n.title.length > OUTLINE_TITLE_MAX) return `节点标题不能超过 ${OUTLINE_TITLE_MAX} 字`
  }
  return null
}
