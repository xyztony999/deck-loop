import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DELIVER_EXPORT_FINISHED } from './deliver.constant';
import type { ExportTaskDocument } from './schemas/dl_export_task.schema';

/**
 * 导出终态事件（businessType=deliver_export_finished，api-delivery §4.5）。
 * 载荷：exportId/deckId/exportStatus（契约冻结）；订阅方：多端同步（P-02）、
 * 客户端通知。发布于任意终态（SUCCEEDED/FAILED/CANCELLED）。
 * v1 ExportFinishedEvent 的 businessStatus 约定=ExportStatus code（20 §6），
 * 进程内 EventEmitter2 直发载荷对象（businessType 由事件名承载）。
 */
export interface ExportFinishedPayload {
  exportId: string;
  deckId: string;
  /** 业务终态（ExportStatus code） */
  exportStatus: string;
  /** 发布侧冗余（ADR-005 隔离字段回传，订阅方免二次查询；非契约冻结字段） */
  userId: string;
}

/**
 * deliver 域事件发布器（v1 ExportEventPublisher 的进程内 EventEmitter2 平移）。
 *
 * NR-07「事务提交后发布（回滚不发）」实现口径（v1 publishFinished(Supplier) 形态）：
 * ExportService 的终态推进=单文档条件 updateOne（自动提交，无跨文档事务），
 * 调用方在条件更新命中（拿到已提交行）后调用本方法；未命中的幂等空转不发布。
 */
@Injectable()
export class ExportEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  /** 发布 deliver_export_finished（仅在终态条件更新已提交后调用） */
  publishFinished(task: ExportTaskDocument): void {
    const payload: ExportFinishedPayload = {
      exportId: task.export_id,
      deckId: task.deck_id,
      exportStatus: task.export_status,
      userId: task.user_id,
    };
    this.emitter.emit(DELIVER_EXPORT_FINISHED, payload);
  }
}
