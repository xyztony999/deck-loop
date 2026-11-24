import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UsageRecord } from './schemas/usage-record.schema';

/**
 * 用量计量仓储（dl_usage_record，api-platform §5.2；ADR-016 TypeORM）。
 * 日志型表：仅 append=insert，无更新/删除路径（06 §3.1）；
 * usage_id 由服务端雪花生成，user_id 自任务快照服务端注入（NR-05）。
 */
@Injectable()
export class UsageRecordRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 用量入账（只追加） */
  async append(record: UsageRecord): Promise<void> {
    await this.dataSource.getRepository(UsageRecord).insert(record);
  }
}