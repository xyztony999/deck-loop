import { Injectable, Logger } from '@nestjs/common';
import { AssetDomainService } from '../asset/asset.service';
import type { BrandKitProviderGetVO } from '../asset/asset.dto';
import { DeckDomainService } from '../deck/deck.domain-service';
import { DECK_NOT_FOUND, DECK_NOT_FOUND_MSG } from '../deck/deck.errors';
import type { DeckDocument } from '../deck/schemas/dl_deck.schema';
import { GenerationTaskDomainService } from '../generation/generation.domain-service';
import { GenerationTaskCreateCommand } from '../generation/generation.dto';
import { TargetKind, TaskType, getTargetKindLabel, type TargetKindCode } from '../common/enums';
import { BizException } from '../common/exceptions';
import {
  ADJUST_BASE_VERSION_INVALID,
  ADJUST_PLACEHOLDER_UNRESOLVED,
  ADJUST_SCOPE_INVALID,
} from './adjustment.errors';
import {
  AdjustScopeValidateAO,
  AdjustScopeValidateVO,
  AdjustSubmitVO,
  AdjustTargetPathAO,
  BLOCK_TYPE_IMAGE,
  BLOCK_TYPE_TEXT,
  PLACEHOLDER_PATTERN,
  SNAPSHOT_KEY_INSTRUCTION,
  TargetedAdjustSubmitAO,
  WholeAdjustSubmitAO,
} from './adjustment.dto';
import { AdjustmentQueryRepository, type BaseVersionRow } from './adjustment.query-repository';
import {
  assertSnapshotShape,
  snapshotBlockList,
  snapshotPageList,
  textOrNull,
} from './adjustment.snapshot-support';

/**
 * 调整指令应用 Service（C-03，api-adjustment §4.4 接口清单 1-3；
 * v1 AdjustmentServiceImpl 逐字平移）。
 *
 * 编排边界（ADR-008 + domain-manifest §3）：调整只经语言指令驱动，指令快照
 * （instruction/instructionText 双 key、targetKind/targetPath、baseVersionId、
 * applyBrandKit/brandKitId、usedTemplateIds、baseBranchName/forkBranchName）在域内
 * 组装后交给 GenerationTaskDomainService#createTask（统一创建链：INV-3 守卫→路由
 * 解析→INV-8 互斥插入→gen_task_created→网关提交；跨域 BizException 原样透传）。
 * 本域无自有表写路径，不发独立事件（gen_task_created/gen_task_finished 以
 * taskType 区分复用）。
 *
 * 会话+属主（api-adjustment §3.3）：deck/version 归属校验按 user_id 隔离
 * （ADR-005/NR-05，@CurrentUser 服务端注入）。
 */
@Injectable()
export class AdjustmentService {
  private readonly logger = new Logger(AdjustmentService.name);

  constructor(
    private readonly deckDomainService: DeckDomainService,
    private readonly generationTaskDomainService: GenerationTaskDomainService,
    private readonly assetDomainService: AssetDomainService,
    private readonly queryRepository: AdjustmentQueryRepository,
  ) {}

  // ------------------------------------------------------------------
  // 1. 整稿调整提交（FULL_ADJUST）
  // ------------------------------------------------------------------

  async wholeSubmit(ao: WholeAdjustSubmitAO, userId: string): Promise<AdjustSubmitVO> {
    this.requireUserId(userId);
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    const baseVersion = await this.loadBaseVersion(deck, ao.baseVersionId, userId);
    this.checkPlaceholders(ao.instructionText);
    const brandKit = await this.resolveBrandKit(deck, userId, ao.applyBrandKit, ao.brandKitId);
    const usedTemplateIds = await this.checkUsedTemplates(userId, ao.usedTemplateIds);

    const fork = await this.decideFork(deck, baseVersion, ao.confirm, ao.branchName);
    if (fork.prompt) {
      // D3：基线≠当前且未 confirm → 拒绝提交，返回 needForkBranch 提示（不创建任务）
      this.logger.log(
        `整稿调整触发分叉提示 deckId=${deck.deck_id} base=${baseVersion.versionId}` +
          ` current=${deck.current_version_id ?? null}`,
      );
      return AdjustSubmitVO.forkPrompt();
    }

    const snapshot = this.baseSnapshot(deck, userId, ao.instructionText, baseVersion);
    snapshot['applyBrandKit'] = brandKit.apply;
    snapshot['brandKitId'] = brandKit.brandKitId;
    snapshot['usedTemplateIds'] = usedTemplateIds;
    this.applyBrandKitContext(snapshot, brandKit);
    await this.appendAssetContext(snapshot, baseVersion.content, userId);
    if (fork.forkBranchName !== null) {
      snapshot['forkBranchName'] = fork.forkBranchName;
    }

    const created = await this.generationTaskDomainService.createTask(
      this.buildCommand(deck.deck_id, userId, TaskType.FULL_ADJUST, ao.baseVersionId, snapshot),
    );
    this.logger.log(
      `整稿调整已提交 taskId=${created.taskId} deckId=${deck.deck_id}` +
        ` base=${baseVersion.versionId} forked=${fork.forked}`,
    );
    return AdjustSubmitVO.of(created, fork.forked, fork.forkBranchName);
  }

  // ------------------------------------------------------------------
  // 2. 定向调整提交（TARGETED_ADJUST，INV-9 内联）
  // ------------------------------------------------------------------

  async targetedSubmit(ao: TargetedAdjustSubmitAO, userId: string): Promise<AdjustSubmitVO> {
    this.requireUserId(userId);
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    const baseVersion = await this.loadBaseVersion(deck, ao.baseVersionId, userId);
    this.checkPlaceholders(ao.instructionText);
    const brandKit = await this.resolveBrandKit(deck, userId, ao.applyBrandKit, ao.brandKitId);
    const usedTemplateIds = await this.checkUsedTemplates(userId, ao.usedTemplateIds);

    // INV-9（等价 /adjust/scope/validate 内联执行）
    this.resolveScope(baseVersion, ao.targetKind, ao.targetPath);

    const fork = await this.decideFork(deck, baseVersion, ao.confirm, ao.branchName);
    if (fork.prompt) {
      return AdjustSubmitVO.forkPrompt();
    }

    const snapshot = this.baseSnapshot(deck, userId, ao.instructionText, baseVersion);
    snapshot['applyBrandKit'] = brandKit.apply;
    snapshot['brandKitId'] = brandKit.brandKitId;
    snapshot['usedTemplateIds'] = usedTemplateIds;
    this.applyBrandKitContext(snapshot, brandKit);
    await this.appendAssetContext(snapshot, baseVersion.content, userId);
    if (fork.forkBranchName !== null) {
      snapshot['forkBranchName'] = fork.forkBranchName;
    }
    this.appendTarget(snapshot, ao.targetKind, ao.targetPath);

    const created = await this.generationTaskDomainService.createTask(
      this.buildCommand(deck.deck_id, userId, TaskType.TARGETED_ADJUST, ao.baseVersionId, snapshot),
    );
    this.logger.log(
      `定向调整已提交 taskId=${created.taskId} deckId=${deck.deck_id}` +
        ` target=${ao.targetKind}/${ao.targetPath.pageId} forked=${fork.forked}`,
    );
    return AdjustSubmitVO.of(created, fork.forked, fork.forkBranchName);
  }

  // ------------------------------------------------------------------
  // 3. 目标作用域校验（提交前拦截，D4）
  // ------------------------------------------------------------------

  async validateScope(ao: AdjustScopeValidateAO, userId: string): Promise<AdjustScopeValidateVO> {
    this.requireUserId(userId);
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    const version = await this.loadBaseVersion(deck, ao.versionId, userId);
    return this.resolveScope(version, ao.targetKind, ao.targetPath);
  }

  // ------------------------------------------------------------------
  // 内部：作用域定位（INV-9，校验与提交共用）
  // ------------------------------------------------------------------

  /**
   * 在基线版本内容快照中定位目标作用域（api-version §4.1 content 契约：
   * pages[]→blocks[]，blockId 同页内定位）。
   *
   * @throws BizException BIZ_ADJUST_SCOPE_INVALID：pageId/blockId 不存在、
   *   targetKind 与 blockType 不匹配（大小写兼容）、PAGE 携带 blockId
   */
  private resolveScope(
    baseVersion: BaseVersionRow,
    targetKind: string,
    targetPath: AdjustTargetPathAO,
  ): AdjustScopeValidateVO {
    if (baseVersion.content == null) {
      // 防御：loadBaseVersion 已保证非空 content，此处兜底口径一致
      throw new BizException(ADJUST_BASE_VERSION_INVALID, '基线版本无效');
    }
    let pages: Record<string, unknown>[];
    try {
      // content 为系统数据，损坏按基线无效快速失败（不暴露堆栈，v1 parseContent 对齐）
      assertSnapshotShape(baseVersion.content);
      pages = snapshotPageList(baseVersion.content);
    } catch {
      throw new BizException(ADJUST_BASE_VERSION_INVALID, '基线版本内容快照非法');
    }

    const kind = this.requireTargetKind(targetKind);
    if (kind === TargetKind.PAGE && isNotBlank(targetPath.blockId)) {
      throw this.scopeInvalid('PAGE 作用域不支持 blockId');
    }
    if (kind !== TargetKind.PAGE && !isNotBlank(targetPath.blockId)) {
      throw this.scopeInvalid(`targetKind=${kind} 时 blockId 不能为空`);
    }

    const page = this.findPage(pages, targetPath.pageId);
    const pageNo = this.pageNoOf(pages, targetPath.pageId);
    const pageTitle = textOrNull(page.title);

    const vo = new AdjustScopeValidateVO();
    vo.valid = true;
    vo.targetKind = kind;
    vo.targetKindName = getTargetKindLabel(kind);
    vo.pageId = targetPath.pageId;
    vo.pageNo = pageNo;
    vo.pageTitle = pageTitle;

    let summary = `第${pageNo}页`;
    if (pageTitle !== null) {
      summary += `「${pageTitle}」`;
    }
    if (kind !== TargetKind.PAGE) {
      const blockId = targetPath.blockId;
      if (!isNotBlank(blockId)) {
        // 防御：前置复合守卫已拦截，此处本地收窄供类型层使用
        throw this.scopeInvalid(`targetKind=${kind} 时 blockId 不能为空`);
      }
      const block = this.findBlock(page, blockId);
      const blockType = textOrNull(block.blockType);
      const expected = kind === TargetKind.TEXT_BLOCK ? BLOCK_TYPE_TEXT : BLOCK_TYPE_IMAGE;
      if (blockType === null || expected.toUpperCase() !== blockType.toUpperCase()) {
        throw this.scopeInvalid(
          `目标块类型不匹配：targetKind=${kind}，实际 blockType=${blockType ?? 'null'}`,
        );
      }
      vo.blockId = blockId;
      vo.blockType = blockType;
      summary += ` · ${getTargetKindLabel(kind)}`;
    }
    vo.targetSummary = summary;
    return vo;
  }

  private findPage(pages: Record<string, unknown>[], pageId: string): Record<string, unknown> {
    for (const page of pages) {
      if (pageId === textOrNull(page.pageId)) {
        return page;
      }
    }
    throw this.scopeInvalid(`目标页不存在：${pageId}`);
  }

  /** 页序号（1 起，基线内容快照内的顺序；未命中返回 pages.length+1，v1 pageNoOf 对齐） */
  private pageNoOf(pages: Record<string, unknown>[], pageId: string): number {
    let index = 1;
    for (const page of pages) {
      if (pageId === textOrNull(page.pageId)) {
        return index;
      }
      index++;
    }
    return index;
  }

  private findBlock(page: Record<string, unknown>, blockId: string): Record<string, unknown> {
    for (const block of snapshotBlockList(page)) {
      if (blockId === textOrNull(block.blockId)) {
        return block;
      }
    }
    throw this.scopeInvalid(`目标块不存在：${blockId}`);
  }

  // ------------------------------------------------------------------
  // 内部：指令快照组装（api-adjustment §4.1 adjust 节）
  // ------------------------------------------------------------------

  /** 快照公共节：deck 主题冗余 + 指令文本双 key + 基线锁定 + 发起时活动分支快照。 */
  private baseSnapshot(
    deck: DeckDocument,
    userId: string,
    instructionText: string,
    baseVersion: BaseVersionRow,
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      deckId: deck.deck_id,
      topic: deck.topic,
      userId,
    };
    if (deck.requirement != null) {
      snapshot['requirement'] = deck.requirement;
    }
    // 指令文本双 key：instruction 供任务列表摘要（generation BRIEF_KEYS 首选），
    // instructionText 为 api-adjustment §4.1 快照字段名
    snapshot[SNAPSHOT_KEY_INSTRUCTION] = instructionText;
    snapshot['instructionText'] = instructionText;
    snapshot['baseVersionId'] = baseVersion.versionId;
    snapshot['baseBranchName'] = deck.active_branch;
    // F02：基线原稿全文入快照（网关执行链不再回库加载——快照即模型可见的全部上下文；
    // TARGETED_ADJUST 的非目标页不变性校验亦以此为准，generation.callback）
    snapshot['baseContent'] = baseVersion.content;
    return snapshot;
  }

  /** 定向作用域结构化承载（ADR-008：TargetKind 定位在快照 JSON 内，不落自有表）。 */
  private appendTarget(
    snapshot: Record<string, unknown>,
    targetKind: string | undefined,
    targetPath: AdjustTargetPathAO | undefined,
  ): void {
    if (targetKind == null || targetPath == null) {
      return;
    }
    snapshot['targetKind'] = targetKind;
    const path: Record<string, unknown> = { pageId: targetPath.pageId };
    if (isNotBlank(targetPath.blockId)) {
      path['blockId'] = targetPath.blockId;
    }
    snapshot['targetPath'] = path;
  }

  private buildCommand(
    deckId: string,
    userId: string,
    taskType: string,
    baseVersionId: string,
    snapshot: Record<string, unknown>,
  ): GenerationTaskCreateCommand {
    const command = new GenerationTaskCreateCommand();
    command.deckId = deckId;
    command.userId = userId;
    command.taskType = taskType;
    command.baseVersionId = baseVersionId;
    command.instructionSnapshot = snapshot;
    return command;
  }

  // ------------------------------------------------------------------
  // 内部：入参守卫
  // ------------------------------------------------------------------

  /** INV-10：指令内 {占位符} 须全部替换（BIZ_ADJUST_PLACEHOLDER_UNRESOLVED）。 */
  private checkPlaceholders(instructionText: string): void {
    const match = instructionText.match(PLACEHOLDER_PATTERN);
    if (match !== null) {
      throw new BizException(ADJUST_PLACEHOLDER_UNRESOLVED, `指令占位符未替换：${match[0]}`);
    }
  }

  /**
   * 品牌规范约束解析（api-adjustment §4.1 applyBrandKit/brandKitId）：
   * apply=false 归一化丢弃 brandKitId；apply=true 时空取 Deck 默认规范，
   * 解析结果必须启用态（未删除且属主一致——经 AssetDomainService 进程内 OHS
   * provider-get 语义校验，v1 countValidBrandKit 同口径）。
   */
  private async resolveBrandKit(
    deck: DeckDocument,
    userId: string,
    applyBrandKit: boolean | undefined,
    brandKitId: string | undefined,
  ): Promise<BrandKitConstraint> {
    if (applyBrandKit !== true) {
      return { apply: false, brandKitId: null, kit: null };
    }
    const resolved = isNotBlank(brandKitId)
      ? brandKitId
      : isNotBlank(deck.default_brand_kit_id)
        ? deck.default_brand_kit_id
        : undefined;
    if (!isNotBlank(resolved)) {
      throw this.scopeInvalid('applyBrandKit=true 时须指定品牌规范（且创作物无默认规范可用）');
    }
    const brandKit = await this.assetDomainService.getBrandKit(resolved, userId);
    if (brandKit == null) {
      throw this.scopeInvalid('品牌规范不存在或已停用');
    }
    return { apply: true, brandKitId: resolved, kit: brandKit };
  }

  /**
   * F04：品牌规范值注入快照（PRD prd-adjustment §54——色板/字体/logo 约束须
   * 成为模型可读上下文；仅存 brandKitId 时模型无从应用）。logo 为限时 URL，
   * 随任务快照固化（30min 内网关执行有效，过期即上下文降级，不阻断）。
   */
  private applyBrandKitContext(
    snapshot: Record<string, unknown>,
    brandKit: BrandKitConstraint,
  ): void {
    if (!brandKit.apply || brandKit.kit == null) {
      return;
    }
    snapshot['brandKit'] = {
      brandKitId: brandKit.kit.brandKitId,
      kitName: brandKit.kit.kitName,
      colors: brandKit.kit.colors,
      fonts: brandKit.kit.fonts,
      logoAssetId: brandKit.kit.logoAssetId,
      logoUrl: brandKit.kit.logoUrl,
    };
  }

  /**
   * F04：基线内容中的图片素材上下文注入（assetId→名称/类型）——
   * 模型仅凭内部 ID 无法理解引用图，注入简述供调整时保持/替换图片。
   */
  private async appendAssetContext(
    snapshot: Record<string, unknown>,
    baseContent: Record<string, unknown> | null,
    userId: string,
  ): Promise<void> {
    const assetIds: string[] = [];
    if (baseContent === null) {
      return;
    }
    try {
      assertSnapshotShape(baseContent);
      for (const page of snapshotPageList(baseContent)) {
        for (const block of snapshotBlockList(page)) {
          const assetId = block.assetId;
          if (typeof assetId === 'string' && assetId.trim().length > 0) {
            assetIds.push(assetId);
          }
        }
      }
    } catch {
      // loadBaseVersion 已保证 content 形状；防御路径不注入即可
      return;
    }
    if (assetIds.length === 0) {
      return;
    }
    const briefs = await this.assetDomainService.getAssetBriefs(userId, assetIds);
    if (briefs.length > 0) {
      snapshot['assetContext'] = briefs;
    }
  }

  /**
   * 话术模板存在性校验（api-adjustment §4.5 轻量；仅记录来源不取正文）。
   * AssetDomainService#assertTemplatesExist 抛普通 Error（错误码由本域映射，
   * asset 域注释契约），此处转 BIZ_ADJUST_SCOPE_INVALID。
   */
  private async checkUsedTemplates(
    userId: string,
    usedTemplateIds: string[] | undefined,
  ): Promise<string[]> {
    const distinct =
      usedTemplateIds == null ? [] : [...new Set(usedTemplateIds.filter(isNotBlank))];
    if (distinct.length === 0) {
      return distinct;
    }
    try {
      await this.assetDomainService.assertTemplatesExist(userId, distinct);
    } catch {
      throw this.scopeInvalid('话术模板不存在或已删除');
    }
    return distinct;
  }

  /**
   * 分叉决策（D3：基线≠当前版本时提交语义=「从基线分叉调整」，提示命名分支）：
   * confirm≠true → prompt（不下任务）；confirm=true → 要求 branchName
   * （非空、非当前活动分支、同 deck 未占用，早期拦截；留档 uk_deck_branch 兜底）。
   */
  private async decideFork(
    deck: DeckDocument,
    baseVersion: BaseVersionRow,
    confirm: boolean | undefined,
    branchName: string | undefined,
  ): Promise<ForkDecision> {
    const forkNeeded = baseVersion.versionId !== (deck.current_version_id ?? null);
    if (!forkNeeded) {
      return { forked: false, prompt: false, forkBranchName: null };
    }
    if (confirm !== true) {
      return { forked: true, prompt: true, forkBranchName: null };
    }
    if (!isNotBlank(branchName)) {
      throw this.scopeInvalid('基线与当前版本不一致，确认分叉须命名分支（branchName）');
    }
    if (branchName === deck.active_branch) {
      throw this.scopeInvalid(`分叉分支名与当前活动分支相同：${branchName}`);
    }
    if ((await this.queryRepository.countVersionBranch(deck.deck_id, branchName)) > 0) {
      throw this.scopeInvalid(`分支名已存在：${branchName}`);
    }
    return { forked: true, prompt: false, forkBranchName: branchName };
  }

  // ------------------------------------------------------------------
  // 内部：属主加载 / 会话
  // ------------------------------------------------------------------

  /** 属主加载（user_id 隔离 ADR-005；deck 域契约异常类型透传，错误码透传不吞并）。 */
  private async loadOwnedDeck(deckId: string, userId: string): Promise<DeckDocument> {
    const deck = await this.deckDomainService.getDeck(deckId, userId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG);
    }
    return deck;
  }

  /**
   * 基线版本守卫：归属该 deck 且属主一致且内容非空
   * （api-adjustment §4.4 whole/submit 校验，BIZ_ADJUST_BASE_VERSION_INVALID）。
   */
  private async loadBaseVersion(
    deck: DeckDocument,
    versionId: string,
    userId: string,
  ): Promise<BaseVersionRow> {
    const row = await this.queryRepository.findBaseVersionRow(versionId);
    if (
      row == null ||
      row.versionId == null ||
      row.deckId !== deck.deck_id ||
      row.userId !== userId ||
      row.content == null
    ) {
      throw new BizException(
        ADJUST_BASE_VERSION_INVALID,
        '基线版本无效：不存在、不属于该创作物或内容为空',
      );
    }
    return row;
  }

  private requireUserId(userId: string): void {
    if (!isNotBlank(userId)) {
      throw this.scopeInvalid('缺少用户会话上下文');
    }
  }

  private requireTargetKind(targetKind: string): string {
    if (!Object.values(TargetKind).includes(targetKind as TargetKindCode)) {
      throw this.scopeInvalid(`targetKind非法[${targetKind}]`);
    }
    return targetKind;
  }

  private scopeInvalid(message: string): BizException {
    return new BizException(ADJUST_SCOPE_INVALID, message);
  }
}

/* ------------------------------------------------------------------ */
/* 内部值对象（v1 record 平移）                                         */
/* ------------------------------------------------------------------ */

/** 品牌约束归一结果（apply=true 时 brandKitId 必非空且已校验，kit 为规范值） */
interface BrandKitConstraint {
  apply: boolean;
  brandKitId: string | null;
  /** 品牌规范值（F04 注入快照用；apply=false 时为 null） */
  kit: BrandKitProviderGetVO | null;
}

/**
 * 分叉决策结果：forked=基线≠当前；prompt=true 表示 confirm 未确认，
 * 调用方返回提示态不创建任务；forkBranchName=确认后的分叉分支名（快照承载）。
 */
interface ForkDecision {
  forked: boolean;
  prompt: boolean;
  forkBranchName: string | null;
}

/** 非空白判定（收窄谓词；v1 isBlank 取反语义，generation.domain-service 同款） */
function isNotBlank(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}
