/**
 * 基线版本内容快照（dl_deck_version.content 嵌入 object）解析工具
 * （纯静态，无状态；v1 AdjustmentServiceImpl#resolveScope/findPage/findBlock 内联
 * JsonNode 解析的 TS 平移——**adjustment 域 ACL：不依赖 version 域实现内部工具，
 * 独立解析**，deliver 域 deliver.snapshot-support.ts 同先例）。
 *
 * content 契约（api-version §4.1 值对象，adjustment 域只读消费）：
 * `{ pages: [ { pageId, layout, title, note,
 *   blocks: [ { blockId, blockType: TEXT|IMAGE|PLACEHOLDER,
 *               text?, assetId?, style? } ] } ] }`
 * content 由 generation 域任务回调产出（系统数据而非用户输入），形状非法按
 * 基线无效快速失败（BASE_VERSION_INVALID 语义在 Service 层映射）；防御性读取
 * 对缺字段容错（空列表/空串）。
 */

/** 页面列表（content.pages；非数组/缺失容错空列表） */
export function snapshotPageList(content: Record<string, unknown>): Record<string, unknown>[] {
  return toRecordArray(content.pages);
}

/** 页内块列表（page.blocks；非数组/缺失容错空列表） */
export function snapshotBlockList(page: Record<string, unknown>): Record<string, unknown>[] {
  return toRecordArray(page.blocks);
}

/** 对象字段文本读取（pageId/blockId/title 提取；非文本/空白容错 null，v1 textOrNull 对齐） */
export function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().length > 0 ? value : null;
}

/** content 对象形状校验（pages 存在且为数组；系统数据集成缺陷快速失败） */
export function assertSnapshotShape(content: Record<string, unknown>): void {
  if (!Array.isArray(content.pages)) {
    throw new Error('基线版本内容快照非法：content.pages 缺失或非数组');
  }
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}
