import type { OutlineNodeAO } from './deck.dto';

/**
 * 大纲节点树序列化（Deck.draft_outline 持久化形态；原 generation.service
 * serializeOutline 逐字平移，ADR-018 outline-save 迁 deck 域，api-web-agent §4.3）：
 * nodeId 空按序补全 n1/n2/...；points 剔空白；note/pageHint 可空不落 null 键。
 *
 * 顶层为节点数组（v1 draft_outline JSON 平移；deck 域 updateDraftOutline 契约签名
 * 为 Record 容器（Mixed 嵌入），此处经收窄转换适配——NR-01 escape：deck 契约冻结
 * 不可改，运行时 Mixed 存储数组合法，读取侧（detail VO/getVersionContent）原样透出。
 */
export function serializeOutline(nodes: OutlineNodeAO[]): Record<string, unknown> {
  const tree: Record<string, unknown>[] = nodes.map((node, index) => {
    const json: Record<string, unknown> = {
      nodeId: node.nodeId == null || node.nodeId.trim().length === 0 ? `n${index + 1}` : node.nodeId,
      title: node.title,
      points: (node.points ?? []).filter((p) => p != null && p.trim().length > 0),
    };
    if (node.note != null && node.note.trim().length > 0) {
      json['note'] = node.note;
    }
    if (node.pageHint != null) {
      json['pageHint'] = node.pageHint;
    }
    return json;
  });
  return tree as unknown as Record<string, unknown>;
}