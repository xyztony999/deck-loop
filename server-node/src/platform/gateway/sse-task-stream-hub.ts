import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject, Observable } from 'rxjs';
import { GW_TASK_ADVANCED, type GwTaskAdvancedPayload } from '../platform.events';
import { TaskStatus } from '../../common/enums';

/**
 * SSE 任务进度流 hub（GET /gw/task/stream 服务端连接管理，api-platform §4.4；
 * v1 SseTaskStreamHub 平移，Spring SseEmitter → RxJS Subject 由 @Sse 端点桥接）。
 *
 * - 连接：hub.register(userId, deckId) → Subject 订阅流；客户端断连由控制器
 *   监听 req close 注销（onModuleDestroy 兜底回收）；
 * - 心跳：单 timer 每 15s 广播 `heartbeat` 事件（契约心跳间隔）；
 * - 推送：task-progress{taskId,percent,stageText} / task-finished{taskId,taskStatus}，
 *   按订阅 userId 定向、订阅 deckId 可选过滤；发送失败即注销该订阅；
 * - 事件源：订阅 gw_task_advanced（网关调度推进）——v1 MQ 消费者 → @OnEvent；
 * - 终态去重：task-finished 对同一 (taskId,taskStatus) 30s 窗口内只推一次
 *   （gw_task_advanced 与 gen_task_finished 双路径防重复下发）。
 */
@Injectable()
export class SseTaskStreamHub implements OnModuleDestroy {
  /** 心跳间隔（api-platform：心跳 15s） */
  static readonly HEARTBEAT_MILLIS = 15_000;

  /** SSE 事件名（契约） */
  static readonly EVENT_PROGRESS = 'task-progress';
  static readonly EVENT_FINISHED = 'task-finished';
  static readonly EVENT_HEARTBEAT = 'heartbeat';

  /** 终态去重窗口 */
  private static readonly FINISHED_DEDUP_TTL_MS = 30_000;

  private readonly logger = new Logger(SseTaskStreamHub.name);

  private readonly subscriptions = new Map<number, Subscription>();

  private nextSubscriptionId = 1;

  /** 终态去重表（taskId → {taskStatus, at}；心跳时清扫过期项） */
  private readonly finishedRecent = new Map<string, { taskStatus: string; at: number }>();

  private readonly heartbeatTimer = setInterval(() => this.beatAll(), SseTaskStreamHub.HEARTBEAT_MILLIS);

  /** 订阅句柄（控制器持有 id 用于注销） */
  register(userId: string, deckId: string | undefined): SseSubscription {
    const id = this.nextSubscriptionId;
    this.nextSubscriptionId += 1;
    const subject = new Subject<SseMessageEvent>();
    const subscription: Subscription = { id, userId, deckId: normalizeDeckId(deckId), subject };
    this.subscriptions.set(id, subscription);
    this.logger.log(
      `SSE 订阅建立 userId=${userId} deckId=${deckId ?? '-'} 当前连接数=${this.subscriptions.size}`,
    );
    return { id, events: subject.asObservable() };
  }

  /** 注销订阅（客户端断连/完成） */
  unregister(id: number): void {
    const subscription = this.subscriptions.get(id);
    if (subscription === undefined) {
      return;
    }
    this.subscriptions.delete(id);
    if (!subscription.subject.closed) {
      subscription.subject.complete();
    }
    this.logger.debug(`SSE 订阅注销 id=${id} 当前连接数=${this.subscriptions.size}`);
  }

  /** 任务进度推送（task-progress） */
  pushProgress(userId: string, deckId: string | undefined, taskId: string, percent: number, stageText: string): void {
    this.broadcast(
      userId,
      deckId,
      SseTaskStreamHub.EVENT_PROGRESS,
      JSON.stringify({ taskId, percent, stageText }),
    );
  }

  /** 任务终态推送（task-finished；同 (taskId,taskStatus) 30s 窗口去重） */
  pushFinished(userId: string, deckId: string | undefined, taskId: string, taskStatus: string): void {
    const seen = this.finishedRecent.get(taskId);
    if (seen !== undefined && seen.taskStatus === taskStatus && Date.now() - seen.at < SseTaskStreamHub.FINISHED_DEDUP_TTL_MS) {
      return;
    }
    this.finishedRecent.set(taskId, { taskStatus, at: Date.now() });
    this.broadcast(
      userId,
      deckId,
      SseTaskStreamHub.EVENT_FINISHED,
      JSON.stringify({ taskId, taskStatus }),
    );
  }

  /** gw_task_advanced 订阅（原 v1 GwTaskAdvancedConsumer→SSE 下发路径） */
  @OnEvent(GW_TASK_ADVANCED)
  onTaskAdvanced(payload: GwTaskAdvancedPayload): void {
    try {
      const status = payload.taskStatus;
      if (
        status === TaskStatus.SUCCEEDED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        this.pushFinished(payload.userId, payload.deckId, payload.taskId, status);
      } else {
        this.pushProgress(
          payload.userId,
          payload.deckId,
          payload.taskId,
          payload.percent,
          payload.stageText,
        );
      }
    } catch (error) {
      // 订阅方异常不影响发布方（06 §5）；SSE 为增强通道，轮询兜底
      this.logger.warn(
        `gw_task_advanced SSE 下发异常 taskId=${payload.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 停机：停心跳、完成全部订阅流 */
  onModuleDestroy(): void {
    clearInterval(this.heartbeatTimer);
    for (const id of [...this.subscriptions.keys()]) {
      this.unregister(id);
    }
  }

  private beatAll(): void {
    this.pruneFinishedRecent();
    for (const subscription of this.subscriptions.values()) {
      this.sendQuietly(subscription, SseTaskStreamHub.EVENT_HEARTBEAT, JSON.stringify({ ts: Date.now() }));
    }
  }

  private broadcast(userId: string, deckId: string | undefined, event: string, data: string): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.userId !== userId) {
        continue;
      }
      // 订阅 deckId 过滤（可选；事件缺 deckId 时按 v1 语义不投递给过滤订阅）
      if (subscription.deckId !== undefined && subscription.deckId !== normalizeDeckId(deckId)) {
        continue;
      }
      this.sendQuietly(subscription, event, data);
    }
  }

  private sendQuietly(subscription: Subscription, event: string, data: string): void {
    if (subscription.subject.closed) {
      this.unregister(subscription.id);
      return;
    }
    try {
      subscription.subject.next({ type: event, data });
    } catch (error) {
      // 连接已断：注销订阅（SSE 生命周期回收，非业务异常吞并）
      this.logger.debug(
        `SSE 连接失效已注销 userId=${subscription.userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.unregister(subscription.id);
    }
  }

  private pruneFinishedRecent(): void {
    const now = Date.now();
    for (const [taskId, entry] of this.finishedRecent) {
      if (now - entry.at >= SseTaskStreamHub.FINISHED_DEDUP_TTL_MS) {
        this.finishedRecent.delete(taskId);
      }
    }
  }
}

/** 订阅内部结构 */
interface Subscription {
  readonly id: number;
  readonly userId: string;
  readonly deckId: string | undefined;
  readonly subject: Subject<SseMessageEvent>;
}

/** SSE 消息事件（Nest MessageEvent 结构子集：type=事件名，data=预序列化 JSON 字符串） */
export interface SseMessageEvent {
  type: string;
  data: string;
}

/** 订阅句柄 */
export interface SseSubscription {
  readonly id: number;
  readonly events: Observable<SseMessageEvent>;
}

function normalizeDeckId(deckId: string | undefined): string | undefined {
  return typeof deckId === 'string' && deckId.trim().length > 0 ? deckId.trim() : undefined;
}
