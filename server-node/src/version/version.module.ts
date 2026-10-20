import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetModule } from '../asset/asset.module';
import { DeckModule } from '../deck/deck.module';
import { SYNC_CHANGE_SCANNER } from '../platform/sync/sync-change-scanner';
import { DECK_VERSION_MODEL, DeckVersionSchema } from './schemas/dl_deck_version.schema';
import { VersionRepository } from './version.repository';
import { VersionEventPublisher } from './version.events';
import { VersionArchiveService } from './version.archive-service';
import { VersionManageService } from './version.manage-service';
import { VersionDictService } from './version.dict-service';
import { DeckVersionSyncScanner } from './deck-version-sync.scanner';
import { VersionController } from './version.controller';
import { VersionDictController } from './version.dict.controller';

/**
 * version 域模块（C-04 版本管理，api-version.md 6 端点）。
 *
 * 分层（node-specs 20 §2）：
 *   controller×2（version/dict 路由前缀）→ service（Archive 留档唯一写路径 +
 *   Domain 跨域契约 / Manage 管理接口 / Dict 字典）→ repository（dl_deck_version
 *   白名单、insert-only INV-11）→ schemas/dl_deck_version.schema.ts
 *
 * 跨域出口（domain-manifest §10，供 generation/deliver/adjustment/deck 进程内直调）：
 *   VersionArchiveService——createVersionFromTask（版本写入唯一入口）/
 *   getVersionContent / countByDeck。
 * 跨域进口：DeckDomainService（movePointer/getDeck——DeckModule）、
 *   AssetDomainService（adjustRefCounts——AssetModule）。
 * SYNC_CHANGE_SCANNER：VERSION 聚合扫描器注册（SyncPullService 经容器发现，无需 export）。
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: DECK_VERSION_MODEL, schema: DeckVersionSchema }]),
    DeckModule,
    AssetModule,
  ],
  controllers: [VersionController, VersionDictController],
  providers: [
    VersionRepository,
    VersionEventPublisher,
    VersionArchiveService,
    VersionManageService,
    VersionDictService,
    // P-02 多端同步：VERSION 聚合扫描器（platform SyncPullService 容器发现）
    { provide: SYNC_CHANGE_SCANNER, useClass: DeckVersionSyncScanner },
  ],
  exports: [VersionArchiveService],
})
export class VersionModule {}
