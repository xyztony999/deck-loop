import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssetStatus, DeckStatus, TaskStatus, TaskType } from '../common/enums';
import { BizException } from '../common/exceptions';
import { PageResult } from '../common/result';
import { DECK_NOT_FOUND, DECK_NOT_FOUND_MSG } from '../deck/deck.errors';
import { AssetDomainService } from '../asset/asset.service';
import type { BrandKitProviderGetVO } from '../asset/asset.dto';
import { DeckDomainService } from '../deck/deck.domain-service';
import { GW_TASK_ADVANCED, type GwTaskAdvancedPayload } from '../platform/platform.events';
import { GenerationEventPublisher, type TaskFinishedPayload } from './generation.events';
import { GenerationTaskDomainService } from './generation.domain-service';
import { GenerationQueryRepository } from './generation.query.repository';
import { GenerationTaskRepository } from './generation.repository';
import { resolveTaskOperList } from './generation.oper-resolver';
import {
  DEFAULT_LENGTH_OPTION,
  FullGenerateAO,
  GenerationTaskCancelAO,
  GenerationTaskCreateCommand,
  GenerationTaskDetailAO,
  GenerationTaskDetailVO,
  GenerationTaskListAO,
  GenerationTaskListVO,
  GenerationTaskProgressAO,
  GenerationTaskProgressVO,
  GenerationTaskRetryAO,
  GenerationTaskSubmitVO,
  OutlineGenerateAO,
  OutlineNodeAO,
  OutlineSaveAO,
  parseTimeRangeBound,
} from './generation.dto';
import {
  TASK_NOT_CANCELLABLE,
  TASK_NOT_CANCELLABLE_MSG,
  TASK_SCOPE_INVALID,
} from './generation.errors';
import type { DeckDocument } from '../deck/schemas/dl_deck.schema';
import type { GenerationTaskDocument } from './schemas/dl_generation_task.schema';

/**
 * 生成任务应用 Service（C-02，api-generation §4.4 接口 1-8；v1 GenerationTaskServiceImpl 平移）。
 *
 * TaskStatus 状态机（api-generation §4.2）触发角色：
 * [用户操作] cancel（QUEUED/RUNNING→CANCELLED）、retry（FAILED→新任务实例）；
 * [系统回调] RUNNING→SUCCEEDED/FAILED 由 GenerationTaskCallbackImpl 推进（网关回调链）。
 * 任务创建链统一委托 GenerationTaskDomainService#createTask（本域发起接口与
 * adjustment 域 C-03、retry 复用同一链）。
 *
 * userId 一律 @CurrentUser 服务端注入（ADR-005/NR-05）；任务全部接口强制属主隔离
 * （api-generation §3.3）。取消终态同时发 gw_task_advanced（补 userId/deckId 载荷，
 * platform SSE 取消推送缺口——网关仅在自身推进链发该事件，用户取消路径在 generation 域）。
 */
@Injectable()
export class GenerationTaskService {
  private readonly logger = new Logger(GenerationTaskService.name);

  constructor(
    private readonly taskRepository: GenerationTaskRepository,
    private readonly queryRepository: GenerationQueryRepository,
    private readonly deckDomainService: DeckDomainService,
    private readonly domainService: GenerationTaskDomainService,
    private readonly assetDomainService: AssetDomainService,
    private readonly eventPublisher: GenerationEventPublisher,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------
  // 1. 发起大纲生成（OUTLINE）
  // ------------------------------------------------------------------

  async outlineGenerate(ao: OutlineGenerateAO, userId: string): Promise<GenerationTaskSubmitVO> {
    this.requireUserId(userId);
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    await this.checkAssetIds(userId, ao.assetIds);
    await this.checkBrandKit(userId, ao.brandKitId);

    // 快照公共头（deck 主题/需求随任务快照固化，偏好与 deck 后续变更不影响在途审计）
    const snapshot = this.baseSnapshot(deck, userId);
    snapshot['extraRequirement'] = ao.extraRequirement ?? null;
    snapshot['assetIds'] = this.cleanIdList(ao.assetIds);
    snapshot['brandKitId'] = ao.brandKitId ?? null;
    await this.applyGenerationContext(snapshot, userId, ao.brandKitId, ao.assetIds);

    const created = await this.domainService.createTask(
      this.buildCommand(deck.deck_id, userId, TaskType.OUTLINE, null, snapshot),
    );
    return GenerationTaskSubmitVO.of(created.taskId, created.taskCode, created.taskStatus);
  }

  // ------------------------------------------------------------------
  // 2. 保存大纲编辑（Deck.draftOutline；DRAFT 态可编辑，首版生成后只读）
  // ------------------------------------------------------------------

  async outlineSave(ao: OutlineSaveAO, userId: string): Promise<void> {
    this.requireUserId(userId);
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    if (deck.deck_status !== DeckStatus.DRAFT) {
      throw new BizException(TASK_SCOPE_INVALID, '首个版本生成后大纲转只读，仅草稿状态可编辑');
    }
    const outline = serializeOutline(ao.outline);
    // 0 行=deck 不存在/属主不符（deck 域 NOT_FOUND 透传）
    await this.deckDomainService.updateDraftOutline(deck.deck_id, outline, userId);
  }

  // ------------------------------------------------------------------
  // 3. 发起整稿生成（FULL_GENERATE）
  // ------------------------------------------------------------------

  async fullGenerate(ao: FullGenerateAO, userId: string): Promise<GenerationTaskSubmitVO> {
    this.requireUserId(userId);
    const deck = await this.loadOwnedDeck(ao.deckId, userId);
    // 规则：deck 必须存在 draftOutline（useDraft=true）或显式快照
    const outlineSnapshot = this.resolveOutlineSnapshot(ao, deck);
    await this.checkAssetIds(userId, ao.assetIds);
    await this.checkBrandKit(userId, ao.brandKitId);

    const snapshot = this.baseSnapshot(deck, userId);
    snapshot['outlineSnapshot'] = outlineSnapshot;
    snapshot['assetIds'] = this.cleanIdList(ao.assetIds);
    snapshot['brandKitId'] = ao.brandKitId ?? null;
    snapshot['lengthOption'] = ao.lengthOption ?? DEFAULT_LENGTH_OPTION;
    await this.applyGenerationContext(snapshot, userId, ao.brandKitId, ao.assetIds);

    const created = await this.domainService.createTask(
      this.buildCommand(deck.deck_id, userId, TaskType.FULL_GENERATE, null, snapshot),
    );
    return GenerationTaskSubmitVO.of(created.taskId, created.taskCode, created.taskStatus);
  }

  // ------------------------------------------------------------------
  // 4. 任务列表
  // ------------------------------------------------------------------

  async listPage(ao: GenerationTaskListAO, userId: string): Promise<PageResult<GenerationTaskListVO>> {
    this.requireUserId(userId);
    const { records, total } = await this.taskRepository.pageList({
      userId,
      deckId: ao.deckId,
      taskStatus: ao.taskStatus,
      taskType: ao.taskType,
      createdTimeStart: parseTimeRangeBound(ao.createdTimeStart, 'start'),
      createdTimeEnd: parseTimeRangeBound(ao.createdTimeEnd, 'end'),
      pageNum: ao.pageNum,
      pageSize: ao.pageSize,
    });
    if (records.length === 0) {
      return PageResult.of([], total, ao.pageNum, ao.pageSize);
    }

    // 批量冗余：deckName / resultVersionSeq（跨聚合只读查询，v1 同款）
    const deckIds = [...new Set(records.map((task) => task.deck_id))];
    const versionIds = records
      .map((task) => task.result_version_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const [deckNameMap, versionSeqMap] = await Promise.all([
      this.queryRepository.findDeckNames(deckIds),
      this.queryRepository.findVersionSeqs([...new Set(versionIds)]),
    ]);

    const vos = records.map((task) =>
      GenerationTaskListVO.of(task, {
        deckName: deckNameMap.get(task.deck_id) ?? null,
        resultVersionSeq:
          task.result_version_id != null
            ? versionSeqMap.get(task.result_version_id) ?? null
            : null,
        operList: resolveTaskOperList(task.task_status, task.created_by ?? null, userId),
      }),
    );
    return PageResult.of(vos, total, ao.pageNum, ao.pageSize);
  }

  // ------------------------------------------------------------------
  // 5. 任务详情（含指令快照）
  // ------------------------------------------------------------------

  async detail(ao: GenerationTaskDetailAO, userId: string): Promise<GenerationTaskDetailVO> {
    this.requireUserId(userId);
    const task = await this.loadOwnedTask(ao.taskId, userId);
    // 提取局部常量：回调内（.then）不保留三元条件的属性收窄
    const resultVersionId =
      task.result_version_id != null && task.result_version_id.length > 0
        ? task.result_version_id
        : null;
    const [deckName, resultVersionSeq] = await Promise.all([
      this.queryRepository.findDeckNames([task.deck_id]).then((m) => m.get(task.deck_id) ?? null),
      resultVersionId != null
        ? this.queryRepository.findVersionSeqs([resultVersionId]).then((m) => m.get(resultVersionId) ?? null)
        : Promise.resolve(null),
    ]);
    return GenerationTaskDetailVO.of(task, {
      deckName,
      resultVersionSeq,
      operList: resolveTaskOperList(task.task_status, task.created_by ?? null, userId),
    });
  }

  // ------------------------------------------------------------------
  // 6. 任务进度批量查询（taskIds ≤20，派生展示数据）
  // ------------------------------------------------------------------

  async progress(ao: GenerationTaskProgressAO, userId: string): Promise<GenerationTaskProgressVO[]> {
    this.requireUserId(userId);
    const taskIds = [...new Set(ao.taskIds)];
    if (taskIds.length === 0) {
      return [];
    }
    const tasks = await this.taskRepository.findByIdsOwned(userId, taskIds);
    const byId = new Map<string, GenerationTaskDocument>(tasks.map((task) => [task.task_id, task]));
    const vos: GenerationTaskProgressVO[] = [];
    for (const taskId of taskIds) {
      const task = byId.get(taskId);
      if (task == null) {
        continue; // 非属主/不存在：静默跳过（v1 对齐，不回显他人任务）
      }
      vos.push(GenerationTaskProgressVO.of(task.task_id, task.task_status));
    }
    return vos;
  }

  // ------------------------------------------------------------------
  // 7. 取消任务（[用户操作] QUEUED/RUNNING→CANCELLED）
  // ------------------------------------------------------------------

  async cancel(ao: GenerationTaskCancelAO, userId: string): Promise<void> {
    this.requireUserId(userId);
    const task = await this.loadOwnedTask(ao.taskId, userId);
    // 条件更新幂等（幂等键=taskId+期望前置状态 QUEUED/RUNNING）
    const advanced = await this.taskRepository.conditionalAdvanceStatus({
      taskId: task.task_id,
      userId,
      expectedStatuses: [TaskStatus.QUEUED, TaskStatus.RUNNING],
      targetStatus: TaskStatus.CANCELLED,
      updatedBy: userId,
    });
    if (!advanced) {
      throw new BizException(
        TASK_NOT_CANCELLABLE,
        `任务当前状态[${task.task_status}]不可取消，${TASK_NOT_CANCELLABLE_MSG}`,
      );
    }

    // 终态事件（消费方：多端同步/客户端通知）——条件更新已提交后发布（NR-07）
    const finished: TaskFinishedPayload = {
      taskId: task.task_id,
      deckId: task.deck_id,
      taskStatus: TaskStatus.CANCELLED,
      resultVersionId: task.result_version_id ?? null,
      taskType: task.task_type,
      userId,
    };
    this.eventPublisher.publishFinished(finished);

    // platform SSE 取消推送缺口修补：网关仅在自身推进链发 gw_task_advanced，
    // 用户取消路径在 generation 域——此处补发（载荷含 userId/deckId 定向过滤）
    this.eventEmitter.emit(GW_TASK_ADVANCED, {
      taskId: task.task_id,
      taskStatus: TaskStatus.CANCELLED,
      userId,
      deckId: task.deck_id,
      percent: 100,
      stageText: '已取消',
    } satisfies GwTaskAdvancedPayload);

    this.logger.log(`任务已取消 taskId=${task.task_id} by=${userId}`);
  }

  // ------------------------------------------------------------------
  // 8. 重试任务（FAILED→新任务实例，复制 instruction_snapshot，ADR-003）
  // ------------------------------------------------------------------

  async retry(ao: GenerationTaskRetryAO, userId: string): Promise<GenerationTaskSubmitVO> {
    this.requireUserId(userId);
    const task = await this.loadOwnedTask(ao.taskId, userId);
    if (task.task_status !== TaskStatus.FAILED) {
      throw new BizException(
        TASK_SCOPE_INVALID,
        `任务当前状态[${task.task_status}]不可重试，仅失败任务可重试`,
      );
    }
    // 复制入参快照新建实例；路由按当前偏好重新解析（新实例不沿用旧路由快照）
    const command = new GenerationTaskCreateCommand();
    command.deckId = task.deck_id;
    command.userId = userId;
    command.taskType = task.task_type;
    command.baseVersionId = task.base_version_id ?? null;
    command.instructionSnapshot = task.instruction_snapshot;
    const retried = await this.domainService.createTask(command);
    return GenerationTaskSubmitVO.of(retried.taskId, retried.taskCode, retried.taskStatus);
  }

  /* ------------------------------------------------------------------ */
  /* 内部：快照组装 / 入参守卫                                            */
  /* ------------------------------------------------------------------ */

  /** 快照公共头（deck 主题/需求随任务快照固化；v1 baseSnapshot 对齐） */
  private baseSnapshot(deck: DeckDocument, userId: string): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      deckId: deck.deck_id,
      topic: deck.topic,
      userId,
    };
    if (deck.requirement != null) {
      snapshot['requirement'] = deck.requirement;
    }
    return snapshot;
  }

  private buildCommand(
    deckId: string,
    userId: string,
    taskType: string,
    baseVersionId: string | null,
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

  /**
   * 大纲快照解析：显式快照优先（合法 JSON 校验），useDraft=true 取 Deck.draftOutline，
   * 均无 → SCOPE_INVALID（v1 resolveOutlineSnapshot 对齐）。
   */
  private resolveOutlineSnapshot(ao: FullGenerateAO, deck: DeckDocument): unknown {
    if (ao.outlineSnapshot != null && ao.outlineSnapshot.trim().length > 0) {
      try {
        return JSON.parse(ao.outlineSnapshot);
      } catch {
        throw new BizException(TASK_SCOPE_INVALID, '大纲快照非法 JSON');
      }
    }
    if (ao.useDraft === true && deck.draft_outline != null) {
      return deck.draft_outline;
    }
    throw new BizException(TASK_SCOPE_INVALID, '缺少大纲快照：请先保存大纲或显式传入 outlineSnapshot');
  }

  /** 入参守卫：assetIds 全部属主名下且启用态（≤10 由 AO 校验；v1 checkAssetIds 对齐）。 */
  private async checkAssetIds(userId: string, assetIds: string[] | undefined): Promise<void> {
    const distinct = this.cleanIdList(assetIds);
    if (distinct.length === 0) {
      return;
    }
    const count = await this.queryRepository.countActiveAssets(userId, distinct, AssetStatus.ACTIVE);
    if (count < distinct.length) {
      throw new BizException(TASK_SCOPE_INVALID, '引用素材不存在或已停用');
    }
  }

  /** 入参守卫：brandKitId 启用态（dl_brand_kit 无启停列，启用态=未删除；v1 checkBrandKit 对齐）。 */
  private async checkBrandKit(userId: string, brandKitId: string | undefined): Promise<void> {
    if (brandKitId == null || brandKitId.trim().length === 0) {
      return;
    }
    const count = await this.queryRepository.countValidBrandKit(brandKitId, userId);
    if (count <= 0) {
      throw new BizException(TASK_SCOPE_INVALID, '品牌规范不存在或已停用');
    }
  }

  /**
   * F04：生成上下文注入（brandKit 值 + 素材简述）——模型仅凭内部 ID 无法
   * 应用品牌规范或理解引用素材；checkBrandKit/checkAssetIds 已保证存在与启用。
   */
  private async applyGenerationContext(
    snapshot: Record<string, unknown>,
    userId: string,
    brandKitId: string | undefined,
    assetIds: string[] | undefined,
  ): Promise<void> {
    if (brandKitId != null && brandKitId.trim().length > 0) {
      const kit: BrandKitProviderGetVO | null = await this.assetDomainService.getBrandKit(
        brandKitId,
        userId,
      );
      if (kit != null) {
        snapshot['brandKit'] = {
          brandKitId: kit.brandKitId,
          kitName: kit.kitName,
          colors: kit.colors,
          fonts: kit.fonts,
          logoAssetId: kit.logoAssetId,
          logoUrl: kit.logoUrl,
        };
      }
    }
    const ids = this.cleanIdList(assetIds);
    if (ids.length > 0) {
      snapshot['assetContext'] = await this.assetDomainService.getAssetBriefs(userId, ids);
    }
  }

  /** 引用 id 清洗：剔空白 + 去重（快照/守卫共用口径） */
  private cleanIdList(ids: string[] | undefined): string[] {
    if (ids == null || ids.length === 0) {
      return [];
    }
    return [...new Set(ids.filter((id) => id != null && id.trim().length > 0))];
  }

  /** 属主加载 deck（user_id 隔离；deck 域契约异常透传，v1 loadOwnedDeck 对齐） */
  private async loadOwnedDeck(deckId: string, userId: string): Promise<DeckDocument> {
    const deck = await this.deckDomainService.getDeck(deckId, userId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG);
    }
    return deck;
  }

  /** 属主加载任务（detail/cancel/retry 入口；v1 loadOwnedTask 对齐） */
  private async loadOwnedTask(taskId: string, userId: string): Promise<GenerationTaskDocument> {
    const task = await this.taskRepository.findByIdOwned(taskId, userId);
    if (task == null) {
      throw new BizException(TASK_SCOPE_INVALID, '任务不存在');
    }
    return task;
  }

  /** 用户上下文缺失防御（正常流程 AuthGuard+@CurrentUser 已保证；v1 requireUserId 对齐） */
  private requireUserId(userId: string): void {
    if (userId == null || userId.trim().length === 0) {
      throw new BizException(TASK_SCOPE_INVALID, '缺少用户会话上下文');
    }
  }
}

/**
 * 大纲节点树序列化（Deck.draft_outline 持久化形态；v1 serializeOutline 对齐）：
 * nodeId 空按序补全 n1/n2/...；points 剔空白；note/pageHint 可空不落 null 键。
 *
 * 顶层为节点数组（v1 draft_outline JSON 平移；deck 域 updateDraftOutline 契约签名
 * 为 Record 容器（Mixed 嵌入），此处经收窄转换适配——NR-01 escape：deck 契约冻结
 * 不可改，运行时 Mixed 存储数组合法，读取侧（detail VO/getVersionContent）原样透出。
 */
function serializeOutline(nodes: OutlineNodeAO[]): Record<string, unknown> {
  const tree: Record<string, unknown>[] = nodes.map((node, index) => {
    const json: Record<string, unknown> = {
      nodeId: node.nodeId == null || node.nodeId.trim().length === 0 ? `n${index + 1}` : node.nodeId,
      title: node.title,
      points: (node.points ?? []).filter((p) => p != null && p.trim().length > 0),
    };
    if (node.note != null && node.note.trim().length > 0) {
      json['note'] = node.note;
    }
    if (node.pageHint != null) {
      json['pageHint'] = node.pageHint;
    }
    return json;
  });
  return tree as unknown as Record<string, unknown>;
}
