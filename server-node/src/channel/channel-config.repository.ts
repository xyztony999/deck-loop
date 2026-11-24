import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChannelConfig, type ChannelConfigDocument } from './schemas/channel-config.schema';

/**
 * 渠道配置仓储（dl_channel；渠道管理端，channel-admin-2026-10-23 §2；ADR-016 TypeORM）。
 * 渠道量级为个位数，listAll 全量返回（无分页）。
 */
@Injectable()
export class ChannelConfigRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findByCode(channelCode: string): Promise<ChannelConfigDocument | null> {
    return this.dataSource.getRepository(ChannelConfig).findOne({ where: { channel_code: channelCode } });
  }

  async listAll(): Promise<ChannelConfigDocument[]> {
    return this.dataSource.getRepository(ChannelConfig).find({ order: { priority: 'DESC', channel_code: 'ASC' } });
  }

  async countAll(): Promise<number> {
    return this.dataSource.getRepository(ChannelConfig).count();
  }

  async insert(doc: Partial<ChannelConfig>): Promise<ChannelConfigDocument> {
    const repo = this.dataSource.getRepository(ChannelConfig);
    const entity = repo.create(doc as ChannelConfig);
    await repo.insert(entity);
    return entity;
  }

  async updateByCode(
    channelCode: string,
    operator: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource
      .getRepository(ChannelConfig)
      .createQueryBuilder()
      .update(ChannelConfig)
      .set({ ...patch, updated_by: operator, updated_time: new Date(), data_version: () => 'data_version + 1' })
      .where('channel_code = :channelCode', { channelCode })
      .execute();
  }
}