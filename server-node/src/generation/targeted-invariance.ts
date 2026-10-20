import { blockList, jsonEquals, pageList, textOf } from '../version/version.content-support';

/**
 * 定向调整非目标不变性校验（F02b，功能核查 2026-10-20；PRD prd-adjustment §52：
 * 非目标页面逐字节保持，否则产物越界按 FAILED 处理——不产版本）。
 *
 * 纯函数（无 IO）：基线取指令快照 baseContent（F02a：提交时随快照固化，
 * 网关执行链不回库加载）；旧任务快照无 baseContent 时跳过（防御性兼容）。
 *
 * 规则：
 * 1. 页集合不可增删（result 页数 = base 页数且 pageId 全命中）；
 * 2. 非目标页 canonical 相等；
 * 3. 块级作用域（targetPath.blockId 非空）时：目标页内块集合不可增删、
 *    非目标块 canonical 相等、目标块必须存在（其内容自由变更）；
 *    页级作用域仅约束页集合与非目标页。
 *
 * @throws Error 产物越界（调用方按集成缺陷处理——网关 fallback FAILED）
 */
export function assertTargetedInvariance(
  instructionSnapshot: unknown,
  result: Record<string, unknown>,
  taskId: string,
): void {
  const snapshot =
    typeof instructionSnapshot === 'object' && instructionSnapshot !== null
      ? (instructionSnapshot as Record<string, unknown>)
      : {};
  const baseContent = snapshot['baseContent'];
  if (typeof baseContent !== 'object' || baseContent === null || Array.isArray(baseContent)) {
    return; // 无基线可校验（存量在途任务兼容）
  }

  const targetPath = snapshot['targetPath'];
  const path =
    typeof targetPath === 'object' && targetPath !== null
      ? (targetPath as Record<string, unknown>)
      : {};
  const targetPageId = textOf(path['pageId']);
  const targetBlockId = textOf(path['blockId']);
  if (targetPageId === '') {
    throw new Error(`定向调整产物校验失败：快照缺少目标页 taskId=${taskId}`);
  }

  const basePages = pageList(baseContent as Record<string, unknown>);
  const resultPages = pageList(result);
  if (resultPages.length !== basePages.length) {
    throw new Error(
      `定向调整产物越界：页数变化 ${basePages.length}→${resultPages.length} taskId=${taskId}`,
    );
  }
  const resultPageById = new Map(resultPages.map((page) => [textOf(page.pageId), page]));
  for (const basePage of basePages) {
    const pageId = textOf(basePage.pageId);
    const resultPage = resultPageById.get(pageId);
    if (resultPage === undefined) {
      throw new Error(`定向调整产物越界：页缺失 ${pageId} taskId=${taskId}`);
    }
    if (pageId !== targetPageId && !jsonEquals(basePage, resultPage)) {
      throw new Error(`定向调整产物越界：非目标页被修改 ${pageId} taskId=${taskId}`);
    }
  }

  if (targetBlockId === '') {
    return; // 页级作用域：目标页内容自由变更
  }
  const baseTargetPage = basePages.find((page) => textOf(page.pageId) === targetPageId);
  const resultTargetPage = resultPageById.get(targetPageId);
  if (baseTargetPage === undefined || resultTargetPage === undefined) {
    throw new Error(`定向调整产物越界：目标页缺失 ${targetPageId} taskId=${taskId}`);
  }
  const baseBlocks = blockList(baseTargetPage);
  const resultBlocks = blockList(resultTargetPage);
  if (resultBlocks.length !== baseBlocks.length) {
    throw new Error(
      `定向调整产物越界：目标页块数变化 ${baseBlocks.length}→${resultBlocks.length} taskId=${taskId}`,
    );
  }
  const resultBlockById = new Map(resultBlocks.map((block) => [textOf(block.blockId), block]));
  for (const baseBlock of baseBlocks) {
    const blockId = textOf(baseBlock.blockId);
    const resultBlock = resultBlockById.get(blockId);
    if (resultBlock === undefined) {
      throw new Error(`定向调整产物越界：块缺失 ${blockId} taskId=${taskId}`);
    }
    if (blockId !== targetBlockId && !jsonEquals(baseBlock, resultBlock)) {
      throw new Error(`定向调整产物越界：非目标块被修改 ${blockId} taskId=${taskId}`);
    }
  }
  if (!resultBlockById.has(targetBlockId)) {
    throw new Error(`定向调整产物越界：目标块缺失 ${targetBlockId} taskId=${taskId}`);
  }
}
