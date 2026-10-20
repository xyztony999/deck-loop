import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { BizException } from '../common/exceptions';
import { DeckStatus } from '../common/enums';
import {
  DECK_NOT_FOUND,
  DECK_NOT_FOUND_MSG,
  DECK_STATUS_FORBIDDEN,
} from './deck.errors';
import { DeckEventPublisher } from './deck.events';
import { DeckRepository } from './deck.repository';
import { DeckStatsRepository } from './deck.stats.repository';
import type { DeckDocument } from './schemas/dl_deck.schema';

/**
 * deck 域领域服务 —— 跨域（进程内直调）契约（api-deck §4.1 / domain-manifest §1④、§10）。
 *
 * 消费方（单服务进程内直调，无 HTTP 回环）：
 * - generation / adjustment：任务创建前 INV-3 守卫 assertCanCreateTask；
 *   整稿生成成功回调 movePointer + onFirstVersionCreated（INV-1/INV-4）、
 *   OUTLINE 产物/大纲保存 updateDraftOutline
 * - version：rollback/fork 后指针回写 movePointer（版本归属校验后调用）
 * - deliver：FINALIZED 守卫 assertFinalized（错误码复用 deck 域 DECK_STATUS_FORBIDDEN）
 *
 * 方法签名对齐 manifest §10 建议签名；异步实现返回 Promise（Mongo I/O）。
 * 可选尾参 session：加入调用方（generation 成功回调编排）的跨聚合事务；
 * 状态变更事件按 NR-07 事务提交后发布（见 DeckEventPublisher）。
 *
 * deck 域零出站：本类仅消费本域 repository/stats 只读查询，不 import 他域 Service。
 */
@Injectable()
export class DeckDomainService {
  constructor(
    private readonly deckRepository: DeckRepository,
    private readonly deckStatsRepository: DeckStatsRepository,
    private readonly eventPublisher: DeckEventPublisher,
  ) {}

  /* ------------------------------------------------------------------ */
  /* INV-3：任务创建守卫（generation / adjustment 域调用）                  */
  /* ------------------------------------------------------------------ */

  /** FINALIZED/ARCHIVED 态禁止创建生成/调整任务；不存在/非属主 → NOT_FOUND */
  async assertCanCreateTask(deckId: string, userId: string): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    const status = deck.deck_status;
    if (status === DeckStatus.FINALIZED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '已定稿的创作物禁止创建任务');
    }
    if (status === DeckStatus.ARCHIVED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '已归档的创作物禁止创建任务');
    }
  }

  /* ------------------------------------------------------------------ */
  /* INV-4：首版生成成功 DRAFT → ITERATING（幂等，有且仅有一次）            */
  /* ------------------------------------------------------------------ */

  /**
   * 首个版本创建成功 → DRAFT 流转 ITERATING。
   * 幂等：已 ITERATING（并发/重复回调）直接返回；非 DRAFT 非 ITERATING 拒绝。
   * 乐观锁 0 行时重载判定：已被并发流转（ITERATING）视为幂等成功，否则真实冲突。
   * 成功后发布 deck_deck_status-changed（事务提交后，NR-07）。
   */
  async onFirstVersionCreated(
    deckId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status === DeckStatus.ITERATING) {
      // 幂等：并发回调或重复回调时已流转完成
      return;
    }
    if (deck.deck_status !== DeckStatus.DRAFT) {
      throw new BizException(
        DECK_STATUS_FORBIDDEN,
        `当前状态不允许首版流转[${deck.deck_status}]`,
      );
    }
    const updated = await this.deckRepository.conditionalUpdate({
      deckId,
      userId,
      expectedStatuses: [DeckStatus.DRAFT],
      expectedDataVersion: deck.data_version,
      setFields: {
        deck_status: DeckStatus.ITERATING,
        updated_by: userId,
        updated_name: userId,
      },
      session,
    });
    if (!updated) {
      // 乐观锁冲突：重载判定是否已被并发流转（幂等成功）或真实冲突
      const latest = await this.deckRepository.findByIdOwned(deckId, userId, session);
      if (latest == null || latest.deck_status !== DeckStatus.ITERATING) {
        throw new BizException(DECK_STATUS_FORBIDDEN, '创作物已被并发修改，首版状态流转失败');
      }
    }
    this.eventPublisher.publishStatusChanged(deckId, DeckStatus.ITERATING, userId, session);
  }

  /* ------------------------------------------------------------------ */
  /* INV-1：当前版本指针回写统一入口（version 域 rollback/fork、generation 任务回调） */
  /* ------------------------------------------------------------------ */

  /**
   * 守卫链（v1 DeckDomainServiceImpl#movePointer 逐字对齐）：
   * 1. versionId 非空（否则 NOT_FOUND）；
   * 2. 归属校验：deck 存在且属主（user_id 隔离）；版本归属本 Deck
   *    （dl_deck_version 只读点查 countVersionInDeck，否则 NOT_FOUND）；
   * 3. 状态机：DRAFT 仅允许首版指针（currentVersionId 为空时）；ITERATING 可移；
   *    FINALIZED/ARCHIVED 拒绝（STATUS_FORBIDDEN）；
   * 4. branchName 非空时同步切换 active_branch（fork 场景）；
   * 5. 条件更新乐观锁（filter 携带 deck_status 期望值 + data_version），
   *    0 行=并发修改拒绝。
   * 指针/分支移动非状态变更，不发 deck_deck_status-changed（v1 口径）。
   */
  async movePointer(
    deckId: string,
    versionId: string,
    branchName: string | undefined,
    userId: string,
    session?: ClientSession,
  ): Promise<void> {
    if (isBlank(versionId)) {
      throw new BizException(DECK_NOT_FOUND, '版本ID不能为空');
    }
    const deck = await this.loadOwned(deckId, userId);
    // INV-1 守卫：版本必须归属本 Deck
    const owned = await this.deckStatsRepository.countVersionInDeck(versionId, deckId, session);
    if (owned <= 0) {
      throw new BizException(DECK_NOT_FOUND, '版本不存在或不属于该创作物');
    }
    const status = deck.deck_status;
    const draftWithEmptyPointer =
      status === DeckStatus.DRAFT && isBlank(deck.current_version_id ?? undefined);
    if (!draftWithEmptyPointer && status !== DeckStatus.ITERATING) {
      throw new BizException(
        DECK_STATUS_FORBIDDEN,
        `当前状态[${status}]不允许移动版本指针`,
      );
    }
    const setFields: Record<string, unknown> = {
      current_version_id: versionId,
      updated_by: userId,
      updated_name: userId,
    };
    if (!isBlank(branchName)) {
      setFields.active_branch = branchName!;
    }
    const updated = await this.deckRepository.conditionalUpdate({
      deckId,
      userId,
      expectedStatuses: [status],
      expectedDataVersion: deck.data_version,
      setFields,
      session,
    });
    if (!updated) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '创作物已被并发修改，指针回写失败');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 大纲定向写入（generation 域 outline/save 与 OUTLINE 成功回调）         */
  /* ------------------------------------------------------------------ */

  /**
   * Deck.draft_outline 单字段定向更新（api-generation §4.3 跨模块写）。
   * 无状态守卫（v1 updateDeckDraftOutline 语义：DRAFT 可编辑守卫在 generation 侧
   * outline/save 入口执行；OUTLINE 任务回调路径 deck 可能非 DRAFT）；
   * 属主隔离 + 未删除一并校验，0 行=不存在。
   */
  async updateDraftOutline(
    deckId: string,
    outline: Record<string, unknown>,
    userId: string,
    session?: ClientSession,
  ): Promise<void> {
    const updated = await this.deckRepository.updateDraftOutline(
      deckId,
      userId,
      outline,
      userId,
      userId,
      session,
    );
    if (!updated) {
      throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 进程内读取 / deliver 域守卫                                          */
  /* ------------------------------------------------------------------ */

  /**
   * 按 ID 加载创作物（进程内供他域读取；userId 提供时做属主过滤，
   * 省略时不过滤——v1 getById 语义，调用方自行保证上下文）。
   */
  async getDeck(deckId: string, userId?: string): Promise<DeckDocument | null> {
    if (isBlank(deckId)) {
      return null;
    }
    return this.deckRepository.findById(deckId, userId);
  }

  /** FINALIZED 守卫（deliver 域导出/放映前置）；返回定稿版本锚点（manifest §10 契约） */
  async assertFinalized(deckId: string, userId: string): Promise<{ deckId: string; finalVersionId: string }> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status !== DeckStatus.FINALIZED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '创作物未定稿');
    }
    return { deckId: deck.deck_id, finalVersionId: deck.final_version_id ?? '' };
  }

  /* ------------------------------------------------------------------ */
  /* 内部                                                                */
  /* ------------------------------------------------------------------ */

  /** 属主加载（user_id 隔离 + 未删除；失败统一 NOT_FOUND） */
  private async loadOwned(deckId: string, userId: string, session?: ClientSession): Promise<DeckDocument> {
    if (isBlank(deckId)) {
      throw new BizException(DECK_NOT_FOUND, 'deckId不能为空');
    }
    const deck = await this.deckRepository.findByIdOwned(deckId, userId, session);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG);
    }
    return deck;
  }
}

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim().length === 0;
}
