import { PresentBlockVO, PresentPageVO } from './deliver.dto';

/**
 * 定稿版本内容快照（content 嵌入 object）解析工具（纯静态，无状态；
 * v1 VersionSnapshotSupport 平移——**deliver 域 ACL：不依赖 version 域实现内部
 * 工具，独立解析**）。
 *
 * content 契约（api-version §4.1 值对象，deliver 域只读消费）：
 * `{ pages: [ { pageId, layout, title, note,
 *   blocks: [ { blockId, blockType: TEXT|IMAGE|PLACEHOLDER,
 *               text?, assetId?, style? } ] } ] }`
 * content 由 generation 域任务回调产出（系统数据而非用户输入），形状非法按
 * 集成缺陷快速失败（assertSnapshotShape）；防御性读取对缺字段容错
 * （空集/空列表/null）。
 */

/** content 对象形状校验（pages 存在且为数组；集成缺陷快速失败） */
export function assertSnapshotShape(content: Record<string, unknown>): void {
  if (!Array.isArray(content.pages)) {
    throw new Error('定稿版本内容快照非法：content.pages 缺失或非数组');
  }
}

/** 页数（pages 数组长度；渲染占位产物分页依据） */
export function snapshotPageCount(content: Record<string, unknown>): number {
  return pageList(content).length;
}

/**
 * 提取全部图片素材引用（blocks[].assetId 非空集合，去重保序；
 * 无图片引用的纯文本版本返回空集合）。
 */
export function extractSnapshotAssetIds(content: Record<string, unknown>): string[] {
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
 * 组装演示放映页结构（渲染就绪：页序 1 起、演讲者备注 note、图片块注入素材限时 URL）。
 *
 * @param content        定稿版本 content 快照（object 形态）
 * @param assetFileUrls  素材限时 URL（assetId → URL；未命中的图片块 assetFileUrl=null）
 */
export function toPresentPages(
  content: Record<string, unknown>,
  assetFileUrls: ReadonlyMap<string, string>,
): PresentPageVO[] {
  const pages: PresentPageVO[] = [];
  let index = 1;
  for (const pageNode of pageList(content)) {
    const page = new PresentPageVO();
    page.pageId = textOrNull(pageNode.pageId);
    page.index = index++;
    page.title = textOrNull(pageNode.title);
    page.note = textOrNull(pageNode.note);
    page.blocks = toPresentBlocks(blockList(pageNode), assetFileUrls);
    pages.push(page);
  }
  return pages;
}

function toPresentBlocks(
  blocksNode: Record<string, unknown>[],
  assetFileUrls: ReadonlyMap<string, string>,
): PresentBlockVO[] {
  const blocks: PresentBlockVO[] = [];
  for (const blockNode of blocksNode) {
    const block = new PresentBlockVO();
    block.blockId = textOrNull(blockNode.blockId);
    block.blockType = textOrNull(blockNode.blockType);
    block.text = textOrNull(blockNode.text);
    block.assetId = textOrNull(blockNode.assetId);
    if (block.assetId != null) {
      block.assetFileUrl = assetFileUrls.get(block.assetId) ?? null;
    }
    block.style = isRecord(blockNode.style) ? blockNode.style : null;
    blocks.push(block);
  }
  return blocks;
}

/* ---------- 内部（防御性读取） ---------- */

function pageList(content: Record<string, unknown>): Record<string, unknown>[] {
  return toRecordArray(content.pages);
}

function blockList(page: Record<string, unknown>): Record<string, unknown>[] {
  return toRecordArray(page.blocks);
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
