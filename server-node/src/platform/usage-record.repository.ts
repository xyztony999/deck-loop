import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { UsageRecord, UsageRecordDocument } from './schemas/usage-record.schema';

/**
 * 用量计量仓储（dl_usage_record，api-platform §5.2）。
 * 日志型 collection：仅 append=insertOne，无更新/删除路径（06 §3.1）；
 * usage_id 由服务端雪花生成，user_id 自任务快照服务端注入（NR-05）。
 */
@Injectable()
export class UsageRecordRepository {
  constructor(
    @InjectModel(UsageRecord.name)
    private readonly model: Model<UsageRecordDocument>,
  ) {}

  /** 用量入账（只追加） */
  async append(record: UsageRecord): Promise<void> {
    await this.model.create(record);
  }
}
