import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 账号聚合根 —— dl_account（api-platform §5.3，v1 DDL 列平移；ADR-016 TypeORM entity）。
 *
 * - 自身即主体：无 user_id 隔离字段（ADR-005 例外）；无嵌入/引用（薄标量）
 * - 会话 token 不落库（HMAC 自包含 + 内存撤销表，SessionTokenService）
 * - 无 delete_sign 业务需求，按统一模板保留（查询默认 delete_sign=0）
 * - 业务主键 account_id（雪花串）= 表主键（取代 ObjectId，NR-08 无 _id 暴露面）
 * - 索引（§5.5 声明式）：uk_email{email}unique（INV-24 兜底）；account_id 主键即唯一
 */
@Entity('dl_account')
@Index('uk_email', ['email'], { unique: true })
export class Account {
  /** 业务主键（雪花串） */
  @PrimaryColumn({ type: 'varchar' })
  account_id!: string;

  /** 邮箱（全局唯一，INV-24；唯一索引兜底并发注册） */
  @Column({ type: 'varchar' })
  email!: string;

  /** 口令哈希（PBKDF2-SHA256，格式 pbkdf2$iterations$saltB64$hashB64；明文不出现在任何对象） */
  @Column({ type: 'varchar' })
  password_hash!: string;

  /** 昵称 */
  @Column({ type: 'varchar' })
  nickname!: string;

  /** 状态：AccountStatus（ACTIVE/LOCKED），无状态机 */
  @Column({ type: 'varchar', default: 'ACTIVE' })
  account_status!: string;

  /** 最近登录时间 */
  @Column({ type: 'timestamptz', nullable: true })
  last_login_at?: Date | null;

  /* ---------- 统一模板：乐观锁/软删/审计六件套 ---------- */

  @Column({ type: 'int', default: 0 })
  data_version!: number;

  @Column({ type: 'int', default: 0 })
  delete_sign!: number;

  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', nullable: true })
  created_name?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  created_time?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  updated_by?: string | null;

  @Column({ type: 'varchar', nullable: true })
  updated_name?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  updated_time?: Date | null;
}