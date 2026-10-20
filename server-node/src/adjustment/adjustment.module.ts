import { Module } from '@nestjs/common';
import { AssetModule } from '../asset/asset.module';
import { DeckModule } from '../deck/deck.module';
import { GenerationModule } from '../generation/generation.module';
import {
  AdjustmentScopeController,
  AdjustmentTargetedController,
  AdjustmentWholeController,
} from './adjustment.controller';
import { AdjustmentDictController } from './adjustment.dict.controller';
import { AdjustmentDictService } from './adjustment.dict-service';
import { AdjustmentQueryRepository } from './adjustment.query-repository';
import { AdjustmentService } from './adjustment.service';

/**
 * adjustment 域模块（C-03 语言调整，api-adjustment.md 4 端点）。
 *
 * 分层（node-specs 20 §2）：
 *   controller×4（whole/targeted/scope/dict 路由前缀）→ service（Adjustment 指令
 *   编排 + Dict 字典）→ query-repository（跨聚合只读投影，v1 AdjustQueryMapper
 *   先例）。**本域无自有 collection、无 schema**（调整指令=instruction_snapshot
 *   值对象，随 dl_generation_task / dl_deck_version 文档整体嵌入）。
 *
 * 跨域进口（domain-manifest §3④）：
 *   DeckDomainService（getDeck 属主加载——DeckModule）、
 *   GenerationTaskDomainService（createTask 统一创建链，同表写入——GenerationModule；
 *   INV-3/INV-8 守卫与 gen_task_created 复用，跨域 BizException 原样透传）、
 *   AssetDomainService（getBrandKit 品牌规范启用态校验 / assertTemplatesExist
 *   话术存在性轻校验——AssetModule）；
 *   分支名早期冲突拦截与基线版本归属/内容读取经 AdjustmentQueryRepository
 *   读 dl_deck_version raw 只读投影（snake_case，无写路径）。
 *
 * 跨域出口：无（manifest §3「提供：无」——管理接口 + 值对象契约，
 * 提交即锁定基线 baseVersionId 快照进 instruction_snapshot）。
 */
@Module({
  imports: [DeckModule, GenerationModule, AssetModule],
  controllers: [
    AdjustmentWholeController,
    AdjustmentTargetedController,
    AdjustmentScopeController,
    AdjustmentDictController,
  ],
  providers: [AdjustmentQueryRepository, AdjustmentService, AdjustmentDictService],
})
export class AdjustmentModule {}
