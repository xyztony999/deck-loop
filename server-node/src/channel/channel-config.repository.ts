import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ChannelConfig, type ChannelConfigDocument } from './schemas/channel-config.schema';

/**
 * 渠道配置仓储（dl_channel；渠道管理端，channel-admin-2026-10-23 §2）。
 * 渠道量级为个位数，listAll 全量返回（无分页）。
 */
@Injectable()
export class ChannelConfigRepository {
  constructor(
    @InjectModel(ChannelConfig.name)
    private readonly model: Model<ChannelConfigDocument>,
  ) {}

  async findByCode(channelCode: string): Promise<ChannelConfigDocument | null> {
    return this.model.findOne({ channel_code: channelCode }).exec();
  }

  async listAll(): Promise<ChannelConfigDocument[]> {
    return this.model.find().sort({ priority: -1, channel_code: 1 }).exec();
  }

  async countAll(): Promise<number> {
    return this.model.countDocuments();
  }

  async insert(doc: Partial<ChannelConfig>): Promise<ChannelConfigDocument> {
    return this.model.create(doc as ChannelConfig);
  }

  async updateByCode(
    channelCode: string,
    operator: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.model
      .updateOne(
        { channel_code: channelCode },
        {
          $set: { ...patch, updated_by: operator, updated_time: new Date() },
          $inc: { data_version: 1 },
        },
      )
      .exec();
  }
}
