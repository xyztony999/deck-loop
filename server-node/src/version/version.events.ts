import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * 版本留档事件（businessType=ver_version_created，api-version §4.5）。
 * 载荷：versionId/deckId/versionSeq/branchName（契约冻结）；订阅方：多端同步
 * （P-02）、客户端通知。同时该留档路径在编排中触发 asset 引用计数回调
 * （INV-18，进程内直调，不走本事件，v1 口径一致）。
 */
export const VER_VERSION_CREATED = 'ver_version_created';

export interface VersionCreatedPayload {
  versionId: string;
  deckId: string;
  versionSeq: number;
  branchName: string;
  /** 发布侧冗余（ADR-005 隔离字段回传，订阅方免二次查询；非契约冻结字段） */
  userId: string;
  /** 业务分型（VersionSourceType code，v1 businessStatus 语义对齐） */
  sourceType: string;
}

/**
 * version 域事件发布器（v1 VersionEventPublisher + VersionMqConstants 的进程内
 * EventEmitter2 平移）。
 *
 * NR-07「事务提交后发布（回滚不发）」实现口径：VersionArchiveService 的留档
 * 编排为「事务内 insert → 提交后指针/引用计数」两段式（见该类注释的 deck 域
 * session 缺口说明），事件在全部写入成功后发布——调用点位于
 * `await connection.transaction(...)` 与指针/计数写完成之后，天然满足
 * 「提交后发布、失败不发」。
 */
@Injectable()
export class VersionEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  /** 发布 ver_version_created（仅在版本插入已提交且编排写路径全部成功后调用） */
  publishCreated(payload: VersionCreatedPayload): void {
    this.emitter.emit(VER_VERSION_CREATED, payload);
  }
}
