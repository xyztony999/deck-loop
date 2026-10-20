import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ClientSession } from 'mongoose';

/**
 * 创作物状态变更事件（businessType=deck_deck_status-changed，api-deck §4.5）。
 * 载荷：deckId/deckStatus/userId（契约冻结）；订阅方：多端同步（P-02）、客户端通知。
 */
export const DECK_DECK_STATUS_CHANGED = 'deck_deck_status-changed';

export interface DeckStatusChangedPayload {
  deckId: string;
  /** 变更后的 DeckStatus code */
  deckStatus: string;
  userId: string;
}

/**
 * deck 域事件发布器（v1 DeckEventPublisher + DeckMqConstants 的进程内 EventEmitter2 平移）。
 *
 * NR-07「事务提交后发布（回滚不发）」实现口径：
 * - 无 session（单文档条件更新已自动提交）：写库成功后立即发布；
 * - 携带进行中事务 session（generation 成功回调编排同事务调用本域）：挂 session
 *   'ended' 一次性监听，事务状态 committed 才发布、aborted 丢弃；
 *   若调用方未显式 endSession（非常规用法），事件延迟至连接层会话回收——
 *   订阅方（多端同步）有 /auth/sync/pull 游标拉取兜底，属可接受的降级路径。
 *
 * 注意：save（新建/编辑）、movePointer（指针/分支移动）、updateDraftOutline（大纲写入）
 * 非状态变更，不发布本事件（v1 口径一致）。
 */
@Injectable()
export class DeckEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  /** 发布 deck_deck_status-changed（按 session 事务状态决定立即/延迟发布） */
  publishStatusChanged(
    deckId: string,
    deckStatus: string,
    userId: string,
    session?: ClientSession,
  ): void {
    const payload: DeckStatusChangedPayload = { deckId, deckStatus, userId };
    if (session != null && session.inTransaction()) {
      session.once('ended', () => {
        // driver Transaction 提交态：'committed' 才发布（'aborted' 丢弃；字符串字面量
        // 对齐 mongodb TRANSACTION_STATE.COMMITTED，避免直接 import 'mongodb'。
        // typings 未公开 state 字段，经结构化类型安全取用）
        const state = (session.transaction as unknown as { state?: string } | null)?.state;
        if (state === undefined || state === 'committed') {
          this.emitter.emit(DECK_DECK_STATUS_CHANGED, payload);
        }
      });
      return;
    }
    this.emitter.emit(DECK_DECK_STATUS_CHANGED, payload);
  }
}
