import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
import { ModuleRef } from '@nestjs/core';
import { TaskStatus, TaskType } from '../../common/enums';
import { nextId } from '../../common/utils/snowflake';
import { UsageRecord } from '../schemas/usage-record.schema';
import { GenerationTaskCoreRepository } from '../generation-task-core.repository';
import { UsageRecordRepository } from '../usage-record.repository';
import { GW_TASK_ADVANCED, GW_USAGE_RECORDED, type GwTaskAdvancedPayload, type GwUsageRecordedPayload } from '../platform.events';
import { GW_PROVIDER_FAILED } from '../platform.errors';
import { type AiProviderAdapter, type ProviderCallContext, type ProviderCallResult, ProviderCallError } from './ai-provider-adapter';
import { GATEWAY_TASK_CALLBACK, type GatewayTaskCallback, type GatewayTaskUsage } from './gateway-task-callback';
import type { GatewayTaskRequest } from './gateway-task-request';
import { GatewayRuntimeStore } from './gateway-runtime-store';
import { ProviderAdapterRegistry } from './provider-adapter.registry';
import { ProviderCredentialsResolver } from './provider-credentials.resolver';

/**
 * 网关任务调度器（api-platform §4.3 平台机制：队列消费→适配器调用→回调业务编排；
 * v1 GatewayTaskServiceImpl 平移，MQ→进程内事件）。
 *
 * 职责边界（D1 同表共治）：QUEUED→RUNNING 条件推进（幂等键=taskId+期望前置状态）、
 * provider 调用（幂等键=taskId）、计量回填与 dl_usage_record 入账、终态回调
 * generation 编排（GatewayTaskCallback，ModuleRef 惰性解析=ObjectProvider 语义）。
 * SUCCEEDED/FAILED 落库与 result_version_id 由编排方完成（INV：SUCCEEDED ⇔
 * result_version_id 非空）；编排缺失/崩溃时网关兜底推进 FAILED。
 *
 * 并发控制 INV-25：单用户并发 ≤maxConcurrentPerUser（默认 3），超出在内存等待队列
 * 排队；进程重启丢失排队任务（v1 骨架实现语义，生产可换持久化队列）。
 * 单实例假设（node-specs 20 §5 / NR-13）。
 */
@Injectable()
export class GatewayTaskService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayTaskService.name);

  /** 等待队列（FIFO；用户并发满时跳过保留） */
  private readonly waiting: GatewayTaskRequest[] = [];

  /** 用户在飞计数（INV-25） */
  private readonly runningByUser = new Map<string, number>();

  private inFlight = 0;

  constructor(
    private readonly store: GatewayRuntimeStore,
    private readonly taskRepository: GenerationTaskCoreRepository,
    private readonly usageRepository: UsageRecordRepository,
    private readonly credentialsResolver: ProviderCredentialsResolver,
    private readonly adapterRegistry: ProviderAdapterRegistry,
    private readonly moduleRef: ModuleRef,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 提交任务到网关执行（异步；立即返回，进度经 SSE /gw/task/stream 或
   * POST /gen/task/progress 轮询获取）。= v1 submitToGateway（manifest §10 签名）。
   */
  execute(task: GatewayTaskRequest): void {
    if (task === null || task === undefined || typeof task.taskId !== 'string' || task.taskId.length === 0) {
      this.logger.warn('网关提交被忽略：task/taskId 为空');
      return;
    }
    this.logger.log(
      `任务提交网关 taskId=${task.taskId} type=${task.taskType} channel=${task.channelCode}/${task.modelCode} userId=${task.userId}`,
    );
    this.waiting.push(task);
    this.dispatch();
  }

  /** 派发扫描：为并发未满的用户出队执行（INV-25 + 全局背压闸） */
  private dispatch(): void {
    for (let i = 0; i < this.waiting.length; ) {
      const task = this.waiting[i];
      if (this.inFlight >= this.store.get().globalDispatchConcurrency) {
        break;
      }
      if (this.runningOf(task.userId) < this.store.get().maxConcurrentPerUser) {
        this.waiting.splice(i, 1);
        this.runningByUser.set(task.userId, this.runningOf(task.userId) + 1);
        this.inFlight += 1;
        void this.runTask(task).finally(() => {
          this.runningByUser.set(task.userId, this.runningOf(task.userId) - 1);
          this.inFlight -= 1;
          this.dispatch();
        });
      } else {
        i += 1;
      }
    }
  }

  /** 单任务执行主流程（异常一律转任务失败路径，非吞并） */
  private async runTask(task: GatewayTaskRequest): Promise<void> {
    try {
      if (!(await this.taskRepository.advanceToRunning(task.taskId))) {
        // 幂等守卫：任务已被取消或已推进（回调重复投递终态守卫）
        this.logger.log(`任务未处于 QUEUED，网关跳过执行 taskId=${task.taskId}`);
        return;
      }
      this.emitAdvanced(task, TaskStatus.RUNNING, 10, '已提交模型执行');

      const adapter = this.adapterRegistry.resolve(task.channelCode);
      // ADR-010：密钥仅网关域内流转（resolver → context → adapter），不进日志/VO/事件
      const context: ProviderCallContext = {
        task,
        apiKey: this.credentialsResolver.resolveApiKey(task.channelCode),
        timeoutMillis: this.store.get().providerTimeoutMillis,
      };

      const result = await this.dispatchByType(adapter, context, task);
      this.emitAdvanced(task, TaskStatus.RUNNING, 50, '模型生成完成');

      await this.taskRepository.backfillUsage(task.taskId, result.promptTokens, result.completionTokens);
      const usageId = await this.recordUsage(task, result);
      this.emitUsageRecorded(task, usageId, result);

      await this.invokeCallback(task, TaskStatus.SUCCEEDED, result.content, toUsage(task, result));
      this.emitAdvanced(task, TaskStatus.RUNNING, 90, '产物编排完成');
      this.emitAdvanced(task, TaskStatus.SUCCEEDED, 100, '任务完成');
    } catch (error) {
      // 网关异步边界：异常转为任务失败路径（状态与回调均推进）
      if (error instanceof ProviderCallError) {
        this.logger.warn(`provider 调用失败 taskId=${task.taskId} code=${error.code}: ${error.message}`);
      } else {
        this.logger.error(
          `网关调度异常 taskId=${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
      // 错误码走 platform.errors.ts 常量（NR-09 禁散落字面量）；此处为 error_msg
      // 描述前缀（回调入参），与 ProviderCallError.code 前缀语义一致
      const summary =
        error instanceof ProviderCallError
          ? `${error.code}: ${error.message}`
          : `${GW_PROVIDER_FAILED}: ${error instanceof Error ? error.message : String(error)}`;
      await this.invokeCallback(task, TaskStatus.FAILED, summary, toUsage(task, null));
      this.emitAdvanced(task, TaskStatus.FAILED, 100, '任务失败');
    }
  }

  /** 按 TaskType 分派适配器方法（未知类型按 provider 失败处理） */
  private async dispatchByType(
    adapter: AiProviderAdapter,
    context: ProviderCallContext,
    task: GatewayTaskRequest,
  ): Promise<ProviderCallResult> {
    switch (task.taskType) {
      case TaskType.OUTLINE:
        return adapter.generateOutline(context);
      case TaskType.FULL_GENERATE:
        return adapter.generateContent(context);
      case TaskType.FULL_ADJUST:
      case TaskType.TARGETED_ADJUST:
        return adapter.adjustContent(context);
      default:
        throw ProviderCallError.failed(`未知任务类型: ${task.taskType}`, false);
    }
  }

  /** 用量入账（dl_usage_record 只追加；成功 ack 后发 gw_usage_recorded） */
  private async recordUsage(task: GatewayTaskRequest, result: ProviderCallResult): Promise<string> {
    const usageId = nextId();
    const record = new UsageRecord();
    record.usage_id = usageId;
    record.user_id = task.userId;
    record.task_id = task.taskId;
    record.task_type = task.taskType;
    record.channel_code = task.channelCode;
    record.model_code = task.modelCode;
    record.prompt_tokens = result.promptTokens;
    record.completion_tokens = result.completionTokens;
    record.occurred_at = new Date();
    await this.usageRepository.append(record);
    return usageId;
  }

  /**
   * 回调业务编排；编排未就绪/抛错时网关兜底推进 FAILED（无产物，终态守卫条件更新）。
   * 本方法自身不抛出（调度主流程的失败路径已终态化，此处兜底必须收敛）。
   */
  private async invokeCallback(
    task: GatewayTaskRequest,
    status: string,
    result: string,
    usage: GatewayTaskUsage,
  ): Promise<void> {
    const callback = this.resolveCallback();
    if (callback === null) {
      this.logger.warn(
        `generation 编排未就绪（延迟绑定），网关兜底推进终态 taskId=${task.taskId} status=${status}`,
      );
      await this.fallbackAdvanceFailed(task.taskId, result);
      return;
    }
    try {
      await callback.onTaskCallback(task.taskId, status, result, usage);
    } catch (error) {
      this.logger.error(
        `任务编排回调失败，网关兜底推进 FAILED taskId=${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.fallbackAdvanceFailed(task.taskId, result);
    }
  }

  /** 惰性解析 generation 编排回调（跨模块 token，未注册返回 null；Nest 10：get strict:false 全局查找） */
  private resolveCallback(): GatewayTaskCallback | null {
    try {
      const callback = this.moduleRef.get<GatewayTaskCallback>(GATEWAY_TASK_CALLBACK, { strict: false });
      return callback ?? null;
    } catch {
      return null;
    }
  }

  /** RUNNING→FAILED 兜底推进（仅编排崩溃路径；errorMsg 截断 512） */
  private async fallbackAdvanceFailed(taskId: string, reason: string): Promise<void> {
    try {
      await this.taskRepository.fallbackAdvanceFailed(taskId, reason);
    } catch (error) {
      this.logger.error(
        `兜底推进 FAILED 失败 taskId=${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 发 gw_task_advanced（对应 DB 写入/回调成功之后；SSE 下发、同步游标分配消费） */
  private emitAdvanced(task: GatewayTaskRequest, status: string, percent: number, stageText: string): void {
    const payload: GwTaskAdvancedPayload = {
      taskId: task.taskId,
      taskStatus: status,
      userId: task.userId,
      deckId: task.deckId,
      percent,
      stageText,
    };
    this.eventEmitter.emit(GW_TASK_ADVANCED, payload);
  }

  /** 发 gw_usage_recorded（用量落库 ack 之后；统计聚合 D-01 消费） */
  private emitUsageRecorded(task: GatewayTaskRequest, usageId: string, result: ProviderCallResult): void {
    const payload: GwUsageRecordedPayload = {
      usageId,
      taskId: task.taskId,
      userId: task.userId,
      deckId: task.deckId,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
    this.eventEmitter.emit(GW_USAGE_RECORDED, payload);
  }

  private runningOf(userId: string): number {
    const key = typeof userId === 'string' && userId.length > 0 ? userId : '';
    return this.runningByUser.get(key) ?? 0;
  }

  /** 停机钩子：内存队列丢弃（v1 @PreDestroy 语义；RUNNING 任务由重启兜底扫描处理） */
  onModuleDestroy(): void {
    this.waiting.length = 0;
  }
}

/** 用量快照组装（失败路径 tokens=0，对齐 v1 toUsage(task, null)） */
function toUsage(task: GatewayTaskRequest, result: ProviderCallResult | null): GatewayTaskUsage {
  return {
    channelCode: task.channelCode,
    modelCode: task.modelCode,
    promptTokens: result === null ? 0 : result.promptTokens,
    completionTokens: result === null ? 0 : result.completionTokens,
  };
}
