/**
 * asset 域仓储层 —— 三聚合根仓储 + 跨域只读引用计数（api-assets.md §4.5/§5.2）。
 *
 * 查询安全（NR-02/NR03 红线）：
 * - 全部 filter/sort/projection 键为代码级白名单显式映射（见各 findPage* 方法头注释
 *   的「AO 键 → 查询键」映射表），请求体键名永不直接成为查询键
 * - keyword 经 escapeRegex 转义后仅作 $regex **值**（禁动态拼接运算符）
 * - ref_count GREATEST(0) 语义用聚合管道 update（服务端静态构造，$max/$add 常量结构），
 *   delta 为服务端内部 int 参数（非用户输入），对齐 v1 setSql 注释口径
 * - userId 隔离字段由 Service 注入，仓储不信任调用方之外来源（NR-05）
 * - 查询统一 .lean()（POJO），VO 逐字段组装——_id 即使在场也不进 VO（NR-08）
 * - 文档字段沿契约 §5.3 snake_case（=v1 列平移，与其他域 schema 同口径）
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, UpdateQuery } from 'mongoose';
import { Asset } from './schemas/asset.schema';
import { BrandKit } from './schemas/brand-kit.schema';
import { PromptTemplate } from './schemas/prompt-template.schema';
import {
  AssetListAO,
  AssetSelectListAO,
  BrandKitListAO,
  BrandKitSelectListAO,
  PromptTemplateListAO,
  PromptTemplateSelectListAO,
} from './asset.dto';

/** ClientSession 类型（mongoose 经内部 mongodb 命名空间暴露；避免直接依赖 mongodb 包） */
export type MongoSession = Awaited<ReturnType<Connection['startSession']>>;

/** 正则元字符转义（keyword 仅作 $regex 值使用，防注入） */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function notBlank(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim().length > 0;
}

/** E11000 重复键判定（鸭子类型判别，避免依赖 mongodb 包的直接导入） */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/* ===================================================================== */
/* AssetRepository — dl_asset（hash 查重/插入/引用计数原子更新，api-assets §4.5） */
/* ===================================================================== */

@Injectable()
export class AssetRepository {
  constructor(@InjectModel(Asset.name) private readonly assetModel: Model<Asset>) {}

  /**
   * 按 (user_id, file_hash) 查素材，含逻辑删除行（INV-20 查重需要：
   * 唯一索引 uk_user_hash 含已删除行，重传同 hash 走复活而非撞唯一键；
   * v1 selectByHashIncludeDeleted 对齐——本查询刻意不带 delete_sign 过滤）。
   */
  async findByHashIncludeDeleted(userId: string, fileHash: string): Promise<Asset | null> {
    return this.assetModel.findOne({ user_id: userId, file_hash: fileHash }).lean<Asset>().exec();
  }

  /** 按业务主键取未删除行（属主隔离） */
  async findById(userId: string, assetId: string): Promise<Asset | null> {
    return this.assetModel
      .findOne({ asset_id: assetId, user_id: userId, delete_sign: 0 })
      .lean<Asset>()
      .exec();
  }

  /** 批量取未删除行（file-url 签发；v1 fileUrls 查询对齐：不筛状态只筛属主+未删除） */
  async findByIds(userId: string, assetIds: string[]): Promise<Asset[]> {
    return this.assetModel
      .find({ user_id: userId, asset_id: { $in: assetIds }, delete_sign: 0 })
      .lean<Asset[]>()
      .exec();
  }

  /**
   * 素材分页 —— AO 键 → 查询键白名单映射（api-assets §4.4 asset/list）：
   *   keyword      → asset_name（$regex 转义值，大小写不敏感，like 语义）
   *   category     → category（eq）
   *   assetType    → asset_type（eq）
   *   assetStatus  → asset_status（eq）
   *   （userId 服务端注入恒在 filter；排序固定 updated_time desc，非入参可控）
   */
  async findPage(
    ao: AssetListAO,
    userId: string,
  ): Promise<{ records: Asset[]; total: number }> {
    const filter: FilterQuery<Asset> = { user_id: userId, delete_sign: 0 };
    if (notBlank(ao.keyword)) {
      filter.asset_name = { $regex: escapeRegex(ao.keyword), $options: 'i' };
    }
    if (notBlank(ao.category)) {
      filter.category = ao.category;
    }
    if (notBlank(ao.assetType)) {
      filter.asset_type = ao.assetType;
    }
    if (notBlank(ao.assetStatus)) {
      filter.asset_status = ao.assetStatus;
    }
    const [records, total] = await Promise.all([
      this.assetModel
        .find(filter)
        .sort({ updated_time: -1 })
        .skip((ao.pageNum - 1) * ao.pageSize)
        .limit(ao.pageSize)
        .lean<Asset[]>()
        .exec(),
      this.assetModel.countDocuments(filter).exec(),
    ]);
    return { records, total };
  }

  /**
   * 素材选择池 —— 白名单映射（asset.select.assetList：仅 ACTIVE 可被引用）：
   *   assetType → asset_type（eq）；keyword → asset_name（$regex 值）
   * 排序固定 created_time desc，limit 200。
   */
  async findSelectList(ao: AssetSelectListAO, userId: string): Promise<Asset[]> {
    const filter: FilterQuery<Asset> = {
      user_id: userId,
      delete_sign: 0,
      asset_status: 'ACTIVE',
    };
    if (notBlank(ao.assetType)) {
      filter.asset_type = ao.assetType;
    }
    if (notBlank(ao.keyword)) {
      filter.asset_name = { $regex: escapeRegex(ao.keyword), $options: 'i' };
    }
    return this.assetModel
      .find(filter)
      .sort({ created_time: -1 })
      .limit(200)
      .lean<Asset[]>()
      .exec();
  }

  /** 插入（新素材）；并发同 hash 竞态由唯一索引兜底（调用方捕获 E11000 回落查重） */
  async insert(doc: Asset, session?: MongoSession): Promise<void> {
    await this.assetModel.create([doc], { session });
  }

  /**
   * 复活逻辑删除行（重传同 hash 复用唯一键行，v1 AssetMapper.revive 对齐：
   * 不带 delete_sign 过滤，自定义覆写全部业务字段并重置 ref_count=0/data_version=0）。
   */
  async revive(
    assetId: string,
    userId: string,
    patch: {
      asset_name: string;
      category: string | null;
      asset_type: string;
      storage_key: string;
      width: number | null;
      height: number | null;
      file_size: number;
      updated_by: string;
      updated_time: Date;
    },
  ): Promise<void> {
    await this.assetModel
      .updateOne(
        { asset_id: assetId, user_id: userId },
        {
          $set: {
            delete_sign: 0,
            asset_status: 'ACTIVE',
            asset_name: patch.asset_name,
            category: patch.category,
            asset_type: patch.asset_type,
            storage_key: patch.storage_key,
            width: patch.width,
            height: patch.height,
            file_size: patch.file_size,
            ref_count: 0,
            data_version: 0,
            updated_by: patch.updated_by,
            updated_time: patch.updated_time,
          },
        },
      )
      .exec();
  }

  /** 元信息编辑（名称/分类；分类可清空 → $set null 覆写，v1 FieldStrategy.ALWAYS 对齐） */
  async updateMeta(
    assetId: string,
    userId: string,
    patch: {
      asset_name: string;
      category: string | null;
      updated_by: string;
      updated_time: Date;
    },
  ): Promise<number> {
    const result = await this.assetModel
      .updateOne(
        { asset_id: assetId, user_id: userId, delete_sign: 0 },
        {
          $set: {
            asset_name: patch.asset_name,
            category: patch.category,
            updated_by: patch.updated_by,
            updated_time: patch.updated_time,
          },
          $inc: { data_version: 1 },
        },
      )
      .exec();
    return result.modifiedCount;
  }

  /** 启停切换（$set asset_status + 乐观锁 $inc + 审计） */
  async updateStatus(
    assetId: string,
    userId: string,
    assetStatus: string,
    updatedBy: string,
    updatedTime: Date,
  ): Promise<number> {
    const result = await this.assetModel
      .updateOne(
        { asset_id: assetId, user_id: userId, delete_sign: 0 },
        {
          $set: { asset_status: assetStatus, updated_by: updatedBy, updated_time: updatedTime },
          $inc: { data_version: 1 },
        },
      )
      .exec();
    return result.modifiedCount;
  }

  /** 软删除（ref_count=0 前置守卫在 Service） */
  async softDelete(
    assetId: string,
    userId: string,
    updatedBy: string,
    updatedTime?: Date,
  ): Promise<void> {
    await this.assetModel
      .updateOne(
        { asset_id: assetId, user_id: userId, delete_sign: 0 },
        {
          $set: {
            delete_sign: 1,
            updated_by: updatedBy,
            updated_time: updatedTime ?? new Date(),
          },
          $inc: { data_version: 1 },
        },
      )
      .exec();
  }

  /**
   * 引用计数原子增减 —— v1 setSql `ref_count = GREATEST(ref_count + delta, 0)` 等价：
   * 聚合管道 update（MongoDB 4.2+）以 $max/$add 常量结构实现下限 0（INV-18）。
   * 管道为服务端静态构造（delta 为内部 int 参数），NR-03 合规。
   */
  async adjustRefCounts(
    userId: string,
    assetIds: string[],
    delta: number,
    updatedBy?: string,
    session?: MongoSession,
  ): Promise<void> {
    const setStage: Record<string, unknown> = {
      ref_count: { $max: [{ $add: ['$ref_count', delta] }, 0] },
      updated_time: new Date(),
    };
    if (updatedBy !== undefined) {
      setStage.updated_by = updatedBy;
    }
    // 管道 update 在 mongoose 类型上以 UpdateQuery 表达，此处显式收窄转换（非 any）
    const pipeline = [{ $set: setStage }] as unknown as UpdateQuery<Asset>;
    await this.assetModel
      .updateMany({ user_id: userId, asset_id: { $in: assetIds } }, pipeline, { session })
      .exec();
  }
}

/* ===================================================================== */
/* BrandKitRepository — dl_brand_kit（默认切换多文档事务，api-assets §5.2） */
/* ===================================================================== */

@Injectable()
export class BrandKitRepository {
  constructor(@InjectModel(BrandKit.name) private readonly brandKitModel: Model<BrandKit>) {}

  /** 按业务主键取未删除行（属主隔离） */
  async findById(userId: string, brandKitId: string): Promise<BrandKit | null> {
    return this.brandKitModel
      .findOne({ brand_kit_id: brandKitId, user_id: userId, delete_sign: 0 })
      .lean<BrandKit>()
      .exec();
  }

  /** 名称冗余查询（deck 列表展示；未命中 ID 不出现在结果） */
  async findNamesByIds(userId: string, brandKitIds: string[]): Promise<Map<string, string>> {
    const kits = await this.brandKitModel
      .find(
        { user_id: userId, brand_kit_id: { $in: brandKitIds }, delete_sign: 0 },
        { kit_name: 1 },
      )
      .lean<BrandKit[]>()
      .exec();
    const result = new Map<string, string>();
    for (const kit of kits) {
      result.set(kit.brand_kit_id, kit.kit_name);
    }
    return result;
  }

  /**
   * 规范分页 —— 白名单映射：keyword → kit_name（$regex 值）；
   * 排序固定 is_default desc → updated_time desc（默认规范置顶，v1 对齐）。
   */
  async findPage(
    ao: BrandKitListAO,
    userId: string,
  ): Promise<{ records: BrandKit[]; total: number }> {
    const filter: FilterQuery<BrandKit> = { user_id: userId, delete_sign: 0 };
    if (notBlank(ao.keyword)) {
      filter.kit_name = { $regex: escapeRegex(ao.keyword), $options: 'i' };
    }
    const [records, total] = await Promise.all([
      this.brandKitModel
        .find(filter)
        .sort({ is_default: -1, updated_time: -1 })
        .skip((ao.pageNum - 1) * ao.pageSize)
        .limit(ao.pageSize)
        .lean<BrandKit[]>()
        .exec(),
      this.brandKitModel.countDocuments(filter).exec(),
    ]);
    return { records, total };
  }

  /** 规范选择池（keyword → kit_name；排序 is_default desc → updated_time desc，limit 200） */
  async findSelectList(ao: BrandKitSelectListAO, userId: string): Promise<BrandKit[]> {
    const filter: FilterQuery<BrandKit> = { user_id: userId, delete_sign: 0 };
    if (notBlank(ao.keyword)) {
      filter.kit_name = { $regex: escapeRegex(ao.keyword), $options: 'i' };
    }
    return this.brandKitModel
      .find(filter)
      .sort({ is_default: -1, updated_time: -1 })
      .limit(200)
      .lean<BrandKit[]>()
      .exec();
  }

  /** 插入（is_default=0 由 Service 组装） */
  async insert(doc: BrandKit, session?: MongoSession): Promise<void> {
    await this.brandKitModel.create([doc], { session });
  }

  /** 编辑（$set 全量业务字段 + 乐观锁 $inc；fonts/logo_asset_id 可清空 → null 覆写） */
  async update(
    brandKitId: string,
    userId: string,
    patch: {
      kit_name: string;
      colors: BrandKit['colors'];
      fonts: BrandKit['fonts'] | null;
      logo_asset_id: string | null;
      updated_by: string;
      updated_time: Date;
    },
    session?: MongoSession,
  ): Promise<number> {
    const result = await this.brandKitModel
      .updateOne(
        { brand_kit_id: brandKitId, user_id: userId, delete_sign: 0 },
        {
          $set: {
            kit_name: patch.kit_name,
            colors: patch.colors,
            fonts: patch.fonts,
            logo_asset_id: patch.logo_asset_id,
            updated_by: patch.updated_by,
            updated_time: patch.updated_time,
          },
          $inc: { data_version: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /** 旧默认置 0（INV-17 事务第一步；userId 服务端注入） */
  async clearDefault(userId: string, updatedBy: string, session?: MongoSession): Promise<void> {
    await this.brandKitModel
      .updateMany(
        { user_id: userId, is_default: 1, delete_sign: 0 },
        {
          $set: { is_default: 0, updated_by: updatedBy, updated_time: new Date() },
          $inc: { data_version: 1 },
        },
        { session },
      )
      .exec();
  }

  /** 新默认置 1（INV-17 事务第二步） */
  async setDefault(
    brandKitId: string,
    userId: string,
    updatedBy: string,
    session?: MongoSession,
  ): Promise<number> {
    const result = await this.brandKitModel
      .updateOne(
        { brand_kit_id: brandKitId, user_id: userId, delete_sign: 0 },
        {
          $set: { is_default: 1, updated_by: updatedBy, updated_time: new Date() },
          $inc: { data_version: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /** 软删除 */
  async softDelete(
    brandKitId: string,
    userId: string,
    updatedBy: string,
    session?: MongoSession,
  ): Promise<void> {
    await this.brandKitModel
      .updateOne(
        { brand_kit_id: brandKitId, user_id: userId, delete_sign: 0 },
        {
          $set: { delete_sign: 1, updated_by: updatedBy, updated_time: new Date() },
          $inc: { data_version: 1 },
        },
        { session },
      )
      .exec();
  }
}

/* ===================================================================== */
/* PromptTemplateRepository — dl_prompt_template */
/* ===================================================================== */

@Injectable()
export class PromptTemplateRepository {
  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly templateModel: Model<PromptTemplate>,
  ) {}

  /** 按业务主键取未删除行（属主隔离） */
  async findById(userId: string, templateId: string): Promise<PromptTemplate | null> {
    return this.templateModel
      .findOne({ template_id: templateId, user_id: userId, delete_sign: 0 })
      .lean<PromptTemplate>()
      .exec();
  }

  /**
   * 话术分页 —— 白名单映射（api-assets §4.4 prompt/list）：
   *   keyword → title **或** content（$regex 值，$or 两键白名单）
   *   category → category（eq）；templateScene → template_scene（eq）
   * 排序固定 updated_time desc。
   */
  async findPage(
    ao: PromptTemplateListAO,
    userId: string,
  ): Promise<{ records: PromptTemplate[]; total: number }> {
    const filter: FilterQuery<PromptTemplate> = { user_id: userId, delete_sign: 0 };
    if (notBlank(ao.category)) {
      filter.category = ao.category;
    }
    if (notBlank(ao.templateScene)) {
      filter.template_scene = ao.templateScene;
    }
    if (notBlank(ao.keyword)) {
      const pattern = { $regex: escapeRegex(ao.keyword), $options: 'i' };
      filter.$or = [{ title: pattern }, { content: pattern }];
    }
    const [records, total] = await Promise.all([
      this.templateModel
        .find(filter)
        .sort({ updated_time: -1 })
        .skip((ao.pageNum - 1) * ao.pageSize)
        .limit(ao.pageSize)
        .lean<PromptTemplate[]>()
        .exec(),
      this.templateModel.countDocuments(filter).exec(),
    ]);
    return { records, total };
  }

  /**
   * 话术选择池 —— 白名单映射：keyword → title（$regex 值）、templateScene eq；
   * 排序固定 use_count desc，limit 200。
   */
  async findSelectList(
    ao: PromptTemplateSelectListAO,
    userId: string,
  ): Promise<PromptTemplate[]> {
    const filter: FilterQuery<PromptTemplate> = { user_id: userId, delete_sign: 0 };
    if (notBlank(ao.templateScene)) {
      filter.template_scene = ao.templateScene;
    }
    if (notBlank(ao.keyword)) {
      filter.title = { $regex: escapeRegex(ao.keyword), $options: 'i' };
    }
    return this.templateModel
      .find(filter)
      .sort({ use_count: -1 })
      .limit(200)
      .lean<PromptTemplate[]>()
      .exec();
  }

  /** 未删除属主内按 id 集合计数（assertTemplatesExist 轻校验） */
  async countByIds(userId: string, templateIds: string[]): Promise<number> {
    return this.templateModel
      .countDocuments({ user_id: userId, template_id: { $in: templateIds }, delete_sign: 0 })
      .exec();
  }

  /** 插入 */
  async insert(doc: PromptTemplate, session?: MongoSession): Promise<void> {
    await this.templateModel.create([doc], { session });
  }

  /** 编辑（$set 全量业务字段 + 乐观锁 $inc；category 可清空） */
  async update(
    templateId: string,
    userId: string,
    patch: {
      title: string;
      content: string;
      category: string | null;
      template_scene: string;
      updated_by: string;
      updated_time: Date;
    },
    session?: MongoSession,
  ): Promise<number> {
    const result = await this.templateModel
      .updateOne(
        { template_id: templateId, user_id: userId, delete_sign: 0 },
        {
          $set: {
            title: patch.title,
            content: patch.content,
            category: patch.category,
            template_scene: patch.template_scene,
            updated_by: patch.updated_by,
            updated_time: patch.updated_time,
          },
          $inc: { data_version: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /** 软删除 */
  async softDelete(
    templateId: string,
    userId: string,
    updatedBy: string,
    session?: MongoSession,
  ): Promise<void> {
    await this.templateModel
      .updateOne(
        { template_id: templateId, user_id: userId, delete_sign: 0 },
        {
          $set: { delete_sign: 1, updated_by: updatedBy, updated_time: new Date() },
          $inc: { data_version: 1 },
        },
        { session },
      )
      .exec();
  }

  /**
   * 使用计数原子 +1（touch；v1 setSql `use_count = use_count + 1` 对齐——
   * 仅计数不动 updated_time/审计）。返回 matched 数（0=不存在或无权）。
   */
  async touchUseCount(templateId: string, userId: string): Promise<number> {
    const result = await this.templateModel
      .updateOne(
        { template_id: templateId, user_id: userId, delete_sign: 0 },
        { $inc: { use_count: 1, data_version: 1 } },
      )
      .exec();
    return result.matchedCount;
  }
}

/* ===================================================================== */
/* DeckBrandKitRefRepository —— 跨域只读 dl_deck（v1 DeckBrandKitRefMapper 对齐）
 *
 * manifest asset 节「依赖其他域：无出站」指无进程内服务出站调用；品牌规范删除守卫
 * （被 dl_deck.default_brand_kit_id 引用拒绝）需要该只读计数——与 channel 域跨模块
 * 只读同一模式：直查 collection（只读投影，不改写、不建索引）。
 * filter 键为代码级常量（default_brand_kit_id/user_id/delete_sign），值参数化（NR-02）。
 * 文档字段与 deck 域 schema 一致：契约 §5.3 字段名原样平移（snake_case）。
 * ===================================================================== */

@Injectable()
export class DeckBrandKitRefRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** 统计某用户下将指定规范设为默认的创作物数量（未删除） */
  async countDeckReference(brandKitId: string, userId: string): Promise<number> {
    return this.connection
      .collection('dl_deck')
      .countDocuments({ default_brand_kit_id: brandKitId, user_id: userId, delete_sign: 0 });
  }
}
