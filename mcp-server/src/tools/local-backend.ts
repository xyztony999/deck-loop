/**
 * LocalBackend（ADR-017 本地模式装配缝实现）：LocalCore 进程内直调域服务，
 * SQLite/固定属主/零鉴权——现状语义原样保留（零回归）。
 *
 * version_create 编排自 tools/version.ts 迁入（agent 直写路径）：与线上
 * VersionAgentService 同口径（状态守卫/sourceType 判定/定向基线固化+不变性/
 * 首版流转），落库经同一 VersionArchiveService 唯一写入口（06 §8.2）。
 */
import { join } from 'node:path';
import type { LocalCore } from '@deck-loop/core/dist/local';
import { DeckManageService } from '@deck-loop/core/dist/deck/deck.manage-service';
import { DeckDomainService } from '@deck-loop/core/dist/deck/deck.domain-service';
import { DECK_NOT_FOUND, DECK_STATUS_FORBIDDEN, DECK_OUTLINE_INVALID } from '@deck-loop/core/dist/deck/deck.errors';
import { VERSION_TARGET_INVARIANCE } from '@deck-loop/core/dist/version/version.errors';
import { VersionArchiveService } from '@deck-loop/core/dist/version/version.archive-service';
import { VersionManageService } from '@deck-loop/core/dist/version/version.manage-service';
import { VersionArchiveCommand } from '@deck-loop/core/dist/version/version.dto';
import { assertTargetedInvariance } from '@deck-loop/core/dist/version/targeted-invariance';
import { agentContentMaxBytes } from '@deck-loop/core/dist/version/version.agent-service';
import { extractAssetIds } from '@deck-loop/core/dist/version/version.content-support';
import { AssetService, BrandKitService, PromptTemplateService } from '@deck-loop/core/dist/asset/asset.service';
import { AssetRepository } from '@deck-loop/core/dist/asset/asset.repository';
import { ExportService } from '@deck-loop/core/dist/deliver/export.service';
import { DeckStatus, VersionSourceType } from '@deck-loop/core/dist/common/enums';
import { BizException } from '@deck-loop/core/dist/common/exceptions';
import { nextId } from '@deck-loop/core/dist/common/utils/snowflake';
import { fileToDataUri } from '../render/export-renderer';
import type { LocalPaths } from '../paths';
import type {
  AssetUploadFile,
  DeckSnapshot,
  ExportSubmitReceipt,
  ToolBackend,
  VersionCreateInput,
  VersionCreateReceipt,
} from './backend';
import { serializeOutline, validateOutline, type OutlineNode } from './outline';

/**
 * zod 校验后的纯对象 → 域服务 AO 结构断言（NR-01 escape：服务 AO 为 class 类型，
 * 运行时仅读属性，zod schema 与 AO 字段同契约；进程内直调不经 ValidationPipe）。
 */
function asAo<T>(value: Record<string, unknown>): T {
  return value as unknown as T;
}

export class LocalBackend implements ToolBackend {
  readonly mode = 'local' as const;

  constructor(
    private readonly core: LocalCore,
    private readonly userId: string,
    private readonly paths: LocalPaths,
  ) {}

  /* ---------------- deck ---------------- */

  async deckSave(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(DeckManageService).save(asAo(ao), this.userId);
  }

  async deckList(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(DeckManageService).listPage(asAo(ao), this.userId);
  }

  async deckDetail(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(DeckManageService).detail(asAo(ao), this.userId);
  }

  async deckGet(deckId: string): Promise<DeckSnapshot | null> {
    const deck = await this.core.get(DeckDomainService).getDeck(deckId, this.userId);
    if (deck == null) {
      return null;
    }
    return {
      deckId: deck.deck_id,
      deckName: deck.deck_name,
      deckStatus: deck.deck_status,
      currentVersionId: deck.current_version_id ?? null,
      activeBranch: deck.active_branch,
      finalVersionId: deck.final_version_id ?? null,
    };
  }

  async deckFinalize(deckId: string): Promise<void> {
    await this.core.get(DeckManageService).finalize(deckId, true, this.userId);
  }

  async deckUnfinalize(deckId: string): Promise<void> {
    await this.core.get(DeckManageService).unfinalize(deckId, true, this.userId);
  }

  async deckArchive(deckId: string): Promise<void> {
    await this.core.get(DeckManageService).archive(deckId, this.userId);
  }

  async deckRestore(deckId: string): Promise<void> {
    await this.core.get(DeckManageService).restore(deckId, this.userId);
  }

  async deckDelete(deckId: string): Promise<void> {
    await this.core.get(DeckManageService).delete(deckId, this.userId);
  }

  async outlineSave(deckId: string, nodes: OutlineNode[]): Promise<void> {
    const domain = this.core.get(DeckDomainService);
    const deck = await domain.getDeck(deckId, this.userId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, '创作物不存在');
    }
    if (deck.deck_status !== DeckStatus.DRAFT) {
      throw new BizException(DECK_OUTLINE_INVALID, '首个版本生成后大纲转只读，仅草稿状态可编辑');
    }
    const invalid = validateOutline(nodes);
    if (invalid != null) {
      throw new BizException(DECK_OUTLINE_INVALID, invalid);
    }
    await domain.updateDraftOutline(deckId, serializeOutline(nodes), this.userId);
  }

  /* ---------------- version ---------------- */

  async versionCreate(input: VersionCreateInput): Promise<VersionCreateReceipt> {
    const deckDomain = this.core.get(DeckDomainService);
    const archive = this.core.get(VersionArchiveService);
    const deck = await deckDomain.getDeck(input.deckId, this.userId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, '创作物不存在');
    }
    // INV-3 状态守卫（与线上 agent-create 同口径）
    if (deck.deck_status !== DeckStatus.DRAFT && deck.deck_status !== DeckStatus.ITERATING) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '已定稿或归档的创作物禁止写入版本');
    }
    this.assertPayloadRedlines(input.content, input.instruction);

    const content = input.content;
    const taskId = `agent-${nextId()}`;
    const baselineId = input.parentVersionId ?? deck.current_version_id ?? null;
    const sourceType =
      input.scope != null
        ? VersionSourceType.TARGETED_ADJUST
        : baselineId != null
          ? VersionSourceType.FULL_ADJUST
          : VersionSourceType.FULL_GENERATE;

    const instructionSnapshot: Record<string, unknown> = { instruction: input.instruction };
    if (input.scope != null) {
      // 定向调整：基线固化进快照 + 非目标不变性校验（越界抛错，不产版本）
      if (baselineId == null) {
        throw new BizException(VERSION_TARGET_INVARIANCE, '定向调整须有基线版本（首版请用整稿生成）');
      }
      const baseContent = await archive.getVersionContent(baselineId, this.userId);
      instructionSnapshot['targetPath'] = input.scope;
      instructionSnapshot['baseContent'] = baseContent;
      assertTargetedInvariance(instructionSnapshot, content, taskId);
    }

    const command = new VersionArchiveCommand();
    command.deckId = input.deckId;
    command.userId = this.userId;
    command.taskId = taskId;
    command.sourceType = sourceType;
    command.instructionSnapshot = instructionSnapshot;
    command.content = content;
    command.parentVersionId = input.parentVersionId ?? null;
    command.branchName = input.branchName ?? null;

    const wasDraft = deck.deck_status === DeckStatus.DRAFT;
    const result = await archive.createVersionFromTask(command);
    if (wasDraft) {
      // 首版流转 DRAFT→ITERATING（幂等）
      await deckDomain.onFirstVersionCreated(input.deckId, this.userId);
    }
    const branchName = input.branchName ?? deck.active_branch ?? 'main';
    return { ...result, sourceType, taskId, branchName };
  }

  async versionTree(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(VersionManageService).tree(asAo(ao), this.userId);
  }

  async versionDetail(versionId: string): Promise<Record<string, unknown>> {
    const detail = await this.core.get(VersionManageService).detail({ versionId }, this.userId);
    // 完整 VO 原样透出（contentHash/instructionSnapshot 等回执字段两模式一致）
    return detail as unknown as Record<string, unknown>;
  }

  async versionCompare(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(VersionManageService).compare(asAo(ao), this.userId);
  }

  async versionRollback(deckId: string, versionId: string): Promise<void> {
    await this.core.get(VersionManageService).rollback({ deckId, versionId, confirm: true }, this.userId);
  }

  async versionFork(deckId: string, versionId: string, branchName: string): Promise<void> {
    await this.core.get(VersionManageService).fork({ deckId, versionId, branchName }, this.userId);
  }

  /* ---------------- asset ---------------- */

  async assetUpload(file: AssetUploadFile, ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(AssetService).upload(
      {
        fieldname: 'file',
        originalname: file.originalname,
        encoding: '7bit',
        mimetype: file.mimetype,
        size: file.buffer.length,
        buffer: file.buffer,
      },
      asAo(ao),
      this.userId,
    );
  }

  async assetList(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(AssetService).listPage(asAo(ao), this.userId);
  }

  async brandkitSave(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(BrandKitService).save(asAo(ao), this.userId);
  }

  async brandkitList(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(BrandKitService).listPage(asAo(ao), this.userId);
  }

  async brandkitSetDefault(brandKitId: string): Promise<void> {
    await this.core.get(BrandKitService).setDefault({ brandKitId }, this.userId);
  }

  async brandkitDelete(brandKitId: string): Promise<void> {
    await this.core.get(BrandKitService).delete({ brandKitId }, this.userId);
  }

  async promptSave(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(PromptTemplateService).save(asAo(ao), this.userId);
  }

  async promptList(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(PromptTemplateService).listPage(asAo(ao), this.userId);
  }

  async promptDelete(templateId: string): Promise<void> {
    await this.core.get(PromptTemplateService).delete({ templateId }, this.userId);
  }

  /* ---------------- deliver ---------------- */

  async exportSubmit(ao: Record<string, unknown>): Promise<ExportSubmitReceipt> {
    const vo = await this.core.get(ExportService).submit(asAo(ao), this.userId);
    return { exportId: vo.exportId, exportStatus: vo.exportStatus, needConfirm: vo.needConfirm };
  }

  async exportList(ao: Record<string, unknown>): Promise<unknown> {
    return this.core.get(ExportService).listPage(asAo(ao), this.userId);
  }

  async exportUpload(exportId: string, bytes: Buffer): Promise<unknown> {
    return this.core.get(ExportService).uploadArtifact(exportId, { buffer: bytes }, this.userId);
  }

  async exportFail(exportId: string, errorMsg: string): Promise<void> {
    await this.core.get(ExportService).reportFailure({ exportId, errorMsg }, this.userId);
  }

  async finalizedContent(deckId: string): Promise<Record<string, unknown>> {
    const { finalVersionId } = await this.core.get(DeckDomainService).assertFinalized(deckId, this.userId);
    return this.core.get(VersionArchiveService).getVersionContent(finalVersionId, this.userId);
  }

  async resolveImages(content: Record<string, unknown>): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const assetIds = extractAssetIds(content);
    if (assetIds.length === 0) {
      return urls;
    }
    const found = await this.core.get(AssetRepository).findByIds(this.userId, assetIds);
    for (const asset of found) {
      urls.set(asset.asset_id, await fileToDataUri(join(this.paths.assetsDir, asset.storage_key)));
    }
    return urls;
  }

  async close(): Promise<void> {
    await this.core.close();
  }

  /* ---------------- 内部 ---------------- */

  /** 载荷红线（与线上 VersionAgentService 同口径：pages 1~200/instruction ≤2000/content ≤2MB） */
  private assertPayloadRedlines(content: Record<string, unknown>, instruction: string): void {
    if (typeof instruction !== 'string' || instruction.length === 0 || instruction.length > 2000) {
      throw new BizException(VERSION_TARGET_INVARIANCE, 'instruction 须为 1~2000 字');
    }
    const pages = content['pages'];
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > 200) {
      throw new BizException(VERSION_TARGET_INVARIANCE, '页数须在 1~200 之间');
    }
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > agentContentMaxBytes()) {
      throw new BizException(VERSION_TARGET_INVARIANCE, 'content 体积超过上限');
    }
  }
}