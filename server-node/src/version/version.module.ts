import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetModule } from '../asset/asset.module';
import { DeckModule } from '../deck/deck.module';
import { PlatformModule } from '../platform/platform.module';
import { SYNC_CHANGE_SCANNER } from '../platform/sync/sync-change-scanner';
import { DeckVersion } from './schemas/dl_deck_version.schema';
import { VersionRepository } from './version.repository';
import { VersionEventPublisher } from './version.events';
import { VersionArchiveService } from './version.archive-service';
import { VersionAgentService } from './version.agent-service';
import { VersionManageService } from './version.manage-service';
import { VersionDictService } from './version.dict-service';
import { DeckVersionSyncScanner } from './deck-version-sync.scanner';
import { VersionController } from './version.controller';
import { VersionDictController } from './version.dict.controller';

/**
 * version 域模块（C-04 版本管理，api-version.md 6 端点 + agent-create 增量
 * （api-web-agent §4.2，ADR-018）= 7 端点）。
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
    TypeOrmModule.forFeature([DeckVersion]),
    DeckModule,
    AssetModule,
    // agent-create 仅 token 守卫（ApiTokenGuard DI 须本模块上下文可解析；
    // PlatformModule @Global，此处显式 import 保证本地核心等精简装配同样可用）
    PlatformModule,
  ],
  controllers: [VersionController, VersionDictController],
  providers: [
    VersionRepository,
    VersionEventPublisher,
    VersionArchiveService,
    // agent 直写编排（api-web-agent §4.2；落库经 VersionArchiveService 唯一写入口）
    VersionAgentService,
    VersionManageService,
    VersionDictService,
    // P-02 多端同步：VERSION 聚合扫描器（platform SyncPullService 容器发现）
    { provide: SYNC_CHANGE_SCANNER, useClass: DeckVersionSyncScanner },
  ],
  exports: [VersionArchiveService],
})
export class VersionModule {}
