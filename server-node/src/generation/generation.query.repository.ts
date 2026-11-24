import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DeleteSign } from '../common/enums';
import { inClause } from '../common/persistence';

/**
 * generation 域跨聚合只读聚合查询（v1 GenerationTaskQueryMapper 跨表 SQL 语义平移；
 * ADR-016 SQL 版；deck 域 DeckStatsRepository 同先例）。
 *
 * 背景：api-generation §3.2 入参守卫（assetIds 启用态/brandKitId 启用态）与列表行冗余
 * （deckName/resultVersionSeq）为只读点查。单服务单库（ADR-006）下以本域只读投影直查
 * 业务表（dl_asset / dl_brand_kit / dl_deck / dl_deck_version），不复制他域 entity、
 * 不引入他域 Service 依赖。
 *
 * 查询安全（NR-02/NR-03/NR-05）：SQL 服务端静态构造，入参仅作绑定值；userId 服务端注入；
 * 状态/类型字面量由调用方以共享枚举 code 传参（DeleteSign 公共枚举除外）。
 */
@Injectable()
export class GenerationQueryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 入参守卫：assetIds 属主名下且启用态的素材数（api-generation §4.4「≤10，启用态」）。
   */
  async countActiveAssets(userId: string, assetIds: string[], activeStatus: string): Promise<number> {
    if (assetIds.length === 0) {
      return 0;
    }
    const inc = inClause('asset_id', assetIds, 3);
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_asset WHERE user_id = $1 AND delete_sign = 0 AND asset_status = $2 AND ${inc.sql}`,
      [userId, activeStatus, ...inc.params],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /**
   * 入参守卫：品牌规范存在且未删除且属主一致（启用态=未删除，v1/deck 域同口径）。
   */
  async countValidBrandKit(brandKitId: string, userId: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_brand_kit WHERE brand_kit_id = $1 AND user_id = $2 AND delete_sign = 0`,
      [brandKitId, userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** deck 名称冗余（列表/详情行 deckName；已删除的不返回） */
  async findDeckNames(deckIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (deckIds.length === 0) {
      return result;
    }
    const inc = inClause('deck_id', deckIds, 1);
    const rows = await this.dataSource.query(
      `SELECT deck_id, deck_name FROM dl_deck WHERE delete_sign = 0 AND ${inc.sql}`,
      [...inc.params],
    );
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
    const inc = inClause('version_id', versionIds, 1);
    const rows = await this.dataSource.query(
      `SELECT version_id, version_seq FROM dl_deck_version WHERE ${inc.sql}`,
      inc.params,
    );
    for (const row of rows) {
      result.set(String(row.version_id), Number(row.version_seq));
    }
    return result;
  }
}