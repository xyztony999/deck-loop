import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';
import { VersionSourceType, type VersionSourceTypeCode } from '../common/enums';
import { BizException } from '../common/exceptions';
import { nextId } from '../common/utils/snowflake';
import { AssetDomainService } from '../asset/asset.service';
import { DeckDomainService } from '../deck/deck.domain-service';
import {
  extractAssetIds,
  pageCount as countPages,
  sha256Hex,
  assertContentShape,
} from './version.content-support';
import {
  isPlainObject,
  VersionArchiveCommand,
  VersionArchiveResult,
  type ContentSnapshot,
} from './version.dto';
import {
  VERSION_BRANCH_EXISTS,
  VERSION_NOT_FOUND,
} from './version.errors';
import { VersionEventPublisher } from './version.events';
import { VersionRepository } from './version.repository';
import type { DeckVersionDocument } from './schemas/dl_deck_version.schema';

/** 锁内复查谓词（fork/分叉留档：seq 分配事务内重检分支名可用；false 抛 BRANCH_EXISTS） */
export type VersionWriteGuard = (session: ClientSession) => Promise<boolean> | boolean;

/** 版本域只读统计（manifest §10：countByDeck 契约；消费方 deck detail withStats 等） */
export interface VersionDeckStats {
  versionCount: number;
  adjustCount: number;
}

/**
 * 版本留档应用服务（v1 VersionArchiveWriter + VersionDomainServiceImpl 合一平移；
 * manifest §10 跨域契约承载类——VersionArchiveService）。
 *
 * **版本写入唯一入口（api-version §3.2）**：createVersionFromTask 仅由任务成功
 * 回调路径调用（generation 域）；insertAndAdvance 为域内共享写组件（fork 复制行
 * 共用）——「禁止任何 update content 的接口存在」指对外接口无 update 语义，
 * fork 为指针编排的域内插入动作，不违背 INV-11。
 *
 * ## 编排步骤（含 fork 分支链）
 *
 * 1. 命令校验（必填/快照对象形状/sourceType 值域，v1 assertCommandValid）；
 * 2. deck 加载 + 属主比对（回调线程无会话上下文，ADR-005 显式 userId）；
 * 3. parentVersionId 解析：command.parentVersionId ?? deck.current_version_id
 *    （分叉留档=快照 baseVersionId；INV-13 非空必须同 deck 存在）；
 * 4. branchName 解析：command.branchName ?? deck.active_branch
 *    （≠活动分支=分叉留档：D3 adjust forkBranchName，generation 侧快照解析后
 *    经 command.branchName 传入——v1 修复后的 applyForkFromSnapshot 链）；
 * 5. 事务内：seq 分配（deck 维度 MAX+1）→ 分叉留档时锁内 branch 守卫复查
 *    （「检查-插入」竞态规避，v1 writeGuard 同款谓词）→ insertOnly
 *    （uk_deck_branch 复合唯一兜底 E11000）；
 * 6. 事务提交后：deck.movePointer（INV-1 指针/分支回写，分支随指针切换）→
 *    asset.adjustRefCounts(+1)（INV-18 每版本至多一次）；
 * 7. 全部写成功后发 ver_version_created（NR-07：事务提交后发布，失败不发）。
 *
 * ## 两段式事务说明（对 v1 的已知偏离，遗留项）
 * v1 为单事务（insert+movePointer+adjustRefCounts 同 REQUIRED 事务）。v3 落盘的
 * deck 域 `DeckDomainService#movePointer` 其归属守卫读
 * （DeckStatsRepository#countVersionInDeck）**不接受 session**——留档事务内新插入
 * 的版本对它不可见，指针回写必然 NOT_FOUND；且 asset 域
 * `AssetDomainService#adjustRefCounts` 跨域签名亦无 session 形参。故本类按
 * 「事务内 insert → 提交后顺序编排 movePointer/adjustRefCounts」两段式实现：
 * - movePointer/adjustRefCounts 失败 → 版本已提交但指针/计数缺失（异常上抛，
 *   由 generation 回调侧重试语义消化）；
 * - 修复建议（deck/asset 域，非本域文件）：为 countVersionInDeck 与
 *   adjustRefCounts 增加可选 session 并在 movePointer 读路径透传，即可恢复
 *   v1 单事务编排（本类调用点已预留同事务收口位置）。
 */
@Injectable()
export class VersionArchiveService {
  constructor(
    private readonly versionRepository: VersionRepository,
    private readonly deckDomainService: DeckDomainService,
    private readonly assetDomainService: AssetDomainService,
    private readonly eventPublisher: VersionEventPublisher,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /* ------------------------------------------------------------------ */
  /* 跨域契约（manifest §10）                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 版本留档（generation 任务成功回调路径唯一写入口）。
   * 命令契约见 VersionArchiveCommand 注释；返回 { versionId, versionSeq }。
   */
  async createVersionFromTask(command: VersionArchiveCommand): Promise<VersionArchiveResult> {
    this.assertCommandValid(command);

    const deck = await this.deckDomainService.getDeck(command.deckId);
    if (deck == null) {
      throw new BizException(VERSION_NOT_FOUND, '创作物不存在');
    }
    // ADR-005：回调线程无会话上下文，显式 userId 与属主比对（v1 对齐）
    if (command.userId !== deck.user_id) {
      throw new BizException(VERSION_NOT_FOUND, '留档命令 userId 与创作物属主不符');
    }

    // 父版本解析（首版=Deck.currentVersionId 为空 → parent=null）
    const parentVersionId = firstNonBlank(
      command.parentVersionId,
      deck.current_version_id ?? null,
    );
    if (parentVersionId != null) {
      // INV-13：父版本若非空必须同 deck 存在
      await this.assertVersionInDeck(parentVersionId, deck.deck_id);
    }

    const branchName = firstNonBlank(command.branchName, deck.active_branch) ?? 'main';
    const assetIds = extractAssetIds(command.content);
    // 分叉留档（command.branchName=adjust 快照 forkBranchName ≠活动分支，D3）：
    // 与 fork 接口同规约——锁内复查分支名可用（uk_deck_branch 含 version_seq，
    // 不同 seq 的同名分支不触发唯一键，锁内重检才是冲突安全）
    const isForkArchive = branchName !== deck.active_branch;
    return this.insertAndAdvance(
      { ...command, parentVersionId, branchName },
      assetIds,
      isForkArchive
        ? this.branchConflictGuard(branchName, deck.deck_id, deck.active_branch)
        : undefined,
    );
  }

  /**
   * 进程内读取：content 快照（消费方 adjustment 基线/scope 校验、deliver 演示/渲染；
   * deck→version 级联归属校验，api-version §3.3）。
   */
  async getVersionContent(versionId: string, userId: string): Promise<ContentSnapshot> {
    const version = await this.loadOwnedVersionCascade(versionId, userId);
    return version.content;
  }

  /**
   * 进程内只读统计：{ versionCount（deck 全量版本）, adjustCount（整稿/定向调整留档数，
   * source_type 口径——区别于 deck 域 stats 以任务表统计的 adjustCount）}。
   * 消费方 deck detail withStats（版本视角补充）等。
   */
  async countByDeck(deckId: string, userId: string): Promise<VersionDeckStats> {
    const deck = await this.deckDomainService.getDeck(deckId, userId);
    if (deck == null) {
      throw new BizException(VERSION_NOT_FOUND, '创作物不存在');
    }
    const [versionCount, adjustCount] = await Promise.all([
      this.versionRepository.countByDeck(deckId),
      this.versionRepository.countByDeckAndSourceTypes(deckId, [
        VersionSourceType.FULL_ADJUST,
        VersionSourceType.TARGETED_ADJUST,
      ]),
    ]);
    return { versionCount, adjustCount };
  }

  /* ------------------------------------------------------------------ */
  /* 域内共享写路径（v1 VersionArchiveWriter#insertAndAdvance 对齐）        */
  /* ------------------------------------------------------------------ */

  /**
   * 插入版本并推进指针/引用计数，全部写成功后发 ver_version_created。
   *
   * @param command    已就绪的留档命令（versionId/versionSeq 由本方法分配回填；
   *                   branchName 必填——同时作为 movePointer 的分支参数）
   * @param assetIds   content 内素材引用集合（INV-18 +1；空集合无操作）
   * @param writeGuard 事务内复查谓词（分叉留档/fork：false 抛 BIZ_VERSION_BRANCH_EXISTS；
   *                   undefined=常规留档无需复查）
   */
  async insertAndAdvance(
    command: VersionArchiveCommand,
    assetIds: string[],
    writeGuard?: VersionWriteGuard,
  ): Promise<VersionArchiveResult> {
    const deckId = command.deckId;
    const userId = command.userId;
    const branchName = command.branchName ?? 'main';

    let inserted: DeckVersionDocument | undefined;
    await this.connection.transaction(async (session) => {
      // seq 分配：事务快照读 MAX+1（v1 SELECT MAX FOR UPDATE 的 Mongo 口径：
      // 快照读+同事务插入收窄窗口，uk_deck_branch 唯一索引兜底并发取号）
      const maxSeq = await this.versionRepository.findMaxVersionSeq(deckId, session);
      const versionSeq = (maxSeq ?? 0) + 1;
      if (writeGuard !== undefined && !(await writeGuard(session))) {
        throw new BizException(VERSION_BRANCH_EXISTS, '分支名已存在（并发分叉冲突）');
      }
      const now = new Date();
      inserted = await this.versionRepository.insert(
        {
          version_id: nextId(),
          deck_id: deckId,
          version_seq: versionSeq,
          branch_name: branchName,
          parent_version_id: command.parentVersionId ?? null,
          source_type: command.sourceType,
          task_id: command.taskId,
          instruction_snapshot: command.instructionSnapshot,
          content: command.content,
          content_hash: sha256Hex(command.content),
          page_count: countPages(command.content),
          user_id: userId,
          created_by: userId,
          created_name: userId,
          created_time: now,
        },
        session,
      );
      // 单事务编排（v1 同款）：插入→指针/分支回写（INV-1）→引用计数（INV-18）
      await this.deckDomainService.movePointer(
        deckId,
        inserted.version_id,
        branchName,
        userId,
        session,
      );
      await this.assetDomainService.adjustRefCounts(userId, assetIds, 1, session);
    });
    if (inserted === undefined) {
      // 防御分支：transaction 回调必然完成赋值（或整体抛出）
      throw new BizException(VERSION_NOT_FOUND, '版本留档失败');
    }



    // ---- NR-07：全部写入成功后发布（回滚/失败不发）----
    this.eventPublisher.publishCreated({
      versionId: inserted.version_id,
      deckId,
      versionSeq: inserted.version_seq,
      branchName,
      userId,
      sourceType: command.sourceType,
    });
    return VersionArchiveResult.of(inserted.version_id, inserted.version_seq);
  }

  /* ------------------------------------------------------------------ */
  /* 内部                                                                */
  /* ------------------------------------------------------------------ */

  /** 命令校验（v1 assertCommandValid：必填/快照形状/来源类型值域） */
  private assertCommandValid(command: VersionArchiveCommand): void {
    if (command == null) {
      throw new BizException(VERSION_NOT_FOUND, '留档命令不能为空');
    }
    requireNonBlank(command.deckId, 'deckId');
    requireNonBlank(command.userId, 'userId');
    requireNonBlank(command.taskId, 'taskId');
    requireNonBlank(command.sourceType, 'sourceType');
    if (!isPlainObject(command.instructionSnapshot)) {
      throw new BizException(VERSION_NOT_FOUND, '留档命令缺少必填字段: instructionSnapshot');
    }
    if (!isPlainObject(command.content)) {
      throw new BizException(VERSION_NOT_FOUND, '留档命令缺少必填字段: content');
    }
    // content 形状快速失败（pages 数组；系统数据，集成缺陷）
    assertContentShape(command.content);
    if (!Object.values(VersionSourceType).includes(command.sourceType as VersionSourceTypeCode)) {
      throw new BizException(
        VERSION_NOT_FOUND,
        `版本来源类型非法[${command.sourceType}]`,
      );
    }
  }

  /** INV-13：父版本归属 deck 校验 */
  private async assertVersionInDeck(versionId: string, deckId: string): Promise<void> {
    const parent = await this.versionRepository.findById(versionId);
    if (parent == null || parent.deck_id !== deckId) {
      throw new BizException(VERSION_NOT_FOUND, '父版本不存在或不属于该创作物');
    }
  }

  /** version → deck → user 级联归属校验（getVersionContent 用） */
  private async loadOwnedVersionCascade(
    versionId: string,
    userId: string,
  ): Promise<DeckVersionDocument> {
    const version = await this.versionRepository.findById(versionId);
    if (version == null) {
      throw new BizException(VERSION_NOT_FOUND, '版本不存在');
    }
    const deck = await this.deckDomainService.getDeck(version.deck_id, userId);
    if (deck == null) {
      throw new BizException(VERSION_NOT_FOUND, '创作物不存在');
    }
    return version;
  }

  /**
   * 分支名冲突事务内复查（fork/分叉留档同款谓词，false 抛 BIZ_VERSION_BRANCH_EXISTS）。
   * 双条件（v1 同款）：已有分支清单不含该名 && 该名 ≠ 加载时活动分支
   * （活动分支可能尚无版本——仅存在于 dl_deck.active_branch，INV-12 联合唯一）。
   */
  private branchConflictGuard(
    branchName: string,
    deckId: string,
    activeBranchAtLoad: string,
  ): VersionWriteGuard {
    return async (session: ClientSession): Promise<boolean> => {
      const locked = await this.versionRepository.findBranchNames(deckId, session);
      return !locked.includes(branchName) && branchName !== activeBranchAtLoad;
    };
  }
}

function requireNonBlank(value: string | null | undefined, field: string): void {
  if (value == null || value.trim().length === 0) {
    throw new BizException(VERSION_NOT_FOUND, `留档命令缺少必填字段: ${field}`);
  }
}

function firstNonBlank(
  first: string | null | undefined,
  second: string | null | undefined,
): string | null {
  if (first != null && first.trim().length > 0) {
    return first;
  }
  return second != null && second.trim().length > 0 ? second : null;
}
