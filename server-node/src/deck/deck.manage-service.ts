import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { BizException } from '../common/exceptions';
import { DeckStatus, DeckType, DeleteSign, ExportStatus, TaskStatus, TaskType } from '../common/enums';
import { PageResult, SelectOption } from '../common/result';
import { nextId } from '../common/utils/snowflake';
import {
  DECK_NOT_FOUND,
  DECK_NOT_FOUND_MSG,
  DECK_STATUS_FORBIDDEN,
  DECK_TASK_RUNNING,
  DECK_TASK_RUNNING_MSG,
} from './deck.errors';
import { DeckEventPublisher } from './deck.events';
import {
  DeckDetailAO,
  DeckDetailLatestTask,
  DeckDetailStats,
  DeckDetailVO,
  DeckListAO,
  DeckListVO,
  DeckSaveAO,
  DeckSaveVO,
  DeckSelectListAO,
  parseTimeRangeBound,
} from './deck.dto';
import { DeckRepository } from './deck.repository';
import { DeckStatsRepository } from './deck.stats.repository';
import { resolveDeckOperList } from './deck.oper-resolver';
import { Deck } from './schemas/dl_deck.schema';
import type { DeckDocument } from './schemas/dl_deck.schema';

/**
 * 创作物管理 Service（C-01 创作物管理 + C-05 定稿管理，api-deck §4.4；v1 DeckManageServiceImpl 平移）。
 *
 * DeckStatus 状态机流转全部集中在本类与 DeckDomainService：
 * - [用户操作] save/archive/restore/delete/finalize/unfinalize —— 写库 + 事务提交后发
 *   deck_deck_status-changed（状态变更时；save 不发）
 * - [任务驱动] DRAFT→ITERATING —— generation 域成功回调进程内直调
 *   DeckDomainService#onFirstVersionCreated
 *
 * 状态动作守卫序（api-deck §4.2 流转表）：状态 → confirm → 无进行中任务 → 指针/版本锚定；
 * 全部写操作=user_id 属主隔离 + 条件更新（filter 携带 deck_status 期望值 + data_version
 * 乐观锁，$inc 推进；0 行=并发冲突/状态已变）。
 */
@Injectable()
export class DeckManageService {
  /** 规则编码前缀（api-deck §4.1：DL+yyMMdd+4位序列） */
  private static readonly DECK_CODE_PREFIX = 'DL';

  /** 新建创作物默认分支 */
  private static readonly DEFAULT_BRANCH = 'main';

  /** 调整次数统计口径：成功完成的整稿/定向调整任务（v1 对齐） */
  private static readonly ADJUST_TASK_TYPES = [TaskType.FULL_ADJUST, TaskType.TARGETED_ADJUST];

  constructor(
    private readonly deckRepository: DeckRepository,
    private readonly deckStatsRepository: DeckStatsRepository,
    private readonly eventPublisher: DeckEventPublisher,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ------------------------------------------------------------------
  // 列表
  // ------------------------------------------------------------------

  /** 分页+筛选（archivedScope 归档范围），行含统计冗余与 operList */
  async listPage(ao: DeckListAO, userId: string): Promise<PageResult<DeckListVO>> {
    const { records, total } = await this.deckRepository.pageList({
      userId,
      keyword: ao.keyword,
      deckType: ao.deckType,
      deckStatus: ao.deckStatus,
      archivedScope: ao.archivedScope,
      createdTimeStart: parseTimeRangeBound(ao.createdTimeStart, 'start'),
      createdTimeEnd: parseTimeRangeBound(ao.createdTimeEnd, 'end'),
      pageNum: ao.pageNum,
      pageSize: ao.pageSize,
    });
    const pageNum = ao.pageNum;
    const pageSize = ao.pageSize;
    if (records.length === 0) {
      return PageResult.of([], total, pageNum, pageSize);
    }

    // 批量冗余统计（deck 域内只读聚合直查，见 DeckStatsRepository 说明）
    const deckIds = records.map((d) => d.deck_id);
    const currentVersionIds = records
      .map((d) => d.current_version_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const [versionCountMap, adjustCountMap, runningCountMap, versionSeqMap] = await Promise.all([
      this.deckStatsRepository.countVersions(deckIds),
      this.deckStatsRepository.countAdjustTasks(
        deckIds,
        DeckManageService.ADJUST_TASK_TYPES,
        TaskStatus.SUCCEEDED,
      ),
      this.deckStatsRepository.countRunningTasks(deckIds, DeckManageService.runningTaskStatuses()),
      this.deckStatsRepository.findVersionSeqs(currentVersionIds),
    ]);
    const brandKitNameMap = new Map<string, string | null>();
    for (const deck of records) {
      const brandKitId = deck.default_brand_kit_id;
      if (brandKitId != null && brandKitId.length > 0 && !brandKitNameMap.has(brandKitId)) {
        brandKitNameMap.set(brandKitId, await this.deckStatsRepository.findBrandKitName(brandKitId));
      }
    }

    const vos = records.map((deck) => {
      const currentVersionId = deck.current_version_id ?? null;
      const hasRunningTask = (runningCountMap.get(deck.deck_id) ?? 0) > 0;
      return DeckListVO.of(deck, {
        currentVersionSeq: currentVersionId != null ? versionSeqMap.get(currentVersionId) ?? null : null,
        versionCount: versionCountMap.get(deck.deck_id) ?? 0,
        adjustCount: adjustCountMap.get(deck.deck_id) ?? 0,
        defaultBrandKitName:
          deck.default_brand_kit_id != null
            ? brandKitNameMap.get(deck.default_brand_kit_id) ?? null
            : null,
        hasRunningTask,
        operList: resolveDeckOperList(deck.deck_status, hasRunningTask, deck.created_by ?? null, userId),
      });
    });
    return PageResult.of(vos, total, pageNum, pageSize);
  }

  // ------------------------------------------------------------------
  // 保存（新建/编辑）
  // ------------------------------------------------------------------

  /** 新建/编辑（deckId 空=新建；新建初始化 deck_code/DRAFT/active_branch=main 空版本树） */
  async save(ao: DeckSaveAO, userId: string): Promise<DeckSaveVO> {
    // 首期仅支持 DECK 类型
    if (ao.deckType !== DeckType.DECK) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '首期仅支持 DECK 类型创作物');
    }
    // INV-7：默认规范若填必须存在且启用（属主隔离一并校验）
    await this.checkBrandKit(ao.defaultBrandKitId, userId);
    if (ao.deckId == null || ao.deckId.trim().length === 0) {
      return this.createDeck(ao, userId);
    }
    return this.updateDeck(ao, userId);
  }

  /**
   * 新建：初始化 deck_code / deck_status=DRAFT / active_branch=main；
   * 版本树为空（currentVersionId/finalVersionId 置空，deck→version 方向的空树初始化）。
   * 新建/编辑非状态变更，不发 deck_deck_status-changed（域唯一事件）。
   * deck_code 取号 DL+yyMMdd+4 位序列 = 业务表 MAX+1，取号与插入同事务收窄并发窗口。
   */
  private async createDeck(ao: DeckSaveAO, userId: string): Promise<DeckSaveVO> {
    const now = new Date();
    let created: DeckDocument | undefined;
    await this.connection.transaction(async (session) => {
      const prefix = DeckManageService.todayCodePrefix();
      const deckCode = this.buildNextDeckCode(
        prefix,
        await this.deckStatsRepository.findMaxDeckCode(prefix, session),
      );
      const deck = new Deck();
      deck.deck_id = nextId();
      deck.deck_code = deckCode;
      deck.deck_name = ao.deckName;
      deck.deck_type = ao.deckType;
      deck.topic = ao.topic;
      deck.requirement = ao.requirement ?? null;
      deck.default_brand_kit_id = ao.defaultBrandKitId ?? null;
      deck.deck_status = DeckStatus.DRAFT;
      deck.current_version_id = null;
      deck.active_branch = DeckManageService.DEFAULT_BRANCH;
      deck.final_version_id = null;
      deck.archived_from_status = null;
      deck.user_id = userId;
      deck.created_by = userId;
      deck.created_name = userId;
      deck.created_time = now;
      deck.updated_by = userId;
      deck.updated_name = userId;
      deck.updated_time = now;
      deck.data_version = 0;
      deck.delete_sign = DeleteSign.NOT_DELETED;
      created = await this.deckRepository.create(deck, session);
    });
    if (created === undefined) {
      // 防御分支：transaction 回调必然完成赋值（或整体抛出）
      throw new BizException(DECK_STATUS_FORBIDDEN, '创作物创建失败');
    }
    return DeckSaveVO.of(created.deck_id, created.deck_code);
  }

  /** 编辑：仅 DRAFT/ITERATING 态可改基本信息（FINALIZED/ARCHIVED 拒绝）；
   *  条件更新 filter 一并携带状态期望（$in DRAFT/ITERATING）+ 乐观锁。 */
  private async updateDeck(ao: DeckSaveAO, userId: string): Promise<DeckSaveVO> {
    const deck = await this.loadOwned(ao.deckId!, userId);
    if (
      deck.deck_status !== DeckStatus.DRAFT &&
      deck.deck_status !== DeckStatus.ITERATING
    ) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '仅草稿/迭代中状态可编辑基本信息');
    }
    const updated = await this.deckRepository.conditionalUpdate({
      deckId: deck.deck_id,
      userId,
      expectedStatuses: [DeckStatus.DRAFT, DeckStatus.ITERATING],
      expectedDataVersion: deck.data_version,
      setFields: {
        deck_name: ao.deckName,
        deck_type: ao.deckType,
        topic: ao.topic,
        requirement: ao.requirement ?? null,
        default_brand_kit_id: ao.defaultBrandKitId ?? null,
        updated_by: userId,
        updated_name: userId,
      },
    });
    if (!updated) {
      throw DeckManageService.conflict();
    }
    return DeckSaveVO.of(deck.deck_id, deck.deck_code);
  }

  // ------------------------------------------------------------------
  // 详情
  // ------------------------------------------------------------------

  /** 详情（withStats/withLatestTask 按需加载，brandKitName 常驻冗余） */
  async detail(ao: DeckDetailAO, userId: string): Promise<DeckDetailVO> {
    const deck = await this.loadOwned(ao.deckId, userId);
    // brandKitName 冗余展示常驻；hasRunningTask 为 operList 计算输入，常驻
    const defaultBrandKitName =
      deck.default_brand_kit_id != null && deck.default_brand_kit_id.length > 0
        ? await this.deckStatsRepository.findBrandKitName(deck.default_brand_kit_id)
        : null;
    const hasRunningTask =
      (await this.deckStatsRepository.countRunningTasksOfDeck(
        deck.deck_id,
        DeckManageService.runningTaskStatuses(),
      )) > 0;

    let stats: DeckDetailStats | undefined;
    if (ao.withStats) {
      const [versionCount, adjustCount, exportCount] = await Promise.all([
        this.deckStatsRepository.countVersions([deck.deck_id]),
        this.deckStatsRepository.countAdjustTasks(
          [deck.deck_id],
          DeckManageService.ADJUST_TASK_TYPES,
          TaskStatus.SUCCEEDED,
        ),
        this.deckStatsRepository.countExports([deck.deck_id], ExportStatus.SUCCEEDED),
      ]);
      stats = DeckDetailStats.of(
        versionCount.get(deck.deck_id) ?? 0,
        adjustCount.get(deck.deck_id) ?? 0,
        exportCount.get(deck.deck_id) ?? 0,
      );
    }
    let latestTask: DeckDetailLatestTask | null | undefined;
    if (ao.withLatestTask) {
      const row = await this.deckStatsRepository.findLatestTask(deck.deck_id);
      latestTask = row != null ? DeckDetailLatestTask.of(row.taskId, row.taskType, row.taskStatus) : null;
    }

    return DeckDetailVO.of(deck, {
      defaultBrandKitName,
      hasRunningTask,
      stats,
      latestTask,
      operList: resolveDeckOperList(deck.deck_status, hasRunningTask, deck.created_by ?? null, userId),
    });
  }

  // ------------------------------------------------------------------
  // 状态动作（api-deck §4.2 流转表；[用户操作] 写库+事务提交后发事件）
  // ------------------------------------------------------------------

  /** 归档：任意非归档态 → ARCHIVED（守卫序：状态 → 无进行中任务；记录 archivedFromStatus） */
  async archive(deckId: string, userId: string): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status === DeckStatus.ARCHIVED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '创作物已归档');
    }
    await this.assertNoRunningTask(deck.deck_id);
    const updated = await this.deckRepository.conditionalUpdate({
      deckId: deck.deck_id,
      userId,
      expectedStatuses: [DeckStatus.DRAFT, DeckStatus.ITERATING, DeckStatus.FINALIZED],
      expectedDataVersion: deck.data_version,
      setFields: {
        deck_status: DeckStatus.ARCHIVED,
        archived_from_status: deck.deck_status,
        updated_by: userId,
        updated_name: userId,
      },
    });
    if (!updated) {
      throw DeckManageService.conflict();
    }
    this.eventPublisher.publishStatusChanged(deck.deck_id, DeckStatus.ARCHIVED, userId);
  }

  /** 恢复：ARCHIVED → archivedFromStatus（缺失/非法兜底回 DRAFT，字段值保留供再次归档覆盖） */
  async restore(deckId: string, userId: string): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status !== DeckStatus.ARCHIVED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '仅已归档状态可恢复');
    }
    const target = deck.archived_from_status;
    const validTarget =
      target === DeckStatus.DRAFT || target === DeckStatus.ITERATING || target === DeckStatus.FINALIZED;
    const restoreTo = validTarget ? target! : DeckStatus.DRAFT;
    const updated = await this.deckRepository.conditionalUpdate({
      deckId: deck.deck_id,
      userId,
      expectedStatuses: [DeckStatus.ARCHIVED],
      expectedDataVersion: deck.data_version,
      setFields: {
        deck_status: restoreTo,
        updated_by: userId,
        updated_name: userId,
      },
    });
    if (!updated) {
      throw DeckManageService.conflict();
    }
    this.eventPublisher.publishStatusChanged(deck.deck_id, restoreTo, userId);
  }

  /** 软删除：仅 ARCHIVED 可删（delete_sign=1）；按状态变更事件通知同步（businessStatus=ARCHIVED） */
  async delete(deckId: string, userId: string): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status !== DeckStatus.ARCHIVED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '仅已归档状态可删除');
    }
    const updated = await this.deckRepository.conditionalUpdate({
      deckId: deck.deck_id,
      userId,
      expectedStatuses: [DeckStatus.ARCHIVED],
      expectedDataVersion: deck.data_version,
      setFields: {
        delete_sign: DeleteSign.DELETED,
        updated_by: userId,
        updated_name: userId,
      },
    });
    if (!updated) {
      throw DeckManageService.conflict();
    }
    this.eventPublisher.publishStatusChanged(deck.deck_id, DeckStatus.ARCHIVED, userId);
  }

  /** 定稿：ITERATING → FINALIZED（守卫序：状态 → confirm → 无进行中任务 → currentVersionId 非空；
   *  INV-2：finalVersionId 锚定 currentVersionId） */
  async finalize(deckId: string, confirm: boolean, userId: string): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status !== DeckStatus.ITERATING) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '仅迭代中状态可定稿');
    }
    if (confirm !== true) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '定稿需二次确认（confirm=true）');
    }
    await this.assertNoRunningTask(deck.deck_id);
    if (deck.current_version_id == null || deck.current_version_id.length === 0) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '当前无版本可定稿');
    }
    const updated = await this.deckRepository.conditionalUpdate({
      deckId: deck.deck_id,
      userId,
      expectedStatuses: [DeckStatus.ITERATING],
      expectedDataVersion: deck.data_version,
      setFields: {
        deck_status: DeckStatus.FINALIZED,
        final_version_id: deck.current_version_id,
        updated_by: userId,
        updated_name: userId,
      },
    });
    if (!updated) {
      throw DeckManageService.conflict();
    }
    this.eventPublisher.publishStatusChanged(deck.deck_id, DeckStatus.FINALIZED, userId);
  }

  /** 解锁定稿：FINALIZED → ITERATING（confirm=true；finalVersionId 保留作最近定稿记录） */
  async unfinalize(deckId: string, confirm: boolean, userId: string): Promise<void> {
    const deck = await this.loadOwned(deckId, userId);
    if (deck.deck_status !== DeckStatus.FINALIZED) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '仅已定稿状态可解锁');
    }
    if (confirm !== true) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '解锁定稿需二次确认（confirm=true）');
    }
    const updated = await this.deckRepository.conditionalUpdate({
      deckId: deck.deck_id,
      userId,
      expectedStatuses: [DeckStatus.FINALIZED],
      expectedDataVersion: deck.data_version,
      setFields: {
        deck_status: DeckStatus.ITERATING,
        updated_by: userId,
        updated_name: userId,
      },
    });
    if (!updated) {
      throw DeckManageService.conflict();
    }
    this.eventPublisher.publishStatusChanged(deck.deck_id, DeckStatus.ITERATING, userId);
  }

  // ------------------------------------------------------------------
  // Select 选择池（deck.select.deckList）
  // ------------------------------------------------------------------

  /** 选择池（默认非归档，可编辑/可导出池） */
  async deckOptions(ao: DeckSelectListAO, userId: string): Promise<SelectOption[]> {
    const decks = await this.deckRepository.selectList({
      userId,
      keyword: ao.keyword,
      deckStatus: ao.deckStatus,
    });
    return decks.map((deck) => SelectOption.of(deck.deck_id, deck.deck_name));
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  /** 进行中任务状态口径（QUEUED/RUNNING，v1 对齐） */
  private static runningTaskStatuses(): string[] {
    return [TaskStatus.QUEUED, TaskStatus.RUNNING];
  }

  /** finalize/archive 守卫：存在进行中任务即拒绝（BIZ_DECK_TASK_RUNNING） */
  private async assertNoRunningTask(deckId: string): Promise<void> {
    const count = await this.deckStatsRepository.countRunningTasksOfDeck(
      deckId,
      DeckManageService.runningTaskStatuses(),
    );
    if (count > 0) {
      throw new BizException(DECK_TASK_RUNNING, DECK_TASK_RUNNING_MSG);
    }
  }

  /** INV-7 守卫：品牌规范存在且未删除（属主隔离一并校验；启用态=未删除，v1 口径） */
  private async checkBrandKit(brandKitId: string | null | undefined, userId: string): Promise<void> {
    if (brandKitId == null || brandKitId.trim().length === 0) {
      return;
    }
    const count = await this.deckStatsRepository.countValidBrandKit(brandKitId, userId);
    if (count <= 0) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '默认品牌规范不存在或已停用');
    }
  }

  /** 当日取号前缀：DL+yyMMdd（服务器本地时区，v1 LocalDate.now 对齐） */
  private static todayCodePrefix(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const date = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return `${DeckManageService.DECK_CODE_PREFIX}${date}`;
  }

  /** MAX+1 取号：前缀下最大 deck_code 的 4 位序列 +1（%04d 不足补零，溢出自然进位） */
  private buildNextDeckCode(prefix: string, maxCode: string | null): string {
    let next = 1;
    if (maxCode != null && maxCode.length > prefix.length) {
      const parsed = Number.parseInt(maxCode.slice(prefix.length), 10);
      if (Number.isInteger(parsed)) {
        next = parsed + 1;
      }
    }
    return prefix + String(next).padStart(4, '0');
  }

  /** 属主加载（user_id 隔离，ADR-005/api-deck §3.3） */
  private async loadOwned(deckId: string, userId: string): Promise<DeckDocument> {
    const deck = await this.deckRepository.findByIdOwned(deckId, userId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG);
    }
    return deck;
  }

  /** 并发修改冲突（条件更新 0 行） */
  private static conflict(): BizException {
    return new BizException(DECK_STATUS_FORBIDDEN, '创作物已被并发修改，请刷新后重试');
  }
}
