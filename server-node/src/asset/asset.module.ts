import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AssetController,
  AssetDictController,
  AssetSelectController,
  BrandKitController,
  PromptTemplateController,
} from './asset.controller';
import {
  AssetDictService,
  AssetDomainService,
  AssetService,
  BrandKitService,
  PromptTemplateService,
} from './asset.service';
import {
  AssetRepository,
  BrandKitRepository,
  DeckBrandKitRefRepository,
  PromptTemplateRepository,
} from './asset.repository';
import {
  AssetOperResolver,
  BrandKitOperResolver,
  PromptTemplateOperResolver,
} from './asset.oper-resolver';
import { AssetStorageService } from './asset.storage';
import { AssetFilesController } from './asset.files.controller';
import { Asset } from './schemas/asset.schema';
import { BrandKit } from './schemas/brand-kit.schema';
import { PromptTemplate } from './schemas/prompt-template.schema';

/**
 * asset 域模块（S-01 素材品牌 + S-02 话术；api-assets.md 三聚合根）。
 * 分层：controller → service → repository → schemas（node-specs 20 §2）。
 * 对外导出 AssetDomainService（OHS/跨域契约：adjustRefCounts / signFileUrls /
 * getBrandKit / assertTemplatesExist / getBrandKitNames，manifest §10），
 * 供 version/generation/deliver/deck/adjustment 域进程内注入（域间无 HTTP 回环）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Asset, BrandKit, PromptTemplate])],
  controllers: [
    AssetController,
    BrandKitController,
    PromptTemplateController,
    AssetSelectController,
    AssetDictController,
    // 限时签名 URL 文件流端点（GET /files；无会话，HMAC 凭证即授权）
    AssetFilesController,
  ],
  providers: [
    // 仓储
    AssetRepository,
    BrandKitRepository,
    PromptTemplateRepository,
    DeckBrandKitRefRepository,
    // 基础设施 / 行操作列
    AssetStorageService,
    AssetOperResolver,
    BrandKitOperResolver,
    PromptTemplateOperResolver,
    // 应用服务
    AssetService,
    BrandKitService,
    PromptTemplateService,
    AssetDictService,
    // 域间直调契约（OHS）
    AssetDomainService,
  ],
  exports: [AssetDomainService],
})
export class AssetModule {}
