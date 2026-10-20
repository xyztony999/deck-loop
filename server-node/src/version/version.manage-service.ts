import { Injectable } from '@nestjs/common';
import { DeckStatus, getVersionSourceTypeLabel } from '../common/enums';
import { BizException } from '../common/exceptions';
import { OperItem } from '../common/result';
import { DeckDomainService } from '../deck/deck.domain-service';
import {
  blockList,
  extractAssetIds,
  instructionBrief,
  jsonEquals,
  pageList,
  textOf,
} from './version.content-support';
import {
  BRANCH_SCOPE_ALL,
  CHANGE_KIND_IMAGE,
  CHANGE_KIND_NONE,
  CHANGE_KIND_NEW,
  CHANGE_KIND_REMOVED,
  CHANGE_KIND_STRUCTURE,
  CHANGE_KIND_TEXT,
  formatDateTime,
  VersionArchiveCommand,
  VersionCompareAO,
  VersionCompareBlockDiff,
  VersionComparePageDiff,
  VersionCompareVO,
  VersionDetailAO,
  VersionDetailVO,
  VersionForkAO,
  VersionRollbackAO,
  VersionTreeAO,
  VersionTreeBranch,
  VersionTreeNode,
  VersionTreeVO,
} from './version.dto';
import {
  VERSION_BRANCH_EXISTS,
  VERSION_NOT_FOUND,
  VERSION_SAME_COMPARE,
} from './version.errors';
import { VersionArchiveService } from './version.archive-service';
import { VersionRepository } from './version.repository';
import type { DeckVersionDocument } from './schemas/dl_deck_version.schema';
import type { DeckDocument } from '../deck/schemas/dl_deck.schema';

/**
 * 版本管理 Service（C-04，api-version §4.4 管理接口 1-5；v1 VersionServiceImpl 平移）。
 *
 * 版本不可变（INV-11/ADR-002/009）：本类无任何版本 update/delete 语句；
 * 回退=移指针（movePointer，历史不动 D3）；分叉=新分支插入复制+指针+activeBranch
 * 切换（fork 复制行经 VersionArchiveService 唯一写路径）。
 * 指针/分支守卫统一在 deck 域 movePointer 内执行（Deck 须 ITERATING，
 * FINALIZED 需先解锁）。
 */
@Injectable()
export class VersionManageService {
  constructor(
    private readonly versionRepository: VersionRepository,
    private readonly deckDomainService: DeckDomainService,
    private readonly archiveService: VersionArchiveService,
  ) {}

  // ------------------------------------------------------------------
  // 1. 版本谱系树 + 分支列表
  // ------------------------------------------------------------------

  /**
   * 谱系树（内存组树，api-version §5.2：deck_id 全量取回；根=parent 为空或
   * 父节点被 branchScope 过滤的版本）+ branches[]（全量分支，不受 branchScope 影响）。
   */
  async tree(ao: VersionTreeAO, userId: string): Promise<VersionTreeVO> {
    const deck = await this.loadOwnedDeck(ao.deckId, userId);

    const all = await this.versionRepository.findByDeckId(deck.deck_id);
    const activeOnly = ao.branchScope !== BRANCH_SCOPE_ALL;
    const scoped = activeOnly
      ? all.filter((v) => v.branch_name === deck.active_branch)
      : all;

    const taskStatusMap = await this.loadTaskStatuses(scoped);

    // 内存组树：nodeMap 装配 → 按 parent 挂接（version_seq 升序遍历 → children 天然有序）
    const nodeMap = new Map<string, VersionTreeNode>();
    for (const version of scoped) {
      nodeMap.set(version.version_id, this.toNode(version, deck, taskStatusMap));
    }
    const roots: VersionTreeNode[] = [];
    for (const version of scoped) {
      const node = nodeMap.get(version.version_id)!;
      const parent =
        version.parent_version_id == null ? null : nodeMap.get(version.parent_version_id);
      if (parent == null) {
        roots.push(node);
      } else {
        parent.children.push(node);
      }
    }

    return VersionTreeVO.of(
      deck.deck_id,
      deck.deck_status,
      deck.active_branch,
      deck.current_version_id ?? null,
      deck.final_version_id ?? null,
      roots,
      this.buildBranches(all, deck),
    );
  }

  // ------------------------------------------------------------------
  // 2. 版本详情（content 完整 JSON）
  // ------------------------------------------------------------------

  /** 全字段 + content 完整快照（体积大，前端按页虚拟渲染）；deck→version 级联归属 */
  async detail(ao: VersionDetailAO, userId: string): Promise<VersionDetailVO> {
    const version = await this.loadOwnedVersionCascade(ao.versionId, userId);
    return VersionDetailVO.of(version);
  }

  // ------------------------------------------------------------------
  // 3. 双版本对比（过程数据，D4 实时计算不落库）
  // ------------------------------------------------------------------

  /** 同版本拒绝（BIZ_VERSION_SAME_COMPARE）；sameHash 短路全 NONE；否则逐页逐块 diff */
  async compare(ao: VersionCompareAO, userId: string): Promise<VersionCompareVO> {
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    if (ao.leftVersionId === ao.rightVersionId) {
      throw new BizException(VERSION_SAME_COMPARE, '同版本比较被拒绝');
    }
    const left = await this.loadVersionOfDeck(ao.leftVersionId, deck.deck_id);
    const right = await this.loadVersionOfDeck(ao.rightVersionId, deck.deck_id);

    const sameHash = left.content_hash === right.content_hash;
    const pages = sameHash
      ? this.allNonePages(left.content)
      : this.diffPages(left.content, right.content);
    return VersionCompareVO.of(
      deck.deck_id,
      left.version_id,
      right.version_id,
      sameHash,
      pages,
    );
  }

  // ------------------------------------------------------------------
  // 4. 版本回退（移指针，历史不动，D3）
  // ------------------------------------------------------------------

  /** 版本归属校验 → confirm 守卫 → movePointer（Deck 须 ITERATING——deck 域统一守卫） */
  async rollback(ao: VersionRollbackAO, userId: string): Promise<void> {
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    const version = await this.loadVersionOfDeck(ao.versionId, deck.deck_id);
    if (ao.confirm !== true) {
      throw new BizException(VERSION_NOT_FOUND, '回退需二次确认（confirm=true）');
    }
    // 回退不切换分支（branchName=undefined → active_branch 不变）
    await this.deckDomainService.movePointer(deck.deck_id, version.version_id, undefined, userId);
  }

  // ------------------------------------------------------------------
  // 5. 版本分叉（新命名分支 + activeBranch 切换）
  // ------------------------------------------------------------------

  /**
   * 分叉头=versionId：新分支首版本复制源版本快照（parent=分叉头，
   * sourceType/taskId 沿用源版本——内容出处不变）；经 VersionArchiveService
   * 唯一写路径（seq 分配 → 锁内 branch 守卫复查 → insertOnly → movePointer
   * 切换 activeBranch → 引用计数 +1）。
   */
  async fork(ao: VersionForkAO, userId: string): Promise<void> {
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    const source = await this.loadVersionOfDeck(ao.versionId, deck.deck_id);
    const branchName = ao.branchName.trim();
    await this.assertBranchNameFree(branchName, deck);

    const command = new VersionArchiveCommand();
    command.deckId = deck.deck_id;
    command.userId = deck.user_id;
    command.taskId = source.task_id;
    command.sourceType = source.source_type;
    command.instructionSnapshot = source.instruction_snapshot;
    command.content = source.content;
    command.parentVersionId = source.version_id;
    command.branchName = branchName;

    const assetIds = extractAssetIds(source.content);
    await this.archiveService.insertAndAdvance(
      command,
      assetIds,
      // 锁内复查（seq 事务内重检，规避「检查-插入」竞态；v1 fork 同款谓词）
      this.forkConflictGuard(branchName, deck),
    );
  }

  // ------------------------------------------------------------------
  // 内部：树构建
  // ------------------------------------------------------------------

  private toNode(
    version: DeckVersionDocument,
    deck: DeckDocument,
    taskStatusMap: Map<string, string>,
  ): VersionTreeNode {
    const node = new VersionTreeNode();
    node.versionId = version.version_id;
    node.versionSeq = version.version_seq;
    node.branchName = version.branch_name;
    node.sourceType = version.source_type;
    node.sourceTypeName = getVersionSourceTypeLabel(version.source_type);
    node.instructionBrief = instructionBrief(version.instruction_snapshot);
    node.taskStatusOfSource = taskStatusMap.get(version.task_id) ?? null;
    node.createdTime = version.created_time ?? null;
    node.createdTimeStr = formatDateTime(version.created_time);
    node.isCurrent = version.version_id === deck.current_version_id;
    node.isFinal = version.version_id === deck.final_version_id;
    node.createdBy = version.created_by ?? null;
    node.operList = this.fillNodeOperList(node.isCurrent, node.isFinal, deck.deck_status);
    return node;
  }

  /** operList（树节点，api-version §4.4）：set-current/fork-from/export-from，由 Deck 状态驱动 */
  private fillNodeOperList(
    isCurrent: boolean,
    isFinal: boolean,
    deckStatus: string,
  ): OperItem[] {
    const operList: OperItem[] = [];
    if (deckStatus === DeckStatus.ITERATING) {
      if (!isCurrent) {
        operList.push(OperItem.of('set-current', '设为当前'));
      }
      operList.push(OperItem.of('fork-from', '从此分叉'));
    }
    // export-from：已定稿限制——仅定稿版本可导出（deliver 域 FINALIZED 守卫前置标注）
    if (deckStatus === DeckStatus.FINALIZED && isFinal) {
      operList.push(OperItem.of('export-from', '导出此版本'));
    }
    return operList;
  }

  private async loadTaskStatuses(
    versions: DeckVersionDocument[],
  ): Promise<Map<string, string>> {
    const taskIds = [
      ...new Set(
        versions.map((v) => v.task_id).filter((id) => id != null && id.trim().length > 0),
      ),
    ];
    if (taskIds.length === 0) {
      return new Map<string, string>();
    }
    return this.versionRepository.findTaskStatuses(taskIds);
  }

  /** 分支列表（全量，不受 branchScope 影响）：活动分支置顶，其余按名升序 */
  private buildBranches(all: DeckVersionDocument[], deck: DeckDocument): VersionTreeBranch[] {
    const grouped = new Map<string, DeckVersionDocument[]>();
    for (const version of all) {
      const list = grouped.get(version.branch_name) ?? [];
      list.push(version);
      grouped.set(version.branch_name, list);
    }
    const branches: VersionTreeBranch[] = [];
    for (const [branchName, versions] of grouped) {
      branches.push(this.toBranch(branchName, versions, deck));
    }
    // 活动分支可能尚无版本（fork 后未生成/fresh deck=main）——补空分支行
    if (!grouped.has(deck.active_branch)) {
      branches.push(this.toBranch(deck.active_branch, [], deck));
    }
    branches.sort((a, b) => {
      const activeRank = (branch: VersionTreeBranch): number => (branch.isActive ? 0 : 1);
      return activeRank(a) - activeRank(b) || compareText(a.branchName, b.branchName);
    });
    return branches;
  }

  private toBranch(
    branchName: string,
    versions: DeckVersionDocument[],
    deck: DeckDocument,
  ): VersionTreeBranch {
    const branch = new VersionTreeBranch();
    branch.branchName = branchName;
    branch.versionCount = versions.length;
    branch.headVersionId =
      versions.length === 0
        ? null
        : versions.reduce((head, v) => (v.version_seq > head.version_seq ? v : head))
          .version_id;
    branch.isActive = branchName === deck.active_branch;
    return branch;
  }

  // ------------------------------------------------------------------
  // 内部：对比（按页 diff，changeKind 过程数据）
  // ------------------------------------------------------------------

  /** sameHash 短路：全部页 NONE（左版本页序，leftIndex=rightIndex） */
  private allNonePages(content: Record<string, unknown>): VersionComparePageDiff[] {
    const pages = pageList(content);
    return pages.map((page, i) =>
      VersionComparePageDiff.of(textOf(page.pageId), i, i, CHANGE_KIND_NONE, []),
    );
  }

  /** 逐页 diff：左版本页序（共有→逐块 diff / 仅左→REMOVED）+ 仅右→NEW（追加于后） */
  private diffPages(
    leftContent: Record<string, unknown>,
    rightContent: Record<string, unknown>,
  ): VersionComparePageDiff[] {
    const leftPages = pageList(leftContent);
    const rightPages = pageList(rightContent);
    const rightIndex = indexByPageId(rightPages);

    const result: VersionComparePageDiff[] = [];
    for (let i = 0; i < leftPages.length; i++) {
      const leftPage = leftPages[i];
      const pageId = textOf(leftPage.pageId);
      const j = rightIndex.get(pageId);
      if (j === undefined) {
        result.push(VersionComparePageDiff.of(pageId, i, null, CHANGE_KIND_REMOVED, []));
      } else {
        result.push(this.diffSamePage(pageId, i, j, leftPage, rightPages[j]));
      }
    }
    // 仅右 → NEW（追加于后）
    const leftIds = new Set(indexByPageId(leftPages).keys());
    for (let j = 0; j < rightPages.length; j++) {
      const pageId = textOf(rightPages[j].pageId);
      if (!leftIds.has(pageId)) {
        result.push(VersionComparePageDiff.of(pageId, null, j, CHANGE_KIND_NEW, []));
      }
    }
    return result;
  }

  private diffSamePage(
    pageId: string,
    leftIdx: number,
    rightIdx: number,
    leftPage: Record<string, unknown>,
    rightPage: Record<string, unknown>,
  ): VersionComparePageDiff {
    if (jsonEquals(leftPage, rightPage)) {
      return VersionComparePageDiff.of(pageId, leftIdx, rightIdx, CHANGE_KIND_NONE, []);
    }

    let structural =
      !jsonEquals(leftPage.title, rightPage.title) ||
      !jsonEquals(leftPage.layout, rightPage.layout) ||
      !jsonEquals(leftPage.note, rightPage.note);

    let anyText = false;
    let anyImage = false;
    const leftBlocks = blockList(leftPage);
    const rightBlocks = blockList(rightPage);
    const rightBlockMap = blockMap(rightBlocks);
    const leftBlockIds = new Set(blockMap(leftBlocks).keys());
    const diffBlocks: VersionCompareBlockDiff[] = [];

    for (const leftBlock of leftBlocks) {
      const blockId = textOf(leftBlock.blockId);
      const rightBlock = rightBlockMap.get(blockId);
      if (rightBlock === undefined) {
        diffBlocks.push(VersionCompareBlockDiff.of(blockId, CHANGE_KIND_REMOVED));
        structural = true;
        continue;
      }
      if (jsonEquals(leftBlock, rightBlock)) {
        continue;
      }
      const kind = blockChangeKind(leftBlock, rightBlock);
      if (kind === CHANGE_KIND_TEXT) {
        anyText = true;
      } else if (kind === CHANGE_KIND_IMAGE) {
        anyImage = true;
      } else {
        structural = true;
      }
      diffBlocks.push(VersionCompareBlockDiff.of(blockId, kind));
    }
    for (const rightBlock of rightBlocks) {
      const blockId = textOf(rightBlock.blockId);
      if (!leftBlockIds.has(blockId)) {
        diffBlocks.push(VersionCompareBlockDiff.of(blockId, CHANGE_KIND_NEW));
        structural = true;
      }
    }

    const changeKind = structural
      ? CHANGE_KIND_STRUCTURE
      : anyText
        ? CHANGE_KIND_TEXT
        : anyImage
          ? CHANGE_KIND_IMAGE
          : CHANGE_KIND_NONE;
    return VersionComparePageDiff.of(pageId, leftIdx, rightIdx, changeKind, diffBlocks);
  }

  // ------------------------------------------------------------------
  // 内部：归属校验（deck→version 级联，api-version §3.3）
  // ------------------------------------------------------------------

  /** 分支名冲突预检（已存在分支清单/活动分支；锁内复查见 fork 冲突守卫） */
  private async assertBranchNameFree(
    branchName: string,
    deck: DeckDocument,
  ): Promise<void> {
    const names = await this.versionRepository.findBranchNames(deck.deck_id);
    if (names.includes(branchName) || branchName === deck.active_branch) {
      throw new BizException(VERSION_BRANCH_EXISTS, `分支名已存在: ${branchName}`);
    }
  }

  /** fork 锁内复查谓词（v1 fork 同款：已存在分支不含该名 && ≠活动分支） */
  private forkConflictGuard(branchName: string, deck: DeckDocument) {
    return async (): Promise<boolean> => {
      const locked = await this.versionRepository.findBranchNames(deck.deck_id);
      return !locked.includes(branchName) && branchName !== deck.active_branch;
    };
  }

  private async loadOwnedDeck(deckId: string, userId: string): Promise<DeckDocument> {
    const deck = await this.deckDomainService.getDeck(deckId, userId);
    if (deck == null) {
      throw new BizException(VERSION_NOT_FOUND, '创作物不存在');
    }
    return deck;
  }

  /** 版本归属 deck 校验（deck 已通过属主校验） */
  private async loadVersionOfDeck(
    versionId: string,
    deckId: string,
  ): Promise<DeckVersionDocument> {
    const version = await this.versionRepository.findById(versionId);
    if (version == null || version.deck_id !== deckId) {
      throw new BizException(VERSION_NOT_FOUND, '版本不存在或不属于该创作物');
    }
    return version;
  }

  /** version → deck → user 级联归属校验（detail 无 deckId 入参） */
  private async loadOwnedVersionCascade(
    versionId: string,
    userId: string,
  ): Promise<DeckVersionDocument> {
    const version = await this.versionRepository.findById(versionId);
    if (version == null) {
      throw new BizException(VERSION_NOT_FOUND, '版本不存在');
    }
    await this.loadOwnedDeck(version.deck_id, userId);
    return version;
  }
}

/** pageId → 下标索引（重复 pageId 取首个，v1 putIfAbsent 对齐） */
function indexByPageId(pages: Record<string, unknown>[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    const pageId = textOf(pages[i].pageId);
    if (!index.has(pageId)) {
      index.set(pageId, i);
    }
  }
  return index;
}

/** blockId → 块对象映射（重复 blockId 取首个） */
function blockMap(blocks: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const blockId = textOf(block.blockId);
    if (!map.has(blockId)) {
      map.set(blockId, block);
    }
  }
  return map;
}

/** 块级差异：blockType/style 变更=STRUCTURE；text 变更=TEXT；assetId 变更=IMAGE */
function blockChangeKind(
  leftBlock: Record<string, unknown>,
  rightBlock: Record<string, unknown>,
): string {
  const typeChanged = !jsonEquals(leftBlock.blockType, rightBlock.blockType);
  const styleChanged = !jsonEquals(leftBlock.style, rightBlock.style);
  if (typeChanged || styleChanged) {
    return CHANGE_KIND_STRUCTURE;
  }
  if (!jsonEquals(leftBlock.text, rightBlock.text)) {
    return CHANGE_KIND_TEXT;
  }
  if (!jsonEquals(leftBlock.assetId, rightBlock.assetId)) {
    return CHANGE_KIND_IMAGE;
  }
  return CHANGE_KIND_STRUCTURE;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
