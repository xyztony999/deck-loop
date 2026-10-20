/**
 * asset 域应用服务 —— v1 AssetServiceImpl/BrandKitServiceImpl/PromptTemplateServiceImpl
 * /AssetDictRegistry/AssetDomainServiceImpl 对齐（api-assets.md 全量 + manifest §6/§10）。
 *
 * 不变量落实：
 * - INV-16 logoAssetId 启用态守卫（brandkit/save + provider-get 读侧弱化）
 * - INV-17 默认规范用户维度唯一（set-default 多文档事务切换）
 * - INV-18 refCount>0 禁删；brandkit logo 绑定/解绑与版本留档回调统一 $inc（GREATEST(0)）
 * - INV-19 上传类型/大小守卫（Service 前置校验 + FileInterceptor limits 双重拦截）
 * - INV-20 同 (user_id,file_hash) 查重复用（含软删行复活，uk_user_hash 兜底并发竞态）
 * - INV-21 话术占位符语法 {名称} ≤10 处
 * - ADR-004 被引用素材仅可停用不可删除
 *
 * 事件（NR-07）：asset_{resource}_changed，写入（含事务）成功后发布，回滚不发。
 * 事务：仅多文档编排用事务（brandkit 默认切换 / logo 绑定联动计数），单文档写
 * 依赖 Mongo 单文档原子性（对齐 manifest「跨文档编排用事务」口径）。
 */
import type { ClientSession } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Connection } from 'mongoose';
import {
  AssetStatus,
  AssetType,
  TemplateScene,
  YesNo,
  getAssetStatusLabel,
  getAssetTypeLabel,
  getTemplateSceneLabel,
} from '../common/enums';
import { BizException } from '../common/exceptions';
import { PageResult, SelectOption } from '../common/result';
import { nextId } from '../common/utils/snowflake';
import {
  ASSET_ALLOWED_EXTENSIONS,
  ASSET_ASSET_CHANGED,
  ASSET_BRANDKIT_CHANGED,
  ASSET_MAX_FILE_SIZE_BYTES,
  ASSET_PROMPT_CHANGED,
  DICT_KEY_ASSET_STATUS,
  DICT_KEY_ASSET_TYPE,
  DICT_KEY_TEMPLATE_SCENE,
  OP_CREATED,
  OP_DELETED,
  OP_DISABLED,
  OP_ENABLED,
  OP_TOUCHED,
  OP_UPDATED,
  PROMPT_MAX_PLACEHOLDER_COUNT,
  PROMPT_PLACEHOLDER_PATTERN,
} from './asset.constant';
import {
  ASSET_IN_USE,
  ASSET_TYPE_INVALID,
  BRANDKIT_IS_DEFAULT,
  BRANDKIT_LOGO_INVALID,
  PROMPT_PLACEHOLDER_SYNTAX,
} from './asset.errors';
import {
  AssetFileUrlAO,
  AssetFileUrlVO,
  AssetIdAO,
  AssetListAO,
  AssetListVO,
  AssetSaveAO,
  AssetSaveVO,
  AssetSelectListAO,
  AssetSelectVO,
  AssetUploadAO,
  AssetUploadVO,
  BrandKitIdAO,
  BrandKitListAO,
  BrandKitListVO,
  BrandKitProviderGetAO,
  BrandKitProviderGetVO,
  BrandKitSaveAO,
  BrandKitSaveVO,
  BrandKitSelectListAO,
  BrandKitSelectVO,
  PromptTemplateIdAO,
  PromptTemplateListAO,
  PromptTemplateListVO,
  PromptTemplateSaveAO,
  PromptTemplateSaveVO,
  PromptTemplateSelectListAO,
  PromptTemplateSelectVO,
  SignedFileUrl,
} from './asset.dto';
import {
  AssetOperResolver,
  BrandKitOperResolver,
  PromptTemplateOperResolver,
} from './asset.oper-resolver';
import {
  AssetRepository,
  BrandKitRepository,
  DeckBrandKitRefRepository,
  PromptTemplateRepository,
  isDuplicateKeyError,
  type MongoSession,
} from './asset.repository';
import { AssetStorageService } from './asset.storage';
import { Asset } from './schemas/asset.schema';
import { BrandKit } from './schemas/brand-kit.schema';
import { PromptTemplate } from './schemas/prompt-template.schema';

function notBlank(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim().length > 0;
}

/** 上传文件部件最小类型（@nestjs/platform-express memory storage；无 @types/multer，本地声明） */
export interface UploadedFilePayload {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  /** 字节（memory storage） */
  size: number;
  buffer: Buffer;
}

/* ===================================================================== */
/* AssetService —— 素材（S-01，dl_asset） */
/* ===================================================================== */

@Injectable()
export class AssetService {
  constructor(
    private readonly assetRepository: AssetRepository,
    private readonly storage: AssetStorageService,
    private readonly eventEmitter: EventEmitter2,
    private readonly operResolver: AssetOperResolver,
  ) {}

  /** #1 素材分页（keyword/category/assetType/assetStatus；operList 状态驱动） */
  async listPage(ao: AssetListAO, userId: string): Promise<PageResult<AssetListVO>> {
    const { records, total } = await this.assetRepository.findPage(ao, userId);
    return PageResult.of(records.map((doc) => this.toListVO(doc)), total, ao.pageNum, ao.pageSize);
  }

  /**
   * #2 素材上传（multipart；INV-19 类型/大小、INV-20 hash 查重/复活/并发回落）。
   * 尺寸读取为占位简化（width/height 置空，v1 ImageDimensionReader 的降位实现）。
   */
  async upload(
    file: UploadedFilePayload | undefined,
    ao: AssetUploadAO,
    userId: string,
  ): Promise<AssetUploadVO> {
    if (file === undefined || file.buffer === undefined || file.size === 0) {
      throw new BizException(ASSET_TYPE_INVALID, '上传文件不能为空');
    }
    const extension = resolveExtension(file.originalname);
    if (!ASSET_ALLOWED_EXTENSIONS.has(extension)) {
      throw new BizException(
        ASSET_TYPE_INVALID,
        '素材类型无效，仅支持 jpg/png/svg/webp（INV-19）',
      );
    }
    if (file.size > ASSET_MAX_FILE_SIZE_BYTES) {
      throw new BizException(ASSET_TYPE_INVALID, '单文件大小不能超过10MB（INV-19）');
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // INV-20：同 (user_id, file_hash) 复用既有素材，不重复存储；含逻辑删除行（复活路径）
    const existing = await this.assetRepository.findByHashIncludeDeleted(userId, fileHash);
    if (existing !== null && existing.delete_sign === 0) {
      return this.buildUploadVO(existing, true);
    }

    const assetType = notBlank(ao.assetType) ? ao.assetType : AssetType.IMAGE;
    const storageKey = await this.storage.store(userId, fileHash, extension, file.buffer);
    const assetName = notBlank(ao.assetName) ? ao.assetName : file.originalname;
    const category = notBlank(ao.category) ? ao.category : null;
    const now = new Date();

    if (existing !== null) {
      // 逻辑删除行复活（重传同 hash，复用唯一键行；复刻 v1 revive SQL 字段集）
      await this.assetRepository.revive(existing.asset_id, userId, {
        asset_name: assetName,
        category,
        asset_type: assetType,
        storage_key: storageKey,
        width: null,
        height: null,
        file_size: file.size,
        updated_by: userId,
        updated_time: now,
      });
      this.publishChanged(existing.asset_id, OP_CREATED);
      const revived: Pick<
        Asset,
        'asset_id' | 'storage_key' | 'width' | 'height' | 'file_hash'
      > = {
        asset_id: existing.asset_id,
        storage_key: storageKey,
        width: null,
        height: null,
        file_hash: fileHash,
      };
      return this.buildUploadVO(revived, false);
    }

    const doc: Asset = {
      asset_id: nextId(),
      asset_name: assetName,
      category,
      asset_type: assetType,
      storage_key: storageKey,
      file_hash: fileHash,
      width: null,
      height: null,
      file_size: file.size,
      asset_status: AssetStatus.ACTIVE,
      ref_count: 0,
      user_id: userId,
      data_version: 0,
      delete_sign: 0,
      created_by: userId,
      created_name: null,
      created_time: now,
      updated_by: userId,
      updated_name: null,
      updated_time: now,
    };
    try {
      await this.assetRepository.insert(doc);
    } catch (error) {
      // 并发同 hash 竞态：唯一索引 uk_user_hash 兜底，回落查重复用（INV-20，v1 对齐）
      if (isDuplicateKeyError(error)) {
        const winner = await this.assetRepository.findByHashIncludeDeleted(userId, fileHash);
        if (winner !== null) {
          return this.buildUploadVO(winner, true);
        }
      }
      throw error;
    }
    this.publishChanged(doc.asset_id, OP_CREATED);
    return this.buildUploadVO(doc, false);
  }

  /** #3 素材编辑（名称/分类） */
  async save(ao: AssetSaveAO, userId: string): Promise<AssetSaveVO> {
    await this.requireAsset(ao.assetId, userId);
    await this.assetRepository.updateMeta(ao.assetId, userId, {
      asset_name: ao.assetName,
      category: notBlank(ao.category) ? ao.category : null,
      updated_by: userId,
      updated_time: new Date(),
    });
    this.publishChanged(ao.assetId, OP_UPDATED);
    return { assetId: ao.assetId } satisfies AssetSaveVO;
  }

  /** #4 素材停用（被引用素材仅可停用，ADR-004） */
  async disable(ao: AssetIdAO, userId: string): Promise<void> {
    await this.switchStatus(ao.assetId, userId, AssetStatus.DISABLED);
  }

  /** #5 素材启用 */
  async enable(ao: AssetIdAO, userId: string): Promise<void> {
    await this.switchStatus(ao.assetId, userId, AssetStatus.ACTIVE);
  }

  /** #6 素材删除（仅 refCount=0，INV-18；否则 BIZ_ASSET_IN_USE） */
  async delete(ao: AssetIdAO, userId: string): Promise<void> {
    const doc = await this.requireAsset(ao.assetId, userId);
    if (doc.ref_count > 0) {
      throw new BizException(ASSET_IN_USE, '素材被引用中不可删除，仅可停用（INV-18）');
    }
    await this.assetRepository.softDelete(ao.assetId, userId, userId, new Date());
    this.publishChanged(ao.assetId, OP_DELETED);
  }

  /** #19 OHS：素材文件限时 URL 批量签发（生成/导出/演示消费；未命中行 fileUrl=null） */
  async fileUrls(ao: AssetFileUrlAO, userId: string): Promise<AssetFileUrlVO[]> {
    const found = await this.assetRepository.findByIds(userId, ao.assetIds);
    const byId = new Map<string, Asset>(found.map((doc) => [doc.asset_id, doc]));
    const ttl = this.storage.defaultTtlSeconds();
    return ao.assetIds.map((assetId) => {
      const doc = byId.get(assetId);
      return {
        assetId,
        fileUrl: doc !== undefined ? this.storage.signUrl(doc.storage_key, ttl) : null,
        expiresIn: ttl,
      } satisfies AssetFileUrlVO;
    });
  }

  /** #7 素材选择器（仅 ACTIVE，asset.select.assetList） */
  async selectList(ao: AssetSelectListAO, userId: string): Promise<AssetSelectVO[]> {
    const docs = await this.assetRepository.findSelectList(ao, userId);
    const ttl = this.storage.defaultTtlSeconds();
    return docs.map((doc) => {
      const vo = new AssetSelectVO(doc.asset_id, doc.asset_name);
      vo.assetType = doc.asset_type;
      vo.assetTypeLabel = getAssetTypeLabel(doc.asset_type);
      vo.thumbnailUrl = this.storage.signUrl(doc.storage_key, ttl);
      return vo;
    });
  }

  /* ---------- 内部 ---------- */

  private async switchStatus(assetId: string, userId: string, target: string): Promise<void> {
    const doc = await this.requireAsset(assetId, userId);
    if (doc.asset_status === target) {
      return; // 已处于目标状态，幂等返回（v1 对齐）
    }
    await this.assetRepository.updateStatus(assetId, userId, target, userId, new Date());
    this.publishChanged(assetId, target === AssetStatus.DISABLED ? OP_DISABLED : OP_ENABLED);
  }

  private async requireAsset(assetId: string, userId: string): Promise<Asset> {
    const doc = await this.assetRepository.findById(userId, assetId);
    if (doc === null) {
      throw new Error('素材不存在或无权访问: ' + assetId);
    }
    return doc;
  }

  private toListVO(doc: Asset): AssetListVO {
    const ttl = this.storage.defaultTtlSeconds();
    return {
      assetId: doc.asset_id,
      assetName: doc.asset_name,
      thumbnailUrl: this.storage.signUrl(doc.storage_key, ttl),
      category: doc.category ?? null,
      assetType: doc.asset_type,
      assetTypeLabel: getAssetTypeLabel(doc.asset_type),
      assetStatus: doc.asset_status,
      assetStatusLabel: getAssetStatusLabel(doc.asset_status),
      refCount: doc.ref_count,
      fileSize: doc.file_size,
      updatedTime: doc.updated_time ?? null,
      createdBy: doc.created_by ?? null,
      operList: this.operResolver.resolve(doc.asset_status, doc.ref_count),
    } satisfies AssetListVO;
  }

  private buildUploadVO(
    doc: Pick<Asset, 'asset_id' | 'storage_key' | 'width' | 'height' | 'file_hash'>,
    duplicated: boolean,
  ): AssetUploadVO {
    const url = this.storage.signUrl(doc.storage_key, this.storage.defaultTtlSeconds());
    return {
      assetId: doc.asset_id,
      assetUrl: url,
      thumbnailUrl: url,
      width: doc.width ?? null,
      height: doc.height ?? null,
      fileHash: doc.file_hash,
      duplicated,
    } satisfies AssetUploadVO;
  }

  private publishChanged(assetId: string, op: string): void {
    this.eventEmitter.emit(ASSET_ASSET_CHANGED, { assetId, op });
  }
}

/* ===================================================================== */
/* BrandKitService —— 品牌规范（S-01，dl_brand_kit） */
/* ===================================================================== */

@Injectable()
export class BrandKitService {
  constructor(
    private readonly brandKitRepository: BrandKitRepository,
    private readonly assetRepository: AssetRepository,
    private readonly deckBrandKitRefRepository: DeckBrandKitRefRepository,
    private readonly storage: AssetStorageService,
    private readonly eventEmitter: EventEmitter2,
    private readonly operResolver: BrandKitOperResolver,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** #8 规范分页（keyword like；默认规范置顶） */
  async listPage(ao: BrandKitListAO, userId: string): Promise<PageResult<BrandKitListVO>> {
    const { records, total } = await this.brandKitRepository.findPage(ao, userId);
    return PageResult.of(records.map((doc) => this.toListVO(doc)), total, ao.pageNum, ao.pageSize);
  }

  /** #9 规范保存（brandKitId 空=新建；logoAssetId 启用态校验 INV-16；logo 变更联动 refCount） */
  async save(ao: BrandKitSaveAO, userId: string): Promise<BrandKitSaveVO> {
    let created: boolean;
    let brandKitId: string;
    let existingLogoAssetId: string | null = null;
    if (notBlank(ao.brandKitId)) {
      const doc = await this.requireKit(ao.brandKitId, userId);
      existingLogoAssetId = doc.logo_asset_id ?? null;
      created = false;
      brandKitId = ao.brandKitId;
    } else {
      created = true;
      brandKitId = nextId();
    }

    const newLogoAssetId = notBlank(ao.logoAssetId) ? ao.logoAssetId : null;
    if (newLogoAssetId !== null) {
      await this.assertLogoUsable(newLogoAssetId, userId);
    }

    const now = new Date();
    const colors = { primary: ao.colors.primary, assistants: ao.colors.assistants ?? [] };
    const fonts =
      ao.fonts === undefined || ao.fonts === null
        ? null
        : { title: ao.fonts.title ?? null, body: ao.fonts.body ?? null };

    // 多文档编排（kit 写 + logo ref_count 联动）用事务承载（node-specs 20 §3）
    await this.runInTransaction(async (session) => {
      if (created) {
        const doc: BrandKit = {
          brand_kit_id: brandKitId,
          kit_name: ao.kitName,
          colors,
          fonts,
          logo_asset_id: newLogoAssetId,
          is_default: YesNo.NO,
          user_id: userId,
          data_version: 0,
          delete_sign: 0,
          created_by: userId,
          created_name: null,
          created_time: now,
          updated_by: userId,
          updated_name: null,
          updated_time: now,
        };
        await this.brandKitRepository.insert(doc, session);
      } else {
        await this.brandKitRepository.update(
          brandKitId,
          userId,
          {
            kit_name: ao.kitName,
            colors,
            fonts,
            logo_asset_id: newLogoAssetId,
            updated_by: userId,
            updated_time: now,
          },
          session,
        );
      }
      await this.adjustLogoRefCount(userId, existingLogoAssetId, newLogoAssetId, session);
    });
    this.publishChanged(brandKitId, created ? OP_CREATED : OP_UPDATED);
    return { brandKitId } satisfies BrandKitSaveVO;
  }

  /** #10 规范删除（非默认且未被 deck.default_brand_kit_id 引用；logo 解绑联动 refCount） */
  async delete(ao: BrandKitIdAO, userId: string): Promise<void> {
    const doc = await this.requireKit(ao.brandKitId, userId);
    if (doc.is_default === YesNo.YES) {
      throw new BizException(BRANDKIT_IS_DEFAULT, '默认规范不可删除，请先切换默认（INV-17）');
    }
    if ((await this.deckBrandKitRefRepository.countDeckReference(ao.brandKitId, userId)) > 0) {
      // 错误码缺口：BIZ_BRANDKIT_IN_USE 未入池，复用 ASSET_IN_USE（域内「被引用不可删」语义，v1 同）
      throw new BizException(ASSET_IN_USE, '品牌规范已被创作物引用，不可删除');
    }
    const logoAssetId = doc.logo_asset_id ?? null;
    await this.runInTransaction(async (session) => {
      await this.brandKitRepository.softDelete(ao.brandKitId, userId, userId, session);
      await this.adjustLogoRefCount(userId, logoAssetId, null, session);
    });
    this.publishChanged(ao.brandKitId, OP_DELETED);
  }

  /** #11 设默认（INV-17：单事务内旧默认置 0 + 新默认置 1；幂等） */
  async setDefault(ao: BrandKitIdAO, userId: string): Promise<void> {
    const doc = await this.requireKit(ao.brandKitId, userId);
    if (doc.is_default === YesNo.YES) {
      return; // 已是默认，幂等返回
    }
    await this.runInTransaction(async (session) => {
      await this.brandKitRepository.clearDefault(userId, userId, session);
      await this.brandKitRepository.setDefault(ao.brandKitId, userId, userId, session);
    });
    this.publishChanged(ao.brandKitId, OP_UPDATED);
  }

  /**
   * #20 OHS：品牌规范读取（HTTP 端点强制会话属主——api-assets §3.3「全部查询强制
   * user_id」+ NR-05；未命中 data=null，OHS 读未命中不视为业务错误）。
   */
  async providerGet(
    ao: BrandKitProviderGetAO,
    userId: string,
  ): Promise<BrandKitProviderGetVO | null> {
    return this.getByOwner(ao.brandKitId, userId);
  }

  /** #12 规范选择器（keyword like；默认规范置顶） */
  async selectList(ao: BrandKitSelectListAO, userId: string): Promise<BrandKitSelectVO[]> {
    const docs = await this.brandKitRepository.findSelectList(ao, userId);
    return docs.map((doc) => {
      const vo = new BrandKitSelectVO(doc.brand_kit_id, doc.kit_name);
      vo.isDefault = doc.is_default;
      return vo;
    });
  }

  /* ---------- 内部 ---------- */

  private async getByOwner(
    brandKitId: string,
    userId: string,
  ): Promise<BrandKitProviderGetVO | null> {
    const doc = await this.brandKitRepository.findById(userId, brandKitId);
    if (doc === null) {
      return null;
    }
    let logoUrl: string | null = null;
    if (notBlank(doc.logo_asset_id)) {
      const logo = await this.assetRepository.findById(userId, doc.logo_asset_id);
      // logo 已停用/删除时不签发 URL（INV-16 的读侧弱化：生成侧跳过失效 logo）
      if (logo !== null && logo.asset_status === AssetStatus.ACTIVE) {
        logoUrl = this.storage.signUrl(logo.storage_key, this.storage.defaultTtlSeconds());
      }
    }
    return {
      brandKitId: doc.brand_kit_id,
      kitName: doc.kit_name,
      colors: toColorsVO(doc.colors),
      fonts: toFontsVO(doc.fonts),
      logoAssetId: doc.logo_asset_id ?? null,
      logoUrl,
      isDefault: doc.is_default,
    } satisfies BrandKitProviderGetVO;
  }

  /** INV-16：logo 素材必须存在、归属本人且启用态 */
  private async assertLogoUsable(logoAssetId: string, userId: string): Promise<void> {
    const logo = await this.assetRepository.findById(userId, logoAssetId);
    if (logo === null || logo.asset_status !== AssetStatus.ACTIVE) {
      throw new BizException(
        BRANDKIT_LOGO_INVALID,
        'logo 素材无效（不存在或非启用态，INV-16）',
      );
    }
  }

  /** logo 绑定变更联动素材引用计数（INV-18，事务内调用；未变化时无操作） */
  private async adjustLogoRefCount(
    userId: string,
    oldLogoAssetId: string | null,
    newLogoAssetId: string | null,
    session?: MongoSession,
  ): Promise<void> {
    if (oldLogoAssetId === newLogoAssetId) {
      return;
    }
    if (oldLogoAssetId !== null) {
      await this.assetRepository.adjustRefCounts(userId, [oldLogoAssetId], -1, userId, session);
    }
    if (newLogoAssetId !== null) {
      await this.assetRepository.adjustRefCounts(userId, [newLogoAssetId], 1, userId, session);
    }
  }

  private async requireKit(brandKitId: string, userId: string): Promise<BrandKit> {
    const doc = await this.brandKitRepository.findById(userId, brandKitId);
    if (doc === null) {
      throw new Error('品牌规范不存在或无权访问: ' + brandKitId);
    }
    return doc;
  }

  private toListVO(doc: BrandKit): BrandKitListVO {
    return {
      brandKitId: doc.brand_kit_id,
      kitName: doc.kit_name,
      colors: toColorsVO(doc.colors),
      fonts: toFontsVO(doc.fonts),
      logoAssetId: doc.logo_asset_id ?? null,
      isDefault: doc.is_default,
      updatedTime: doc.updated_time ?? null,
      createdBy: doc.created_by ?? null,
      operList: this.operResolver.resolve(doc.is_default),
    } satisfies BrandKitListVO;
  }

  /** 多文档事务封装（replica set session；提交后才返回发布事件，NR-07） */
  private async runInTransaction<T>(fn: (session: MongoSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  }

  private publishChanged(brandKitId: string, op: string): void {
    this.eventEmitter.emit(ASSET_BRANDKIT_CHANGED, { brandKitId, op });
  }
}

/* ===================================================================== */
/* PromptTemplateService —— 话术模板（S-02，dl_prompt_template） */
/* ===================================================================== */

@Injectable()
export class PromptTemplateService {
  constructor(
    private readonly templateRepository: PromptTemplateRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly operResolver: PromptTemplateOperResolver,
  ) {}

  /** #13 话术分页（keyword title/content 双 like） */
  async listPage(
    ao: PromptTemplateListAO,
    userId: string,
  ): Promise<PageResult<PromptTemplateListVO>> {
    const { records, total } = await this.templateRepository.findPage(ao, userId);
    return PageResult.of(records.map((doc) => this.toListVO(doc)), total, ao.pageNum, ao.pageSize);
  }

  /** #14 话术保存（占位符校验 INV-21；templateId 空=新建） */
  async save(ao: PromptTemplateSaveAO, userId: string): Promise<PromptTemplateSaveVO> {
    validatePlaceholders(ao.content);

    let created: boolean;
    let templateId: string;
    if (notBlank(ao.templateId)) {
      await this.requireTemplate(ao.templateId, userId);
      created = false;
      templateId = ao.templateId;
    } else {
      created = true;
      templateId = nextId();
    }
    const now = new Date();
    const patch = {
      title: ao.title,
      content: ao.content,
      category: notBlank(ao.category) ? ao.category : null,
      template_scene: ao.templateScene,
      updated_by: userId,
      updated_time: now,
    };
    if (created) {
      const doc: PromptTemplate = {
        template_id: templateId,
        title: patch.title,
        content: patch.content,
        category: patch.category,
        template_scene: patch.template_scene,
        use_count: 0,
        user_id: userId,
        data_version: 0,
        delete_sign: 0,
        created_by: userId,
        created_name: null,
        created_time: now,
        updated_by: userId,
        updated_name: null,
        updated_time: now,
      };
      await this.templateRepository.insert(doc);
    } else {
      await this.templateRepository.update(templateId, userId, patch);
    }
    this.publishChanged(templateId, created ? OP_CREATED : OP_UPDATED);
    return { templateId } satisfies PromptTemplateSaveVO;
  }

  /** #15 话术删除 */
  async delete(ao: PromptTemplateIdAO, userId: string): Promise<void> {
    await this.requireTemplate(ao.templateId, userId);
    await this.templateRepository.softDelete(ao.templateId, userId, userId);
    this.publishChanged(ao.templateId, OP_DELETED);
  }

  /** #17 使用计数 +1（指令引用后调用；仅计数不动审计时间，v1 setSql 对齐） */
  async touch(ao: PromptTemplateIdAO, userId: string): Promise<void> {
    const matched = await this.templateRepository.touchUseCount(ao.templateId, userId);
    if (matched === 0) {
      throw new Error('话术模板不存在或无权访问: ' + ao.templateId);
    }
    this.publishChanged(ao.templateId, OP_TOUCHED);
  }

  /** #16 话术选择器（templateScene eq / keyword like；useCount 降序） */
  async selectList(
    ao: PromptTemplateSelectListAO,
    userId: string,
  ): Promise<PromptTemplateSelectVO[]> {
    const docs = await this.templateRepository.findSelectList(ao, userId);
    return docs.map((doc) => {
      const vo = new PromptTemplateSelectVO(doc.template_id, doc.title);
      vo.templateScene = doc.template_scene;
      vo.templateSceneLabel = getTemplateSceneLabel(doc.template_scene);
      vo.useCount = doc.use_count;
      return vo;
    });
  }

  /* ---------- 内部 ---------- */

  private async requireTemplate(templateId: string, userId: string): Promise<PromptTemplate> {
    const doc = await this.templateRepository.findById(userId, templateId);
    if (doc === null) {
      throw new Error('话术模板不存在或无权访问: ' + templateId);
    }
    return doc;
  }

  private toListVO(doc: PromptTemplate): PromptTemplateListVO {
    return {
      templateId: doc.template_id,
      title: doc.title,
      content: doc.content,
      category: doc.category ?? null,
      templateScene: doc.template_scene,
      templateSceneLabel: getTemplateSceneLabel(doc.template_scene),
      useCount: doc.use_count,
      updatedTime: doc.updated_time ?? null,
      createdBy: doc.created_by ?? null,
      operList: this.operResolver.resolve(),
    } satisfies PromptTemplateListVO;
  }

  private publishChanged(templateId: string, op: string): void {
    this.eventEmitter.emit(ASSET_PROMPT_CHANGED, { templateId, op });
  }
}

/* ===================================================================== */
/* AssetDictService —— #18 枚举字典（assetType/assetStatus/templateScene） */
/* ===================================================================== */

@Injectable()
export class AssetDictService {
  private readonly registry: Map<string, SelectOption[]>;

  constructor() {
    this.registry = new Map<string, SelectOption[]>([
      [DICT_KEY_ASSET_TYPE, toOptions(Object.values(AssetType), getAssetTypeLabel)],
      [DICT_KEY_ASSET_STATUS, toOptions(Object.values(AssetStatus), getAssetStatusLabel)],
      [DICT_KEY_TEMPLATE_SCENE, toOptions(Object.values(TemplateScene), getTemplateSceneLabel)],
    ]);
  }

  /** 按 key 集合取字典（去重保序；未注册 key 返回空列表，v1 Registry 对齐） */
  batch(keys: string[]): Map<string, SelectOption[]> {
    const result = new Map<string, SelectOption[]>();
    for (const key of new Set(keys)) {
      result.set(key, this.registry.get(key) ?? []);
    }
    return result;
  }
}

/* ===================================================================== */
/* AssetDomainService —— 域间进程内直调（OHS/跨域契约，manifest §10） */
/* ===================================================================== */

@Injectable()
export class AssetDomainService {
  constructor(
    private readonly assetRepository: AssetRepository,
    private readonly brandKitRepository: BrandKitRepository,
    private readonly templateRepository: PromptTemplateRepository,
    private readonly storage: AssetStorageService,
    private readonly brandKitService: BrandKitService,
  ) {}

  /**
   * INV-18 引用计数原子更新（版本留档回调 / BrandKit logo 绑定解绑共用）：
   * refCount = GREATEST(refCount + delta, 0)，幂等重放安全由调用方保证
   * （版本留档只插入一次，回调每版本至多一次 +1）。空集合/0 增量无操作。
   */
  async adjustRefCounts(
    userId: string,
    assetIds: string[],
    delta: number,
    session?: ClientSession,
  ): Promise<void> {
    if (!notBlank(userId)) {
      throw new Error('引用计数回调缺少 userId（ADR-005 隔离字段）');
    }
    if (assetIds.length === 0 || delta === 0) {
      return;
    }
    await this.assetRepository.adjustRefCounts(userId, assetIds, delta, undefined, session);
  }

  /** BrandKit 名称冗余查询（deck 列表展示 defaultBrandKitName；未命中 ID 不在结果中） */
  async getBrandKitNames(userId: string, brandKitIds: string[]): Promise<Map<string, string>> {
    if (!notBlank(userId) || brandKitIds.length === 0) {
      return new Map<string, string>();
    }
    return this.brandKitRepository.findNamesByIds(userId, brandKitIds);
  }

  /**
   * OHS file-url 服务化（deliver 渲染/generation 注入/演示）：
   * 仅返回命中（属主内未删除）素材的签名项；未命中 ID 由消费方按缺失处理。
   */
  async signFileUrls(userId: string, assetIds: string[]): Promise<SignedFileUrl[]> {
    if (!notBlank(userId) || assetIds.length === 0) {
      return [];
    }
    const found = await this.assetRepository.findByIds(userId, assetIds);
    const ttl = this.storage.defaultTtlSeconds();
    const expiresAt = this.storage.expiresAtFor(ttl);
    return found.map((doc) => ({
      assetId: doc.asset_id,
      url: this.storage.signUrl(doc.storage_key, ttl),
      expiresAt,
    }));
  }

  /** OHS provider-get 服务化（generation 品牌注入；未命中返回 null） */
  async getBrandKit(brandKitId: string, userId: string): Promise<BrandKitProviderGetVO | null> {
    return this.brandKitService.providerGet({ brandKitId }, userId);
  }

  /**
   * 话术存在性轻校验（adjustment usedTemplateIds；api-adjustment §4.5）。
   * 校验失败抛普通 Error（错误码由消费方 adjustment 域映射为其 BIZ_ADJUST_*，
   * v1 同语义校验 scopeInvalid 抛在调用方域）。
   */
  async assertTemplatesExist(userId: string, templateIds: string[]): Promise<void> {
    const distinct = [...new Set(templateIds.filter((id) => notBlank(id)))];
    if (distinct.length === 0) {
      return;
    }
    const count = await this.templateRepository.countByIds(userId, distinct);
    if (count < distinct.length) {
      throw new Error('话术模板不存在或已删除');
    }
  }

  /**
   * OHS 素材简述查询（F04：generation/adjustment 快照注入素材上下文——
   * 模型仅凭内部 ID 无法理解引用，注入 assetId/名称/类型供生成与调整引用）。
   * 仅返回命中（属主内未删除）项。
   */
  async getAssetBriefs(
    userId: string,
    assetIds: string[],
  ): Promise<Array<{ assetId: string; assetName: string; assetType: string }>> {
    if (!notBlank(userId) || assetIds.length === 0) {
      return [];
    }
    const distinct = [...new Set(assetIds.filter((id) => notBlank(id)))];
    const found = await this.assetRepository.findByIds(userId, distinct);
    return found.map((doc) => ({
      assetId: doc.asset_id,
      assetName: doc.asset_name,
      assetType: doc.asset_type,
    }));
  }

}

/** 上传扩展名解析（v1 resolveExtension：末位点后小写；无扩展名返回空串） */
function resolveExtension(originalFilename: string | undefined): string {
  if (originalFilename === undefined) {
    return '';
  }
  const dot = originalFilename.lastIndexOf('.');
  if (dot < 0 || dot === originalFilename.length - 1) {
    return '';
  }
  return originalFilename.substring(dot + 1).toLowerCase();
}

/** INV-21：{名称} 语法校验（≤10 处，剔除合法占位符后不允许残留花括号） */
function validatePlaceholders(content: string): void {
  const matches = content.match(PROMPT_PLACEHOLDER_PATTERN);
  if (matches !== null && matches.length > PROMPT_MAX_PLACEHOLDER_COUNT) {
    throw new BizException(PROMPT_PLACEHOLDER_SYNTAX, '话术占位符最多10处（INV-21）');
  }
  const residual = content.replace(PROMPT_PLACEHOLDER_PATTERN, '');
  if (residual.includes('{') || residual.includes('}')) {
    throw new BizException(
      PROMPT_PLACEHOLDER_SYNTAX,
      '话术占位符语法错误，须为 {名称} 形式且不含嵌套/空名（INV-21）',
    );
  }
}

function toColorsVO(
  colors: BrandKit['colors'] | undefined | null,
): { primary: string; assistants: string[] } {
  if (colors === undefined || colors === null) {
    return { primary: '', assistants: [] };
  }
  return { primary: colors.primary, assistants: colors.assistants ?? [] };
}

function toFontsVO(
  fonts: BrandKit['fonts'] | undefined | null,
): { title: string | null; body: string | null } {
  if (fonts === undefined || fonts === null) {
    return { title: null, body: null };
  }
  return { title: fonts.title ?? null, body: fonts.body ?? null };
}

function toOptions<T extends string>(
  codes: readonly T[],
  labelFn: (code: string) => string,
): SelectOption[] {
  return codes.map((code) => SelectOption.of(code, labelFn(code)));
}
