import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Account } from './schemas/account.schema';

/**
 * 账号仓储（dl_account，api-platform §5.2；ADR-016 TypeORM）。
 *
 * 查询安全（NR-02 白名单映射，请求体键名不得成为 filter 键）：
 * - findByEmail:     入参 email → { email } 等值 + delete_sign=0
 * - findByAccountId: 入参 accountId（服务端会话注入）→ { account_id } 等值 + delete_sign=0
 * - update*：        均白名单字段（account_id 定位），SET 字段服务端写死
 * 并发注册唯一冲突以 PG 23505 抛出（uk_email 兜底 INV-24），由 Service 翻译业务码。
 */
@Injectable()
export class AccountRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 新增账号（email 撞 uk_email 时抛 23505） */
  async insert(account: Account): Promise<void> {
    await this.dataSource.getRepository(Account).insert(account);
  }

  /** 按邮箱查找（未删除） */
  async findByEmail(email: string): Promise<Account | null> {
    return this.dataSource.getRepository(Account).findOne({ where: { email, delete_sign: 0 } });
  }

  /** 按业务主键查找（未删除） */
  async findByAccountId(accountId: string): Promise<Account | null> {
    return this.dataSource.getRepository(Account).findOne({ where: { account_id: accountId, delete_sign: 0 } });
  }

  /** 登录时间回写（updated_time 推进；data_version 乐观锁自增） */
  async touchLastLogin(accountId: string, when: Date): Promise<void> {
    await this.dataSource
      .getRepository(Account)
      .createQueryBuilder()
      .update(Account)
      .set({ last_login_at: when, updated_time: when, updated_by: accountId, data_version: () => 'data_version + 1' })
      .where('account_id = :accountId', { accountId })
      .andWhere('delete_sign = 0')
      .execute();
  }

  /** 昵称修改（资料接口；updated_time 推进） */
  async updateNickname(accountId: string, nickname: string, when: Date): Promise<void> {
    await this.dataSource
      .getRepository(Account)
      .createQueryBuilder()
      .update(Account)
      .set({ nickname, updated_time: when, updated_by: accountId, data_version: () => 'data_version + 1' })
      .where('account_id = :accountId', { accountId })
      .andWhere('delete_sign = 0')
      .execute();
  }
}