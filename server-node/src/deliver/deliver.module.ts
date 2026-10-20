import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetModule } from '../asset/asset.module';
import { DeckModule } from '../deck/deck.module';
import { VersionModule } from '../version/version.module';
import { SYNC_CHANGE_SCANNER } from '../platform/sync/sync-change-scanner';
import { ExportService } from './export.service';
import { ExportTaskRepository } from './deliver.repository';
import { ExportTaskSyncScanner } from './export-task.sync-scanner';
import { ExportEventPublisher } from './deliver.events';
import { ExportArtifactStorageService } from './deliver.artifact-storage';
import { ExportDownloadTicketService } from './deliver.download-ticket.service';
import { PresentService } from './deliver.present-service';
import { DeliverDictService } from './deliver.dict-service';
import { ExportController } from './deliver.controller';
import { PresentController } from './deliver.present.controller';
import { DeliverDictController } from './deliver.dict.controller';
import { EXPORT_TASK_MODEL, ExportTaskSchema } from './schemas/dl_export_task.schema';

/**
 * deliver 域模块（C-06 导出交付 + S-03 演示放映，api-delivery.md 9 端点）。
 *
 * 分层（node-specs 20 §2）：
 *   controller×3（export[submit/list/cancel/upload/fail/download-ticket/
 *   GET download]/present/dict 路由前缀）→ service（Export 任务子流程 +
 *   **产物接收编排**（ADR-015 客户端渲染：upload→SUCCEEDED / fail→FAILED，
 *   幂等条件更新）+ Present 只读派生 + Dict 字典）→ repository（dl_export_task
 *   白名单/条件终态更新/EX 取号）→ schemas/dl_export_task.schema.ts
 *
 * 渲染位置（ADR-015，api-delivery v1.3）：客户端（Tauri 插件 + pptxgenjs）；
 *   服务端不渲染——产物经 upload（multipart，魔数/大小/属主/QUEUED 校验）回传，
 *   落盘 ExportArtifactStorageService 后条件推进 SUCCEEDED + deliver_export_finished。
 *
 * 跨域进口：DeckDomainService（assertFinalized——DeckModule）、
 *   VersionArchiveService（present 数据组装——VersionModule）、
 *   AssetDomainService（present 素材签名 URL——AssetModule）。
 * 跨域出口（manifest §10）：ExportService（countByDeck 只读）。
 * SYNC_CHANGE_SCANNER：EXPORT 聚合扫描器注册（SyncPullService 容器发现，无需 export）。
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: EXPORT_TASK_MODEL, schema: ExportTaskSchema }]),
    DeckModule,
    VersionModule,
    AssetModule,
  ],
  controllers: [ExportController, PresentController, DeliverDictController],
  providers: [
    // 仓储 / 事件
    ExportTaskRepository,
    ExportEventPublisher,
    // 基础设施：产物存储 + 下载票据（HMAC）
    ExportArtifactStorageService,
    ExportDownloadTicketService,
    // 应用服务
    ExportService,
    PresentService,
    DeliverDictService,
    // P-02 多端同步：EXPORT 聚合扫描器（platform SyncPullService 容器发现）
    { provide: SYNC_CHANGE_SCANNER, useClass: ExportTaskSyncScanner },
  ],
  exports: [ExportService],
})
export class DeliverModule {}
