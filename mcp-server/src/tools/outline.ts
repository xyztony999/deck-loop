/**
 * 大纲纯函数（平移自 client/src/services/outline.ts + server generation.service
 * serializeOutline，ADR-017：agent 直写路径不经 generation 域，契约口径一致）。
 *
 * 契约（api-generation §4.3/§4.4）：节点 1~50、title ≤50、pageHint 整数；
 * draft_outline 持久化为**顶层节点数组**（nodeId 空按序补 n1/n2/...，
 * points 剔空白，note/pageHint 空不落键）。
 */

export interface OutlineNode {
  nodeId?: string;
  title: string;
  points?: string[];
  note?: string;
  pageHint?: number;
}

export const OUTLINE_NODE_MAX = 50;
export const OUTLINE_TITLE_MAX = 50;

/** pageHint 清洗（number/数字串 → ≥1 整数；非法 → undefined） */
export function normalizePageHint(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : undefined;
}

/** 大纲校验（返回错误消息；null=通过） */
export function validateOutline(nodes: OutlineNode[]): string | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return '大纲不能为空（nodes 1~50）';
  if (nodes.length > OUTLINE_NODE_MAX) return `大纲节点最多 ${OUTLINE_NODE_MAX} 个`;
  for (const n of nodes) {
    if (typeof n.title !== 'string' || n.title.trim() === '') return '存在未填写标题的节点';
    if (n.title.length > OUTLINE_TITLE_MAX) return `节点标题不能超过 ${OUTLINE_TITLE_MAX} 字`;
  }
  return null;
}

/** 落盘序列化（server serializeOutline 同口径：顶层数组，空键不落） */
export function serializeOutline(nodes: OutlineNode[]): Record<string, unknown> {
  const tree: Record<string, unknown>[] = nodes.map((node, index) => {
    const title = node.title.trim();
    const json: Record<string, unknown> = {
      nodeId:
        node.nodeId == null || node.nodeId.trim().length === 0 ? `n${index + 1}` : node.nodeId.trim(),
      title,
      points: (node.points ?? []).map((p) => String(p).trim()).filter((p) => p !== ''),
    };
    const note = (node.note ?? '').trim();
    if (note !== '') {
      json['note'] = note;
    }
    const pageHint = normalizePageHint(node.pageHint);
    if (pageHint !== undefined) {
      json['pageHint'] = pageHint;
    }
    return json;
  });
  return tree as unknown as Record<string, unknown>;
}