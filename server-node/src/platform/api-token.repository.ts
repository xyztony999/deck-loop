import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiToken } from './schemas/api-token.schema';

/** 分页结果（仓储形态，Service 组装 VO） */
export interface ApiTokenPage {
  records: ApiToken[];
  total: number;
}

/**
 * 个人 API token 仓储（dl_api_token，api-web-agent §4.1.4 仓储契约；ADR-016 TypeORM）。
 *
 * 查询安全（NR-02 白名单映射，请求体键名不得成为 filter 键）：
 * - findByHash:        服务端 SHA-256 计算值 → { token_hash } 等值（uk O(1)）+ delete_sign=0
 * - findByIdOwned:     tokenId + userId（会话注入）→ 等值 + delete_sign=0
 * - pageByUser:        强制 user_id + delete_sign=0，created_time DESC（白名单排序）
 * - conditionalRevoke: SET revoked_at 服务端写死，WHERE revoked_at IS NULL（幂等）
 * - touchLastUsed:     节流条件更新（last_used_at IS NULL OR < now−60s），≤1 次/分钟/token
 * 签发唯一冲突以 PG 23505 抛出（uk_api_token_hash 兜底 INV-27），由 Service 处置。
 */
@Injectable()
export class ApiTokenRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 新增 token（token_hash 撞 uk 时抛 23505） */
  async insert(token: ApiToken): Promise<void> {
    await this.dataSource.getRepository(ApiToken).insert(token);
  }

  /** 按哈希查找（verify 每次查库——吊销即时生效，重启不丢失） */
  async findByHash(tokenHash: string): Promise<ApiToken | null> {
    return this.dataSource
      .getRepository(ApiToken)
      .findOne({ where: { token_hash: tokenHash, delete_sign: 0 } });
  }

  /** 按业务主键 + 属主查找（revoke 属主校验） */
  async findByIdOwned(tokenId: string, userId: string): Promise<ApiToken | null> {
    return this.dataSource
      .getRepository(ApiToken)
      .findOne({ where: { token_id: tokenId, user_id: userId, delete_sign: 0 } });
  }

  /** 属主分页（created_time DESC；强制 user_id 隔离，ADR-005） */
  async pageByUser(userId: string, pageNum: number, pageSize: number): Promise<ApiTokenPage> {
    const [records, total] = await this.dataSource.getRepository(ApiToken).findAndCount({
      where: { user_id: userId, delete_sign: 0 },
      order: { created_time: 'DESC' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
    return { records, total };
  }

  /**
   * 条件吊销（revoked_at IS NULL → now）：返回是否生效。
   * 已吊销（0 行）由 Service 判幂等成功；不物理删除。
   */
  async conditionalRevoke(tokenId: string, userId: string, when: Date): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(ApiToken)
      .createQueryBuilder()
      .update(ApiToken)
      .set({
        revoked_at: when,
        updated_time: when,
        updated_by: userId,
        data_version: () => 'data_version + 1',
      })
      .where('token_id = :tokenId', { tokenId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = 0')
      .andWhere('revoked_at IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * last_used_at 节流更新（≤1 次/分钟/token）：条件 last_used_at IS NULL OR
   * last_used_at < threshold 原子判定，高频校验不产生写放大。
   */
  async touchLastUsed(tokenId: string, when: Date, threshold: Date): Promise<void> {
    await this.dataSource
      .getRepository(ApiToken)
      .createQueryBuilder()
      .update(ApiToken)
      .set({ last_used_at: when })
      .where('token_id = :tokenId', { tokenId })
      .andWhere('(last_used_at IS NULL OR last_used_at < :threshold)', { threshold })
      .execute();
  }
}