import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * generation 域领域事件（api-generation §4.5，businessType 冻结）。
 * EventEmitter2 进程内发布；**必须数据库写入成功（事务提交）之后发布**（NR-07，
 * 回滚不发）。adjustment 域复用两个事件（taskType 区分，domain-manifest §3）。
 */

/** 任务创建：网关调度（进程内 submitToGateway 直调；事件供 platform 同步/通知留痕） */
export const GEN_TASK_CREATED = 'gen_task_created';

/** 任务终态：多端同步、客户端通知（SSE 推送）；取消（用户操作）与回调终态（系统）共用 */
export const GEN_TASK_FINISHED = 'gen_task_finished';

/** gen_task_created 载荷（契约：taskId/deckId/taskType；userId 为 SSE/同步扩展，非契约冻结字段） */
export interface TaskCreatedPayload {
  taskId: string;
  deckId: string;
  /** TaskType code（创建时点 businessStatus=QUEUED 由 taskStatus 语义承载） */
  taskType: string;
  userId: string;
}

/** gen_task_finished 载荷（契约：taskId/deckId/taskStatus/resultVersionId；
 *  taskType/userId 为 SSE/同步扩展，非契约冻结字段） */
export interface TaskFinishedPayload {
  taskId: string;
  deckId: string;
  /** 终态 TaskStatus code（SUCCEEDED/FAILED/CANCELLED） */
  taskStatus: string;
  /** 成功产物版本（SUCCEEDED 必有；OUTLINE 任务无版本产物为 null） */
  resultVersionId: string | null;
  taskType: string;
  userId: string;
}

/**
 * generation 域事件发布器（v1 GenerationEventPublisher + GenerationMqConstants 的
 * 进程内 EventEmitter2 平移）。
 *
 * NR-07 实现口径：发布方法**只在写入已提交后由调用方调用**——
 * - createTask：connection.transaction(...) 成功返回后 publishCreated；
 * - 回调终态/取消：条件更新（单文档原子提交）matchedCount=1 后 publishFinished；
 *   0 行（重复投递/取消竞态）不发布（v1 advanced 判定同口径）。
 */
@Injectable()
export class GenerationEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  /** 发布 gen_task_created（任务插入事务已提交后调用） */
  publishCreated(payload: TaskCreatedPayload): void {
    this.emitter.emit(GEN_TASK_CREATED, payload);
  }

  /** 发布 gen_task_finished（终态/取消条件更新已生效后调用） */
  publishFinished(payload: TaskFinishedPayload): void {
    this.emitter.emit(GEN_TASK_FINISHED, payload);
  }
}
