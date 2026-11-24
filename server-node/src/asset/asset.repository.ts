/**
 * asset 域仓储层 —— 三聚合根仓储 + 跨域只读引用计数（api-assets.md §4.5/§5.2；ADR-016 TypeORM）。
 *
 * 查询安全（NR-02/NR03 红线）：
 * - 全部 filter/sort/projection 键为代码级白名单显式映射，请求体键名永不直接成为查询键
 * - keyword 经 escapeLike 转义后仅作 ILIKE 绑定值（子串匹配，大小写不敏感）
 * - ref_count GREATEST(0) 语义用静态 SQL（delta 为服务端内部 int 参数，非用户输入）
 * - userId 隔离字段由 Service 注入（NR-05）
 * - 字段沿契约 §5.3 snake_case（=v1 列平移）；file_size bigint → number 归一
 */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { Asset } from './schemas/asset.schema';
import { BrandKit } from './schemas/brand-kit.schema';
import { PromptTemplate } from './schemas/prompt-template.schema';
import { escapeLike, inClause, toNumberOrNull, type TxSession } from '../common/persistence';
import {
  AssetListAO,
  AssetSelectListAO,
  BrandKitListAO,
  BrandKitSelectListAO,
  PromptTemplateListAO,
  PromptTemplateSelectListAO,
} from './asset.dto';

/** 事务句柄别名（保留旧名以兼容 asset.service import；= TypeORM EntityManager） */
export type MongoSession = TxSession;

/** PG 重复键判定（re-export 自公共工具，兼容旧 import 路径） */
export { isDuplicateKeyError } from '../common/persistence';

function notBlank(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim().length > 0;
}

/* ===================================================================== */
/* AssetRepository — dl_asset（hash 查重/插入/引用计数原子更新，api-assets §4.5） */
/* ===================================================================== */

@Injectable()
export class AssetRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  private normalize(asset: Asset | null): Asset | null {
    if (asset != null) {
      asset.file_size = toNumberOrNull(asset.file_size) as number;
    }
    return asset;
  }

  /**
   * 按 (user_id, file_hash) 查素材，含逻辑删除行（INV-20 查重需要：
   * 唯一索引 uk_user_hash 含已删除行，重传同 hash 走复活而非撞唯一键）。
   */
  async findByHashIncludeDeleted(userId: string, fileHash: string): Promise<Asset | null> {
    return this.normalize(
      await this.dataSource.getRepository(Asset).findOne({ where: { user_id: userId, file_hash: fileHash } }),
    );
  }

  /** 按业务主键取未删除行（属主隔离） */
  async findById(userId: string, assetId: string): Promise<Asset | null> {
    return this.normalize(
      await this.dataSource.getRepository(Asset).findOne({ where: { asset_id: assetId, user_id: userId, delete_sign: 0 } }),
    );
  }

  /** 批量取未删除行（file-url 签发；不筛状态只筛属主+未删除） */
  async findByIds(userId: string, assetIds: string[]): Promise<Asset[]> {
    if (assetIds.length === 0) {
      return [];
    }
    const rows = await this.dataSource
      .getRepository(Asset)
      .createQueryBuilder('a')
      .where('a.user_id = :userId', { userId })
      .andWhere('a.delete_sign = 0')
      .andWhere('a.asset_id IN (:...ids)', { ids: assetIds })
      .getMany();
    rows.forEach((r) => this.normalize(r));
    return rows;
  }

  /**
   * 素材分页 —— AO 键 → 查询键白名单映射：
   *   keyword→asset_name ILIKE；category/assetType/assetStatus eq；
   *   排序固定 updated_time desc。
   */
  async findPage(ao: AssetListAO, userId: string): Promise<{ records: Asset[]; total: number }> {
    const repo = this.dataSource.getRepository(Asset);
    const apply = (qb: SelectQueryBuilder<Asset>): SelectQueryBuilder<Asset> => {
      qb.where('a.user_id = :userId', { userId }).andWhere('a.delete_sign = 0');
      if (notBlank(ao.keyword)) {
        qb.andWhere('a.asset_name ILIKE :kw', { kw: `%${escapeLike(ao.keyword)}%` });
      }
      if (notBlank(ao.category)) {
        qb.andWhere('a.category = :category', { category: ao.category });
      }
      if (notBlank(ao.assetType)) {
        qb.andWhere('a.asset_type = :assetType', { assetType: ao.assetType });
      }
      if (notBlank(ao.assetStatus)) {
        qb.andWhere('a.asset_status = :assetStatus', { assetStatus: ao.assetStatus });
      }
      return qb;
    };
    const [records, total] = await Promise.all([
      apply(repo.createQueryBuilder('a')).orderBy('a.updated_time', 'DESC').skip((ao.pageNum - 1) * ao.pageSize).take(ao.pageSize).getMany(),
      apply(repo.createQueryBuilder('a')).getCount(),
    ]);
    records.forEach((r) => this.normalize(r));
    return { records, total };
  }

  /**
   * 素材选择池 —— 仅 ACTIVE 可被引用；assetType eq；keyword ILIKE；
   * 排序固定 created_time desc，limit 200。
   */
  async findSelectList(ao: AssetSelectListAO, userId: string): Promise<Asset[]> {
    const qb = this.dataSource
      .getRepository(Asset)
      .createQueryBuilder('a')
      .where('a.user_id = :userId', { userId })
      .andWhere('a.delete_sign = 0')
      .andWhere('a.asset_status = :active', { active: 'ACTIVE' });
    if (notBlank(ao.assetType)) {
      qb.andWhere('a.asset_type = :assetType', { assetType: ao.assetType });
    }
    if (notBlank(ao.keyword)) {
      qb.andWhere('a.asset_name ILIKE :kw', { kw: `%${escapeLike(ao.keyword)}%` });
    }
    const rows = await qb.orderBy('a.created_time', 'DESC').take(200).getMany();
    rows.forEach((r) => this.normalize(r));
    return rows;
  }

  /** 插入（新素材）；并发同 hash 竞态由唯一索引兜底（调用方捕获 23505 回落查重） */
  async insert(doc: Asset, session?: TxSession): Promise<void> {
    await this.manager(session).getRepository(Asset).insert(doc);
  }

  /**
   * 复活逻辑删除行（重传同 hash 复用唯一键行，v1 revive 对齐：
   * 不带 delete_sign 过滤，覆写全部业务字段并重置 ref_count=0/data_version=0）。
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
    await this.dataSource
      .getRepository(Asset)
      .createQueryBuilder()
      .update(Asset)
      .set({
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
      })
      .where('asset_id = :assetId', { assetId })
      .andWhere('user_id = :userId', { userId })
      .execute();
  }

  /** 元信息编辑（名称/分类；分类可清空 → null 覆写） */
  async updateMeta(
    assetId: string,
    userId: string,
    patch: { asset_name: string; category: string | null; updated_by: string; updated_time: Date },
  ): Promise<number> {
    const result = await this.dataSource
      .getRepository(Asset)
      .createQueryBuilder()
      .update(Asset)
      .set({
        asset_name: patch.asset_name,
        category: patch.category,
        updated_by: patch.updated_by,
        updated_time: patch.updated_time,
        data_version: () => 'data_version + 1',
      })
      .where('asset_id = :assetId', { assetId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
    return result.affected ?? 0;
  }

  /** 启停切换（SET asset_status + 乐观锁 +1 + 审计） */
  async updateStatus(
    assetId: string,
    userId: string,
    assetStatus: string,
    updatedBy: string,
    updatedTime: Date,
  ): Promise<number> {
    const result = await this.dataSource
      .getRepository(Asset)
      .createQueryBuilder()
      .update(Asset)
      .set({
        asset_status: assetStatus,
        updated_by: updatedBy,
        updated_time: updatedTime,
        data_version: () => 'data_version + 1',
      })
      .where('asset_id = :assetId', { assetId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
    return result.affected ?? 0;
  }

  /** 软删除（ref_count=0 前置守卫在 Service） */
  async softDelete(assetId: string, userId: string, updatedBy: string, updatedTime?: Date): Promise<void> {
    await this.dataSource
      .getRepository(Asset)
      .createQueryBuilder()
      .update(Asset)
      .set({
        delete_sign: 1,
        updated_by: updatedBy,
        updated_time: updatedTime ?? new Date(),
        data_version: () => 'data_version + 1',
      })
      .where('asset_id = :assetId', { assetId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
  }

  /**
   * 引用计数原子增减 —— v1 `ref_count = GREATEST(ref_count + delta, 0)` 等价（INV-18）。
   * SQL 服务端静态构造（delta 为内部 int 参数），NR-03 合规。
   */
  async adjustRefCounts(
    userId: string,
    assetIds: string[],
    delta: number,
    updatedBy?: string,
    session?: TxSession,
  ): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    // 参数序号：$1=delta, $2=userId, [$3=updatedBy], IN 紧随其后
    const hasUpdatedBy = updatedBy !== undefined;
    const incStart = hasUpdatedBy ? 4 : 3;
    const inc = inClause('asset_id', assetIds, incStart);
    const setUpdatedBy = hasUpdatedBy ? ', updated_by = $3' : '';
    const params: unknown[] = [delta, userId, ...(hasUpdatedBy ? [updatedBy] : []), ...inc.params];
    await this.manager(session).query(
      `UPDATE dl_asset SET ref_count = GREATEST(ref_count + $1, 0), updated_time = now()${setUpdatedBy} WHERE user_id = $2 AND ${inc.sql}`,
      params,
    );
  }
}

/* ===================================================================== */
/* BrandKitRepository — dl_brand_kit（默认切换事务，api-assets §5.2） */
/* ===================================================================== */

@Injectable()
export class BrandKitRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /** 按业务主键取未删除行（属主隔离） */
  async findById(userId: string, brandKitId: string): Promise<BrandKit | null> {
    return this.dataSource.getRepository(BrandKit).findOne({ where: { brand_kit_id: brandKitId, user_id: userId, delete_sign: 0 } });
  }

  /** 名称冗余查询（deck 列表展示；未命中 ID 不出现在结果） */
  async findNamesByIds(userId: string, brandKitIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (brandKitIds.length === 0) {
      return result;
    }
    const kits = await this.dataSource
      .getRepository(BrandKit)
      .createQueryBuilder('b')
      .where('b.user_id = :userId', { userId })
      .andWhere('b.delete_sign = 0')
      .andWhere('b.brand_kit_id IN (:...ids)', { ids: brandKitIds })
      .getMany();
    for (const kit of kits) {
      result.set(kit.brand_kit_id, kit.kit_name);
    }
    return result;
  }

  /**
   * 规范分页 —— keyword→kit_name ILIKE；排序固定 is_default desc → updated_time desc（默认置顶）。
   */
  async findPage(ao: BrandKitListAO, userId: string): Promise<{ records: BrandKit[]; total: number }> {
    const repo = this.dataSource.getRepository(BrandKit);
    const apply = (qb: SelectQueryBuilder<BrandKit>): SelectQueryBuilder<BrandKit> => {
      qb.where('b.user_id = :userId', { userId }).andWhere('b.delete_sign = 0');
      if (notBlank(ao.keyword)) {
        qb.andWhere('b.kit_name ILIKE :kw', { kw: `%${escapeLike(ao.keyword)}%` });
      }
      return qb;
    };
    const [records, total] = await Promise.all([
      apply(repo.createQueryBuilder('b')).orderBy('b.is_default', 'DESC').addOrderBy('b.updated_time', 'DESC').skip((ao.pageNum - 1) * ao.pageSize).take(ao.pageSize).getMany(),
      apply(repo.createQueryBuilder('b')).getCount(),
    ]);
    return { records, total };
  }

  /** 规范选择池（keyword→kit_name；排序 is_default desc → updated_time desc，limit 200） */
  async findSelectList(ao: BrandKitSelectListAO, userId: string): Promise<BrandKit[]> {
    const qb = this.dataSource
      .getRepository(BrandKit)
      .createQueryBuilder('b')
      .where('b.user_id = :userId', { userId })
      .andWhere('b.delete_sign = 0');
    if (notBlank(ao.keyword)) {
      qb.andWhere('b.kit_name ILIKE :kw', { kw: `%${escapeLike(ao.keyword)}%` });
    }
    return qb.orderBy('b.is_default', 'DESC').addOrderBy('b.updated_time', 'DESC').take(200).getMany();
  }

  /** 插入（is_default=0 由 Service 组装） */
  async insert(doc: BrandKit, session?: TxSession): Promise<void> {
    await this.manager(session).getRepository(BrandKit).insert(doc);
  }

  /** 编辑（SET 全量业务字段 + 乐观锁 +1；fonts/logo_asset_id 可清空 → null 覆写） */
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
    session?: TxSession,
  ): Promise<number> {
    const result = await this.manager(session)
      .getRepository(BrandKit)
      .createQueryBuilder()
      .update(BrandKit)
      .set({
        kit_name: patch.kit_name,
        colors: patch.colors,
        fonts: patch.fonts,
        logo_asset_id: patch.logo_asset_id,
        updated_by: patch.updated_by,
        updated_time: patch.updated_time,
        data_version: () => 'data_version + 1',
      })
      .where('brand_kit_id = :brandKitId', { brandKitId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
    return result.affected ?? 0;
  }

  /** 旧默认置 0（INV-17 事务第一步；userId 服务端注入） */
  async clearDefault(userId: string, updatedBy: string, session?: TxSession): Promise<void> {
    await this.manager(session)
      .getRepository(BrandKit)
      .createQueryBuilder()
      .update(BrandKit)
      .set({ is_default: 0, updated_by: updatedBy, updated_time: new Date(), data_version: () => 'data_version + 1' })
      .where('user_id = :userId', { userId })
      .andWhere('is_default = 1')
      .andWhere('delete_sign = 0')
      .execute();
  }

  /** 新默认置 1（INV-17 事务第二步） */
  async setDefault(brandKitId: string, userId: string, updatedBy: string, session?: TxSession): Promise<number> {
    const result = await this.manager(session)
      .getRepository(BrandKit)
      .createQueryBuilder()
      .update(BrandKit)
      .set({ is_default: 1, updated_by: updatedBy, updated_time: new Date(), data_version: () => 'data_version + 1' })
      .where('brand_kit_id = :brandKitId', { brandKitId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
    return result.affected ?? 0;
  }

  /** 软删除 */
  async softDelete(brandKitId: string, userId: string, updatedBy: string, session?: TxSession): Promise<void> {
    await this.manager(session)
      .getRepository(BrandKit)
      .createQueryBuilder()
      .update(BrandKit)
      .set({ delete_sign: 1, updated_by: updatedBy, updated_time: new Date(), data_version: () => 'data_version + 1' })
      .where('brand_kit_id = :brandKitId', { brandKitId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
  }
}

/* ===================================================================== */
/* PromptTemplateRepository — dl_prompt_template */
/* ===================================================================== */

@Injectable()
export class PromptTemplateRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /** 按业务主键取未删除行（属主隔离） */
  async findById(userId: string, templateId: string): Promise<PromptTemplate | null> {
    return this.dataSource.getRepository(PromptTemplate).findOne({ where: { template_id: templateId, user_id: userId, delete_sign: 0 } });
  }

  /**
   * 话术分页 —— keyword→title 或 content ILIKE；category/templateScene eq；排序 updated_time desc。
   */
  async findPage(ao: PromptTemplateListAO, userId: string): Promise<{ records: PromptTemplate[]; total: number }> {
    const repo = this.dataSource.getRepository(PromptTemplate);
    const apply = (qb: SelectQueryBuilder<PromptTemplate>): SelectQueryBuilder<PromptTemplate> => {
      qb.where('p.user_id = :userId', { userId }).andWhere('p.delete_sign = 0');
      if (notBlank(ao.category)) {
        qb.andWhere('p.category = :category', { category: ao.category });
      }
      if (notBlank(ao.templateScene)) {
        qb.andWhere('p.template_scene = :scene', { scene: ao.templateScene });
      }
      if (notBlank(ao.keyword)) {
        qb.andWhere('(p.title ILIKE :kw OR p.content ILIKE :kw)', { kw: `%${escapeLike(ao.keyword)}%` });
      }
      return qb;
    };
    const [records, total] = await Promise.all([
      apply(repo.createQueryBuilder('p')).orderBy('p.updated_time', 'DESC').skip((ao.pageNum - 1) * ao.pageSize).take(ao.pageSize).getMany(),
      apply(repo.createQueryBuilder('p')).getCount(),
    ]);
    return { records, total };
  }

  /**
   * 话术选择池 —— keyword→title ILIKE、templateScene eq；排序 use_count desc，limit 200。
   */
  async findSelectList(ao: PromptTemplateSelectListAO, userId: string): Promise<PromptTemplate[]> {
    const qb = this.dataSource
      .getRepository(PromptTemplate)
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.delete_sign = 0');
    if (notBlank(ao.templateScene)) {
      qb.andWhere('p.template_scene = :scene', { scene: ao.templateScene });
    }
    if (notBlank(ao.keyword)) {
      qb.andWhere('p.title ILIKE :kw', { kw: `%${escapeLike(ao.keyword)}%` });
    }
    return qb.orderBy('p.use_count', 'DESC').take(200).getMany();
  }

  /** 未删除属主内按 id 集合计数（assertTemplatesExist 轻校验） */
  async countByIds(userId: string, templateIds: string[]): Promise<number> {
    if (templateIds.length === 0) {
      return 0;
    }
    return this.dataSource
      .getRepository(PromptTemplate)
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.delete_sign = 0')
      .andWhere('p.template_id IN (:...ids)', { ids: templateIds })
      .getCount();
  }

  /** 插入 */
  async insert(doc: PromptTemplate, session?: TxSession): Promise<void> {
    await this.manager(session).getRepository(PromptTemplate).insert(doc);
  }

  /** 编辑（SET 全量业务字段 + 乐观锁 +1；category 可清空） */
  async update(
    templateId: string,
    userId: string,
    patch: { title: string; content: string; category: string | null; template_scene: string; updated_by: string; updated_time: Date },
    session?: TxSession,
  ): Promise<number> {
    const result = await this.manager(session)
      .getRepository(PromptTemplate)
      .createQueryBuilder()
      .update(PromptTemplate)
      .set({
        title: patch.title,
        content: patch.content,
        category: patch.category,
        template_scene: patch.template_scene,
        updated_by: patch.updated_by,
        updated_time: patch.updated_time,
        data_version: () => 'data_version + 1',
      })
      .where('template_id = :templateId', { templateId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
    return result.affected ?? 0;
  }

  /** 软删除 */
  async softDelete(templateId: string, userId: string, updatedBy: string, session?: TxSession): Promise<void> {
    await this.manager(session)
      .getRepository(PromptTemplate)
      .createQueryBuilder()
      .update(PromptTemplate)
      .set({ delete_sign: 1, updated_by: updatedBy, updated_time: new Date(), data_version: () => 'data_version + 1' })
      .where('template_id = :templateId', { templateId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
  }

  /**
   * 使用计数原子 +1（touch；仅计数不动 updated_time/审计）。返回 affected 数（0=不存在或无权）。
   */
  async touchUseCount(templateId: string, userId: string): Promise<number> {
    const result = await this.dataSource
      .getRepository(PromptTemplate)
      .createQueryBuilder()
      .update(PromptTemplate)
      .set({ use_count: () => 'use_count + 1', data_version: () => 'data_version + 1' })
      .where('template_id = :templateId', { templateId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .execute();
    return result.affected ?? 0;
  }
}

/* ===================================================================== */
/* DeckBrandKitRefRepository —— 跨域只读 dl_deck（v1 DeckBrandKitRefMapper 对齐） */
/* ===================================================================== */

@Injectable()
export class DeckBrandKitRefRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 统计某用户下将指定规范设为默认的创作物数量（未删除） */
  async countDeckReference(brandKitId: string, userId: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_deck WHERE default_brand_kit_id = $1 AND user_id = $2 AND delete_sign = 0`,
      [brandKitId, userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}