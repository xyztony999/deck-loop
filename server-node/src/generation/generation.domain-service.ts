import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { DeleteSign, TaskStatus, TaskType, type TaskTypeCode } from '../common/enums';
import { BizException } from '../common/exceptions';
import { nextId } from '../common/utils/snowflake';
import { ChannelPreferenceService } from '../channel/channel.service';
import { DeckDomainService } from '../deck/deck.domain-service';
import { GatewayTaskService } from '../platform/gateway/gateway-task.service';
import { GatewayTaskRequest } from '../platform/gateway/gateway-task-request';
import {
  GenerationTaskCreateCommand,
  GenerationTaskCreateResult,
} from './generation.dto';
import { TASK_DUPLICATE_RUNNING, TASK_DUPLICATE_RUNNING_MSG, TASK_SCOPE_INVALID } from './generation.errors';
import { GenerationEventPublisher } from './generation.events';
import { GenerationTaskRepository } from './generation.repository';
import { GenerationTask } from './schemas/dl_generation_task.schema';
import type { GenerationTaskDocument } from './schemas/dl_generation_task.schema';

/**
 * generation 域领域服务 —— 任务子流程创建链（api-generation §4.3；domain-manifest §10
 * 跨域契约承载类；v1 GenerationTaskDomainServiceImpl 平移）。
 *
 * 四类 taskType（OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST）共用同一创建链：
 * - generation 域自身两个发起接口（outline/full generate）与 retry 组装命令直调本类；
 * - adjustment 域（C-03）whole/targeted submit 组装 GenerationTaskCreateCommand 同表写入
 *   （调整类校验由 adjust 域先行完成）。
 *
 * 创建链编排（步骤与 v1 逐字对齐）：
 * 1. assertCommandValid（必填/taskType 值域/显式路由成对）；
 * 2. DeckDomainService#assertCanCreateTask（INV-3：FINALIZED/ARCHIVED 拒绝）；
 * 3. ChannelPreferenceService#resolve（ADR-010 四层链：任务显式>偏好档位>偏好默认>
 *    平台兜底；显式不可用直接失败不降级——channel 域契约异常透传）；
 * 4. 多文档事务内：INV-8 互斥校验（同 deck 至多 1 个非终态任务，存在性查询）
 *    + task_code 取号（GT+yyMMdd+4 位，表内 MAX+1）+ insert（QUEUED）；
 * 5. 提交后：发布 gen_task_created（NR-07）→ GatewayTaskService#execute（=submitToGateway；
 *    网关 QUEUED→RUNNING 条件推进须已见已提交行，故必须事务提交后提交网关）。
 */
@Injectable()
export class GenerationTaskDomainService {
  private readonly logger = new Logger(GenerationTaskDomainService.name);

  /** 规则编码前缀（api-generation §4.1：GT+yyMMdd+4位序列） */
  private static readonly TASK_CODE_PREFIX = 'GT';

  constructor(
    private readonly deckDomainService: DeckDomainService,
    private readonly channelPreferenceService: ChannelPreferenceService,
    private readonly gatewayTaskService: GatewayTaskService,
    private readonly taskRepository: GenerationTaskRepository,
    private readonly eventPublisher: GenerationEventPublisher,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * 创建生成任务（统一创建链，四类 taskType 共用）。
   *
   * @throws BizException DECK_STATUS_FORBIDDEN（INV-3）/ CHANNEL_UNAVAILABLE（显式路由
   *   不可用）/ TASK_DUPLICATE_RUNNING（INV-8）/ TASK_SCOPE_INVALID（入参非法）
   */
  async createTask(command: GenerationTaskCreateCommand): Promise<GenerationTaskCreateResult> {
    this.assertCommandValid(command);
    // 1. INV-3 守卫（FINALIZED/ARCHIVED 禁止创建任务；deck 域契约异常透传）
    await this.deckDomainService.assertCanCreateTask(command.deckId, command.userId);
    // 2. 路由解析（ADR-010 四层链；显式成对传入走 EXPLICIT 级，不可用直接失败不降级）
    const decision = await this.channelPreferenceService.resolve(
      command.taskType,
      command.userId,
      this.explicitRouteOf(command),
    );

    const now = new Date();
    const task = new GenerationTask();
    task.task_id = nextId();
    task.deck_id = command.deckId;
    task.task_type = command.taskType;
    task.base_version_id = command.baseVersionId ?? null;
    task.instruction_snapshot = command.instructionSnapshot;
    task.channel_code = decision.channelCode;
    task.model_code = decision.modelCode;
    task.task_status = TaskStatus.QUEUED;
    task.result_version_id = null;
    task.error_msg = null;
    task.prompt_tokens = null;
    task.completion_tokens = null;
    task.user_id = command.userId;
    task.created_by = command.userId;
    task.created_name = command.userId;
    task.created_time = now;
    task.updated_by = command.userId;
    task.updated_name = command.userId;
    task.updated_time = now;
    task.data_version = 0;
    task.delete_sign = DeleteSign.NOT_DELETED;

    // 3. 事务{INV-8 互斥 + GT 取号 + insert(QUEUED)}
    await this.connection.transaction(async (session) => {
      // INV-8：同 deck 同时最多 1 个非终态任务（deck_id+状态条件事务内存在性校验）
      const activeCount = await this.taskRepository.countActiveTasks(
        task.deck_id,
        GenerationTaskDomainService.activeStatuses(),
        session,
      );
      if (activeCount > 0) {
        throw new BizException(TASK_DUPLICATE_RUNNING, TASK_DUPLICATE_RUNNING_MSG);
      }
      // 表内 MAX+1 取号（v1 selectMaxTaskCodeForUpdate：事务快照读 + 同事务插入收窄
      // 并发窗口，uk_task_code 唯一索引兜底；deck 域 nextDeckCode 同模式）
      task.task_code = this.nextTaskCode(
        await this.taskRepository.findMaxTaskCode(GenerationTaskDomainService.todayPrefix(), session),
      );
      await this.taskRepository.insert(task, session);
    });

    // 4. 提交后发布 gen_task_created（NR-07：事务成功返回后；回滚不发）
    this.eventPublisher.publishCreated({
      taskId: task.task_id,
      deckId: task.deck_id,
      taskType: task.task_type,
      userId: task.user_id,
    });

    // 5. 提交网关（=v1 submitToGateway；异步立即返回，进度经 SSE / progress 轮询）
    const request = new GatewayTaskRequest();
    request.taskId = task.task_id;
    request.deckId = task.deck_id;
    request.taskType = task.task_type;
    request.userId = task.user_id;
    request.channelCode = task.channel_code;
    request.modelCode = task.model_code;
    request.instructionSnapshot = JSON.stringify(task.instruction_snapshot);
    this.gatewayTaskService.execute(request);

    this.logger.log(
      `生成任务已创建并提交网关 taskId=${task.task_id} code=${task.task_code}` +
        ` type=${task.task_type} channel=${task.channel_code}/${task.model_code}` +
        ` routeSource=${decision.source}`,
    );
    return GenerationTaskCreateResult.of(
      task.task_id,
      task.task_code,
      task.task_status,
      task.channel_code,
      task.model_code,
    );
  }

  /**
   * 按 ID 加载任务（进程内供他域读取，不做 user_id 过滤；可能返回 null——
   * 归属校验由调用方按其会话语境执行，v1 getById 语义）。
   */
  async getById(taskId: string): Promise<GenerationTaskDocument | null> {
    if (taskId == null || taskId.trim().length === 0) {
      return null;
    }
    return this.taskRepository.findById(taskId);
  }

  /* ------------------------------------------------------------------ */
  /* 内部                                                                */
  /* ------------------------------------------------------------------ */

  /** 命令校验（v1 assertCommandValid：必填/taskType 值域/显式路由成对必填） */
  private assertCommandValid(command: GenerationTaskCreateCommand): void {
    if (command == null) {
      throw new BizException(TASK_SCOPE_INVALID, '创建命令不能为空');
    }
    this.requireNonBlank(command.deckId, 'deckId');
    this.requireNonBlank(command.userId, 'userId');
    if (command.instructionSnapshot == null || typeof command.instructionSnapshot !== 'object') {
      throw new BizException(TASK_SCOPE_INVALID, '创建命令缺少必填字段: instructionSnapshot');
    }
    if (!Object.values(TaskType).includes(command.taskType as TaskTypeCode)) {
      throw new BizException(TASK_SCOPE_INVALID, `任务类型非法[${command.taskType}]`);
    }
    // 显式渠道/模型须成对（api-channel §5.1 resolve 全链重载契约；channel.resolve 亦拦半空）
    const explicitChannel = this.isNotBlank(command.explicitChannelCode);
    const explicitModel = this.isNotBlank(command.explicitModelCode);
    if (explicitChannel !== explicitModel) {
      throw new BizException(TASK_SCOPE_INVALID, '显式渠道与模型编码须成对指定');
    }
  }

  /** 显式路由入参组装（成对非空才传；空对=未显式指定走偏好档位链） */
  private explicitRouteOf(
    command: GenerationTaskCreateCommand,
  ): { channelCode: string; modelCode: string } | undefined {
    if (this.isNotBlank(command.explicitChannelCode) && this.isNotBlank(command.explicitModelCode)) {
      return {
        channelCode: command.explicitChannelCode!.trim(),
        modelCode: command.explicitModelCode!.trim(),
      };
    }
    return undefined;
  }

  /** 非终态状态口径（INV-8 计数输入，v1 activeStatuses 对齐） */
  private static activeStatuses(): string[] {
    return [TaskStatus.QUEUED, TaskStatus.RUNNING];
  }

  /** 当日取号前缀：GT+yyMMdd（服务器本地时区，v1 LocalDate.now 对齐） */
  private static todayPrefix(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const date = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return `${GenerationTaskDomainService.TASK_CODE_PREFIX}${date}`;
  }

  /** MAX+1 取号：前缀下最大 task_code 的 4 位序列 +1（%04d 不足补零，溢出自然进位） */
  private nextTaskCode(maxCode: string | null): string {
    const prefix = GenerationTaskDomainService.todayPrefix();
    let next = 1;
    if (maxCode != null && maxCode.length > prefix.length) {
      const parsed = Number.parseInt(maxCode.slice(prefix.length), 10);
      if (Number.isInteger(parsed)) {
        next = parsed + 1;
      }
    }
    return prefix + String(next).padStart(4, '0');
  }

  private requireNonBlank(value: string | null | undefined, field: string): void {
    if (value == null || value.trim().length === 0) {
      throw new BizException(TASK_SCOPE_INVALID, `创建命令缺少必填字段: ${field}`);
    }
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}
