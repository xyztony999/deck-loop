import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TxSession } from '../common/persistence';

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
 * deck 域事件发布器（v1 DeckEventPublisher + DeckMqConstants 的进程内 EventEmitter2 平移；
 * ADR-016 TypeORM 事务语义）。
 *
 * NR-07「事务提交后发布（回滚不发）」实现口径（TypeORM）：
 * - 状态变更写路径均为**单文档条件更新（自动提交）**或**调用方在 dataSource.transaction
 *   成功返回后**调用本发布器——写库已提交，立即发布即满足「事件⇒已落库」。
 * - session 形参保留以兼容跨域签名（写入透传事务）；TypeORM 无 mongoose session 'ended'
 *   监听，事务提交后发布由调用点（await transaction 之后）保证。onFirstVersionCreated
 *   的实际调用点（generation 成功回调）均在留档事务提交之后、无活动 session。
 *
 * 注意：save（新建/编辑）、movePointer（指针/分支移动）、updateDraftOutline（大纲写入）
 * 非状态变更，不发布本事件（v1 口径一致）。
 */
@Injectable()
export class DeckEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  /** 发布 deck_deck_status-changed（写库已提交后调用，立即发布） */
  publishStatusChanged(
    deckId: string,
    deckStatus: string,
    userId: string,
    _session?: TxSession,
  ): void {
    const payload: DeckStatusChangedPayload = { deckId, deckStatus, userId };
    this.emitter.emit(DECK_DECK_STATUS_CHANGED, payload);
  }
}