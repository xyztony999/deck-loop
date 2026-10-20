import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * 账号聚合根 —— dl_account（api-platform §5.3，v1 DDL 列平移）。
 *
 * - 自身即主体：无 user_id 隔离字段（ADR-005 例外）；无嵌入/引用（薄标量）
 * - 会话 token 不落库（HMAC 自包含 + 内存撤销表，SessionTokenService）
 * - 无 delete_sign 业务需求，按统一模板保留（查询默认 delete_sign=0）
 * - _id=ObjectId 仅存储不进 VO；业务主键 account_id（雪花串）唯一索引
 * - 索引（§5.5 声明式）：uk_account_id{account_id}unique、uk_email{email}unique（INV-24 兜底）
 */
@Schema({ collection: 'dl_account', versionKey: false, timestamps: false })
export class Account {
  /** 业务主键（雪花串） */
  @Prop({ type: String, required: true })
  account_id!: string;

  /** 邮箱（全局唯一，INV-24；唯一索引兜底并发注册） */
  @Prop({ type: String, required: true })
  email!: string;

  /** 口令哈希（PBKDF2-SHA256，格式 pbkdf2$iterations$saltB64$hashB64；明文不出现在任何对象） */
  @Prop({ type: String, required: true })
  password_hash!: string;

  /** 昵称 */
  @Prop({ type: String, required: true })
  nickname!: string;

  /** 状态：AccountStatus（ACTIVE/LOCKED），无状态机 */
  @Prop({ type: String, required: true, default: 'ACTIVE' })
  account_status!: string;

  /** 最近登录时间 */
  @Prop({ type: Date })
  last_login_at?: Date;

  /* ---------- 统一模板：乐观锁/软删/审计六件套 ---------- */

  @Prop({ type: Number, default: 0 })
  data_version!: number;

  @Prop({ type: Number, default: 0 })
  delete_sign!: number;

  @Prop({ type: String })
  created_by?: string;

  @Prop({ type: String })
  created_name?: string;

  @Prop({ type: Date })
  created_time?: Date;

  @Prop({ type: String })
  updated_by?: string;

  @Prop({ type: String })
  updated_name?: string;

  @Prop({ type: Date })
  updated_time?: Date;
}

export type AccountDocument = HydratedDocument<Account>;

export const AccountSchema = SchemaFactory.createForClass(Account);
// uk_account_id / uk_email（§3.5 声明式创建）
AccountSchema.index({ account_id: 1 }, { unique: true, name: 'uk_account_id' });
AccountSchema.index({ email: 1 }, { unique: true, name: 'uk_email' });
