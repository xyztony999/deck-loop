import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus, TaskType } from '../common/enums';
import { DeckDomainService } from '../deck/deck.domain-service';
import { VersionArchiveCommand } from '../version/version.dto';
import { VersionArchiveService } from '../version/version.archive-service';
import {
  type GatewayTaskCallback,
  type GatewayTaskUsage,
} from '../platform/gateway/gateway-task-callback';
import { GenerationEventPublisher } from './generation.events';
import { GenerationTaskRepository } from './generation.repository';
import { assertTargetedInvariance } from './targeted-invariance';
import type { GenerationTaskDocument } from './schemas/dl_generation_task.schema';

/** error_msg 列宽（DDL VARCHAR(512)，api-generation §4.1） */
const ERROR_MSG_MAX_LENGTH = 512;

/**
 * 网关任务回调编排（api-generation §4.3「onTaskCallback(taskId,status,result,usage)」；
 * v1 GenerationTaskCallbackImpl 平移）。
 *
 * 本类为 generation 域对 platform 的 GATEWAY_TASK_CALLBACK 实现（provide 挂接，
 * platform 经 ModuleRef 惰性解析注入网关调度链）；调整类任务（FULL_ADJUST/
 * TARGETED_ADJUST）复用同一回调（taskType 分叉）。
 *
 * ## 编排步骤（回调链）
 *
 * 1. 幂等前置：任务不存在 → 警告返回；已终态（SUCCEEDED/FAILED/CANCELLED）→ no-op
 *    （重复投递/取消竞态安全）；非法目标状态 → 警告忽略；
 * 2. SUCCEEDED：
 *    a. normalizeResult（产物非空 + 合法 JSON 解析；系统数据，失败=集成缺陷，上抛后
 *       由网关兜底推进 FAILED）；
 *    b. OUTLINE → deck.updateDraftOutline（大纲节点树写入 Deck.draftOutline）；
 *       三类内容任务（FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST）→ 组装
 *       VersionArchiveCommand（content=result、sourceType=taskType 同码映射
 *       VersionSourceType、快照解析 forkBranchName/baseVersionId → branchName/
 *       parentVersionId——v1 修复后的 applyForkFromSnapshot 语义，D3 分叉留档）→
 *       version.createVersionFromTask（版本写入唯一入口，单事务含 seq 分配/insertOnly/
 *       movePointer/asset 引用计数 + 提交后 ver_version_created）；
 *    c. 条件推进 RUNNING→SUCCEEDED + 回填 result_version_id（**单文档原子条件更新**，
 *       幂等键=taskId+期望前置状态 RUNNING；0 行=已被取消/并发推进，no-op——
 *       满足「SUCCEEDED ⇔ result_version_id 非空」不变量在文档级原子成立）；
 *    d. 首版判定（movePointer 前读 deck.current_version_id 为空，对齐 v1 回调内判定）
 *       → deck.onFirstVersionCreated（INV-4 DRAFT→ITERATING，幂等）；
 * 3. FAILED：条件推进 RUNNING→FAILED + error_msg（截断 512），不产版本（ADR-003）；
 * 4. 终态推进生效（matchedCount=1）后发布 gen_task_finished（NR-07：条件更新已提交；
 *    0 行重复/竞态路径不发布）。
 *
 * ## 与 v1 单事务的已知偏离（遗留项，见域报告）
 * v1 为单事务（预留终态→产物写入→回填同 REQUIRED 事务，失败整体回滚）。v3 落盘的
 * version 域 `VersionArchiveService#createVersionFromTask` 自建 connection.transaction
 * （内部含 movePointer/adjustRefCounts 同事务收口），Mongo 无嵌套事务、外层 session
 * 无法加入，故编排改为「产物落地→终态+回填原子条件更新」顺序：
 * - 产物落地失败（抛错）时任务仍 RUNNING → 网关 fallbackAdvanceFailed（RUNNING→FAILED）
 *   兜底生效，语义与 v1 等价；
 * - 终态推进 0 行（取消竞态）：版本已留档但任务 CANCELLED（孤儿版本）——窗口极窄
 *  （用户取消 vs 回调推进并发），v1 预留终态将版本写入一并回滚，v3 容忍孤儿版本，
 *    记 warn 留痕。
 */
@Injectable()
export class GenerationTaskCallbackImpl implements GatewayTaskCallback {
  private readonly logger = new Logger(GenerationTaskCallbackImpl.name);

  constructor(
    private readonly taskRepository: GenerationTaskRepository,
    private readonly deckDomainService: DeckDomainService,
    private readonly versionArchiveService: VersionArchiveService,
    private readonly eventPublisher: GenerationEventPublisher,
  ) {}

  /**
   * provider 调用完成后的业务编排回调。
   * usage 不消费：计量回填与 dl_usage_record 入账归网关调度链
   * （backfillUsage/recordUsage 已先行完成，v1 同口径）。
   */
  async onTaskCallback(
    taskId: string,
    status: string,
    result: string,
    /** 用量不入参消费：计量回填与 dl_usage_record 入账归网关调度链（v1 同口径） */
    _usage: GatewayTaskUsage,
  ): Promise<void> {
    const task = await this.taskRepository.findById(taskId);
    if (task == null) {
      this.logger.warn(`任务回调忽略：任务不存在 taskId=${taskId}`);
      return;
    }
    if (isTerminal(task.task_status)) {
      // 幂等守卫：重复投递/取消竞态下任务已终态
      this.logger.log(`任务回调忽略：任务已终态 taskId=${taskId} status=${task.task_status}`);
      return;
    }
    if (status === TaskStatus.SUCCEEDED) {
      await this.handleSucceeded(task, result);
    } else if (status === TaskStatus.FAILED) {
      await this.handleFailed(task, result);
    } else {
      this.logger.warn(`任务回调忽略：非法目标状态 taskId=${taskId} target=${status}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* SUCCEEDED：产物编排（OUTLINE→大纲写入；三类内容任务→版本留档）        */
  /* ------------------------------------------------------------------ */

  private async handleSucceeded(task: GenerationTaskDocument, result: string): Promise<void> {
    const content = this.normalizeResult(task, result);
    let resultVersionId: string | null = null;
    let firstVersion = false;

    if (task.task_type === TaskType.OUTLINE) {
      // OUTLINE 产物：大纲节点树 JSON 写入 Deck.draftOutline（api-generation §4.3；
      // 0 行=deck 不存在/属主不符 → 集成缺陷上抛，网关兜底 FAILED）
      await this.deckDomainService.updateDraftOutline(
        task.deck_id,
        assertOutlineTree(task, content),
        task.user_id,
      );
    } else {
      // 内容类产物：版本留档 + 指针回写（version 域契约）。
      // F02b：定向调整先做非目标不变性校验（PRD prd-adjustment §52），
      // 越界产物按集成缺陷抛错 → 网关 fallbackAdvanceFailed 推进 FAILED，不产版本。
      if (task.task_type === TaskType.TARGETED_ADJUST) {
        assertTargetedInvariance(task.instruction_snapshot, assertContentObject(task, content), task.task_id);
      }
      const archived = await this.archiveVersion(task, content);
      resultVersionId = archived.versionId;
      firstVersion = archived.firstVersion;
    }

    // 终态推进 + 产物回填：单文档原子条件更新（幂等键=taskId+期望前置 RUNNING）
    const advanced = await this.taskRepository.conditionalAdvanceStatus({
      taskId: task.task_id,
      expectedStatuses: [TaskStatus.RUNNING],
      targetStatus: TaskStatus.SUCCEEDED,
      setFields: resultVersionId != null ? { result_version_id: resultVersionId } : undefined,
      updatedBy: task.user_id,
    });
    if (!advanced) {
      this.logger.warn(
        `任务成功回调未生效（已被取消/并发推进）taskId=${task.task_id}` +
          (resultVersionId != null ? ` 孤儿版本=${resultVersionId}` : ''),
      );
    }

    if (firstVersion) {
      // INV-4 DRAFT→ITERATING（幂等；deck 域内发 deck_deck_status-changed）。
      // 版本已留档且指针已移动（DRAFT+空指针仅容首次），无论推进是否生效均执行，
      // 避免 deck 停留 DRAFT+指针非空的死锁态。
      await this.deckDomainService.onFirstVersionCreated(task.deck_id, task.user_id);
    }
    if (!advanced) {
      return;
    }

    // ---- NR-07：终态条件更新已提交后发布 ----
    this.eventPublisher.publishFinished({
      taskId: task.task_id,
      deckId: task.deck_id,
      taskStatus: TaskStatus.SUCCEEDED,
      resultVersionId,
      taskType: task.task_type,
      userId: task.user_id,
    });
    this.logger.log(
      `任务成功编排完成 taskId=${task.task_id} type=${task.task_type} resultVersionId=${resultVersionId ?? '-'}`,
    );
  }

  /** 内容类产物：版本留档 + 首版判定（v1 archiveVersion 对齐；指针/首版编排见调用方）。 */
  private async archiveVersion(
    task: GenerationTaskDocument,
    content: unknown,
  ): Promise<{ versionId: string; firstVersion: boolean }> {
    // 首版判定：movePointer 前读 deck.current_version_id 为空（DRAFT 空树首版，
    // api-deck §2.3；v1 回调内判定口径）
    const deck = await this.deckDomainService.getDeck(task.deck_id);
    if (deck == null) {
      throw new Error(`版本留档失败：创作物不存在 deckId=${task.deck_id}`);
    }
    const firstVersion = deck.current_version_id == null || deck.current_version_id.trim().length === 0;

    // taskType 同码映射 VersionSourceType（FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST）
    const command = new VersionArchiveCommand();
    command.deckId = task.deck_id;
    command.userId = task.user_id;
    command.taskId = task.task_id;
    command.sourceType = task.task_type;
    command.instructionSnapshot = task.instruction_snapshot;
    command.content = assertContentObject(task, content);
    this.applyForkFromSnapshot(task, command);

    // 版本写入唯一入口（内部单事务：seq 分配→insertOnly→movePointer→引用计数→提交后事件）
    const archived = await this.versionArchiveService.createVersionFromTask(command);
    return { versionId: archived.versionId, firstVersion };
  }

  /**
   * D3 分叉留档（api-adjustment；v1 修复后的 applyForkFromSnapshot 链）：
   * adjust 指令快照携带 forkBranchName（基线≠当前且 confirm=true 确认分叉）时，
   * 新版本落新分支——branchName=forkBranchName、parentVersionId=快照 baseVersionId
   * （基线版本，非活动分支头）；快照无该 key（常规留档/FULL_GENERATE）维持现状
   * （parent/branch 由 version 域取 Deck 指针兜底）。
   */
  private applyForkFromSnapshot(task: GenerationTaskDocument, command: VersionArchiveCommand): void {
    const snapshot = task.instruction_snapshot;
    const forkBranchName = snapshot['forkBranchName'];
    if (typeof forkBranchName !== 'string' || forkBranchName.trim().length === 0) {
      return;
    }
    command.branchName = forkBranchName;
    const baseVersionId = snapshot['baseVersionId'];
    if (typeof baseVersionId === 'string' && baseVersionId.trim().length > 0) {
      command.parentVersionId = baseVersionId;
    }
  }

  /* ------------------------------------------------------------------ */
  /* FAILED：失败摘要落库，不产版本（ADR-003）                            */
  /* ------------------------------------------------------------------ */

  private async handleFailed(task: GenerationTaskDocument, result: string): Promise<void> {
    const errorMsg = truncate(result, ERROR_MSG_MAX_LENGTH);
    const advanced = await this.taskRepository.conditionalAdvanceStatus({
      taskId: task.task_id,
      expectedStatuses: [TaskStatus.RUNNING],
      targetStatus: TaskStatus.FAILED,
      setFields: { error_msg: errorMsg },
      updatedBy: task.user_id,
    });
    if (!advanced) {
      this.logger.log(`任务失败回调未生效（已被取消/并发推进）taskId=${task.task_id}`);
      return;
    }
    // ---- NR-07：终态条件更新已提交后发布 ----
    this.eventPublisher.publishFinished({
      taskId: task.task_id,
      deckId: task.deck_id,
      taskStatus: TaskStatus.FAILED,
      resultVersionId: null,
      taskType: task.task_type,
      userId: task.user_id,
    });
    this.logger.log(`任务失败编排完成 taskId=${task.task_id} error=${errorMsg}`);
  }

  /* ------------------------------------------------------------------ */
  /* 内部                                                                */
  /* ------------------------------------------------------------------ */

  /** 产物规范化：非空 + 合法 JSON 解析（系统数据，集成缺陷上抛随网关兜底 FAILED）。 */
  private normalizeResult(task: GenerationTaskDocument, result: string): unknown {
    if (result == null || result.trim().length === 0) {
      throw new Error(`任务产物为空 taskId=${task.task_id}`);
    }
    try {
      return JSON.parse(result);
    } catch (error) {
      throw new Error(
        `任务产物非法 JSON taskId=${task.task_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** 终态判定（SUCCEEDED/FAILED/CANCELLED；回调幂等前置） */
function isTerminal(taskStatus: string): boolean {
  return (
    taskStatus === TaskStatus.SUCCEEDED ||
    taskStatus === TaskStatus.FAILED ||
    taskStatus === TaskStatus.CANCELLED
  );
}

/** 失败摘要截断（≤512，DDL VARCHAR(512) 对齐；null 安全） */
function truncate(message: string | null | undefined, maxLength: number): string {
  if (message == null) {
    return '';
  }
  return message.length <= maxLength ? message : message.slice(0, maxLength);
}

/**
 * OUTLINE 产物形状守卫：大纲节点树顶层为数组（[{nodeId,title,points[],note,pageHint}]，
 * v1/mock 产物口径）。deck 域 updateDraftOutline 契约签名为 Record 容器（Mixed 嵌入），
 * 数组顶层为 v1 平移形态——经此受控断言+收窄转换（NR-01 escape：deck 契约冻结不可改，
 * 运行时 Mixed 存储数组合法）。
 */
function assertOutlineTree(task: GenerationTaskDocument, content: unknown): Record<string, unknown> {
  if (!Array.isArray(content)) {
    throw new Error(`大纲产物非法（顶层须为节点数组）taskId=${task.task_id}`);
  }
  return content as unknown as Record<string, unknown>;
}

/** 内容类产物形状守卫：版本 content 顶层须为 JSON 对象（pages[] 形状由 version 域 assertContentShape 终检）。 */
function assertContentObject(task: GenerationTaskDocument, content: unknown): Record<string, unknown> {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    throw new Error(`内容产物非法（顶层须为 JSON 对象）taskId=${task.task_id}`);
  }
  // 守卫后 content 为非 null 非数组 object（JSON.parse 产物），收窄到 Record 容器
  return content as Record<string, unknown>;
}
