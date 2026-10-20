import { createHash } from 'node:crypto';

/**
 * 版本内容快照（content/instruction_snapshot 嵌入 object）解析工具
 * （纯静态，无状态；v1 VersionContentSupport 平移）。
 *
 * content 契约（api-version §4.1 值对象）：
 * `{ pages: [ { pageId, layout, title, note,
 *   blocks: [ { blockId, blockType: TEXT|IMAGE|PLACEHOLDER,
 *               text?, assetId?, style? } ] } ] }`
 * content 由 generation 域任务回调产出（系统数据而非用户输入），解析失败按集成
 * 缺陷处理（抛错快速失败）；防御性读取对缺字段容错（返回空集/空列表）。
 *
 * v1 content 为 JSON 字符串、hash=对原串 SHA-256；v3 整体嵌入 object 后字段顺序
 * 不再稳定，hash/相等判定改用 **canonical 序列化**（对象键递归排序），保证
 * 同语义 content 跨进程/跨版本 hash 一致（对比加速/一致性校验语义不变）。
 */

/** 指令摘要候选 key（软契约：generation 快照惯例字段，按序取首个非空） */
const BRIEF_KEYS = ['instruction', 'instructionText', 'requirement', 'topic'] as const;

/** 指令摘要最大长度 */
const BRIEF_MAX_LENGTH = 60;

/**
 * canonical JSON 序列化（对象键递归字典序排序；数组保序；undefined 跳过）。
 * 供 content_hash 计算与 JSON 值相等判定（diff）共用。
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value);
}

function serializeCanonical(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null';
    case 'boolean':
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => serializeCanonical(item)).join(',')}]`;
      }
      const keys = Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort();
      const body = keys
        .map(
          (key) =>
            `${JSON.stringify(key)}:${serializeCanonical((value as Record<string, unknown>)[key])}`,
        )
        .join(',');
      return `{${body}}`;
    }
    default:
      // function/symbol/bigint/symbol 不属于 JSON 契约值域，按 null 兜底（防抖动）
      return 'null';
  }
}

/** JSON 值深度相等（canonical 序列化比对；page/block 级 diff 判定） */
export function jsonEquals(a: unknown, b: unknown): boolean {
  return serializeCanonical(a) === serializeCanonical(b);
}

/** content SHA-256（hex 小写 64 位；canonical 序列化后摘要，DDL content_hash 对应） */
export function sha256Hex(content: Record<string, unknown>): string {
  return createHash('sha256').update(serializeCanonical(content), 'utf8').digest('hex');
}

/** 页数（pages 数组长度，冗余字段 page_count；非数组容错 0） */
export function pageCount(content: Record<string, unknown>): number {
  return pageList(content).length;
}

/** 页面列表（content.pages；非数组/缺失容错空列表） */
export function pageList(content: Record<string, unknown>): Record<string, unknown>[] {
  return toRecordArray(content.pages);
}

/** 页内块列表（page.blocks；非数组/缺失容错空列表） */
export function blockList(page: Record<string, unknown>): Record<string, unknown>[] {
  return toRecordArray(page.blocks);
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

/**
 * 提取全部图片素材引用（blocks[].assetId 非空集合，INV-18 引用计数输入；
 * 无图片引用的纯文本版本返回空集合——adjustRefCounts 空集合无操作）。
 */
export function extractAssetIds(content: Record<string, unknown>): string[] {
  const assetIds = new Set<string>();
  for (const page of pageList(content)) {
    for (const block of blockList(page)) {
      const assetId = block.assetId;
      if (typeof assetId === 'string' && assetId.trim().length > 0) {
        assetIds.add(assetId);
      }
    }
  }
  return [...assetIds];
}

/**
 * 指令摘要：instruction_snapshot 内按 instruction/instructionText/requirement/topic
 * 顺序取首个非空文本，截断至 60 字（树节点 instructionBrief）。
 * 快照缺失候选 key 或非文本时返回 null（摘要为展示性冗余，不失败）。
 */
export function instructionBrief(instructionSnapshot: unknown): string | null {
  if (!isRecord(instructionSnapshot)) {
    return null;
  }
  for (const key of BRIEF_KEYS) {
    const value = instructionSnapshot[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      const text = value.trim();
      return text.length <= BRIEF_MAX_LENGTH ? text : `${text.slice(0, BRIEF_MAX_LENGTH)}...`;
    }
  }
  return null;
}

/** content 对象快速校验（pages 存在且为数组；系统数据集成缺陷快速失败） */
export function assertContentShape(content: Record<string, unknown>): void {
  if (!Array.isArray(content.pages)) {
    throw new Error('版本内容快照非法：content.pages 缺失或非数组');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 对象字段文本读取（pageId/blockId 提取；非文本容错空串） */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
