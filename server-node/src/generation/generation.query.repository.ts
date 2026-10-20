import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { DeleteSign } from '../common/enums';

/**
 * generation 域跨聚合只读聚合查询（v1 GenerationTaskQueryMapper 跨表 SQL 语义平移，
 * Mongo raw collection 版；deck 域 DeckStatsRepository 同先例）。
 *
 * 背景：api-generation §3.2 声明依赖「素材 Select/品牌规范读取」，入参守卫
 * （assetIds 启用态/brandKitId 启用态）与列表行冗余（deckName/resultVersionSeq）
 * 为只读点查。单服务单库（ADR-006）下以本域只读投影直查业务 collection
 * （dl_asset / dl_brand_kit / dl_deck / dl_deck_version），不复制他域 schema、
 * 不注册重复 model、不引入他域 Service 依赖。
 *
 * 查询安全（NR-02/NR-03/NR-05）：查询服务端静态构造，入参仅作等值/$in 值
 * （id 集合来自服务端加载文档或 DTO 校验后的雪花串）；userId 隔离字段服务端注入；
 * 状态/类型字面量由调用方以共享枚举 code 传参，本类不硬编码业务状态值
 * （DeleteSign 公共枚举除外）。
 *
 * 跨 collection 字段口径（与各域已落盘 schema 逐字对齐，契约 §5.3 snake_case）：
 * - dl_deck / dl_deck_version：snake_case（deck_id/deck_name/version_id/version_seq）
 * - dl_asset / dl_brand_kit：snake_case（asset_id/asset_status/user_id/delete_sign/
 *   brand_kit_id——v1 DDL 列平移口径）
 */
@Injectable()
export class GenerationQueryRepository {
  /** dl_asset（asset 域） */
  private static readonly COL_ASSET = 'dl_asset';
  /** dl_brand_kit（asset 域） */
  private static readonly COL_BRAND_KIT = 'dl_brand_kit';
  /** dl_deck（deck 域） */
  private static readonly COL_DECK = 'dl_deck';
  /** dl_deck_version（version 域，insert-only 无 delete_sign） */
  private static readonly COL_VERSION = 'dl_deck_version';

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * 入参守卫：assetIds 属主名下且启用态的素材数（api-generation §4.4「≤10，启用态」；
   * v1 countActiveAssets 对齐——不满额即存在非法/停用 ID）。
   */
  countActiveAssets(userId: string, assetIds: string[], activeStatus: string): Promise<number> {
    return this.connection.collection(GenerationQueryRepository.COL_ASSET).countDocuments({
      user_id: userId,
      delete_sign: DeleteSign.NOT_DELETED,
      asset_status: activeStatus,
      asset_id: { $in: assetIds },
    });
  }

  /**
   * 入参守卫：品牌规范存在且未删除且属主一致（api-generation §4.4「启用态」；
   * dl_brand_kit 无启停状态列，启用态=未删除，v1/deck 域同口径）。
   */
  countValidBrandKit(brandKitId: string, userId: string): Promise<number> {
    return this.connection.collection(GenerationQueryRepository.COL_BRAND_KIT).countDocuments({
      brand_kit_id: brandKitId,
      user_id: userId,
      delete_sign: DeleteSign.NOT_DELETED,
    });
  }

  /** deck 名称冗余（列表/详情行 deckName；已删除的不返回） */
  async findDeckNames(deckIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (deckIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(GenerationQueryRepository.COL_DECK)
      .find({ deck_id: { $in: deckIds }, delete_sign: DeleteSign.NOT_DELETED })
      .project({ deck_id: 1, deck_name: 1 })
      .toArray();
    for (const row of rows) {
      result.set(String(row.deck_id), String(row.deck_name ?? ''));
    }
    return result;
  }

  /** 版本序号映射（versionId → version_seq，列表/详情行 resultVersionSeq 回填用） */
  async findVersionSeqs(versionIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (versionIds.length === 0) {
      return result;
    }
    const rows = await this.connection
      .collection(GenerationQueryRepository.COL_VERSION)
      .find({ version_id: { $in: versionIds } })
      .project({ version_id: 1, version_seq: 1 })
      .toArray();
    for (const row of rows) {
      result.set(String(row.version_id), Number(row.version_seq));
    }
    return result;
  }
}
