import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Account, AccountDocument } from './schemas/account.schema';

/**
 * 账号仓储（dl_account，api-platform §5.2）。
 *
 * 查询安全（NR-02 白名单映射，请求体键名不得成为 filter 键）：
 * - findByEmail:     入参 email → { email } 等值 + delete_sign=0（软删默认过滤）
 * - findByAccountId: 入参 accountId（服务端会话注入）→ { account_id } 等值 + delete_sign=0
 * - update*：        均 task 白名单字段（account_id 定位），$set 字段服务端写死
 * 并发注册唯一冲突以 Mongo 11000 抛出（uk_email 兜底 INV-24），由 Service 翻译业务码。
 */
@Injectable()
export class AccountRepository {
  constructor(
    @InjectModel(Account.name)
    private readonly model: Model<AccountDocument>,
  ) {}

  /** 新增账号（email 撞 uk_email 时抛 MongoServerError(code=11000)） */
  async insert(account: Account): Promise<void> {
    await this.model.create(account);
  }

  /** 按邮箱查找（未删除） */
  async findByEmail(email: string): Promise<AccountDocument | null> {
    return this.model.findOne({ email, delete_sign: 0 }).exec();
  }

  /** 按业务主键查找（未删除） */
  async findByAccountId(accountId: string): Promise<AccountDocument | null> {
    return this.model.findOne({ account_id: accountId, delete_sign: 0 }).exec();
  }

  /** 登录时间回写（updated_time 推进；data_version 乐观锁自增） */
  async touchLastLogin(accountId: string, when: Date): Promise<void> {
    await this.model
      .updateOne(
        { account_id: accountId, delete_sign: 0 },
        { $set: { last_login_at: when, updated_time: when, updated_by: accountId }, $inc: { data_version: 1 } },
      )
      .exec();
  }

  /** 昵称修改（资料接口；updated_time 推进） */
  async updateNickname(accountId: string, nickname: string, when: Date): Promise<void> {
    await this.model
      .updateOne(
        { account_id: accountId, delete_sign: 0 },
        { $set: { nickname, updated_time: when, updated_by: accountId }, $inc: { data_version: 1 } },
      )
      .exec();
  }
}
