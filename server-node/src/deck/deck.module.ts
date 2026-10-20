import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeckController } from './deck.controller';
import { DeckDictController } from './deck.dict.controller';
import { DeckDictService } from './deck.dict-service';
import { DeckDomainService } from './deck.domain-service';
import { DeckManageService } from './deck.manage-service';
import { DeckEventPublisher } from './deck.events';
import { DeckRepository } from './deck.repository';
import { DeckSelectController } from './deck.select.controller';
import { DeckStatsRepository } from './deck.stats.repository';
import { DECK_MODEL, DeckSchema } from './schemas/dl_deck.schema';

/**
 * deck 域模块（C-01 创作物管理 + C-05 定稿，api-deck.md 10 端点）。
 *
 * 分层（node-specs 20 §2）：
 *   controller×3（deck/dict/select 路由前缀）→ service（Manage 動作编排 + Dict 字典
 *   + Domain 跨域契约）→ repository（dl_deck 白名单/条件更新）+ stats.repository
 *   （跨 collection 只读聚合，v1 DeckStatsMapper 先例）→ schemas/dl_deck.schema.ts
 *
 * 跨域出口（domain-manifest §10，供 generation/adjustment/version/deliver 进程内直调）：
 *   DeckDomainService——assertCanCreateTask / assertFinalized / movePointer /
 *   onFirstVersionCreated / updateDraftOutline / getDeck。
 * deck 域零出站：不 import 任何他域 Service（统计只读直查 collection，见 stats.repository）。
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: DECK_MODEL, schema: DeckSchema }])],
  controllers: [DeckController, DeckDictController, DeckSelectController],
  providers: [
    DeckRepository,
    DeckStatsRepository,
    DeckEventPublisher,
    DeckDomainService,
    DeckManageService,
    DeckDictService,
  ],
  exports: [DeckDomainService],
})
export class DeckModule {}
