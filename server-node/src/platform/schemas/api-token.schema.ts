import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

/**
 * 个人 API token 聚合根 —— dl_api_token（api-web-agent §4.1/§5.3，ADR-018 新增，
 * 第 10 张物理表：11−dl_channel−dl_channel_preference+本表）。
 *
 * - 业务主键 token_id（雪花串）= 表主键（NR-08 无 _id 暴露面）
 * - 属主 user_id（ADR-005 隔离字段，服务端会话注入）
 * - **INV-28：明文不落库**——token_hash=SHA-256(全 token) hex（uk_api_token_hash
 *   O(1) 查找+恒时比较）；token_prefix=明文前 12 字符（dlpat_+6，列表回显用）
 * - 无状态列：status 派生（revoked_at≠null→REVOKED；expires_at 到期→EXPIRED；否则 ACTIVE）
 * - expires_at=null 永久；last_used_at 校验时节流更新（≤1 次/分钟/token）
 * - 吊销即时生效（verify 每次查库，无缓存撤销表——区别于会话内存撤销表，重启不丢失）
 * - 不参与同步扫描（非八聚合，api-web-agent §4.1.4）
 * - 索引（§5.3 声明式）：uk_api_token_hash{token_hash}unique（INV-27）、
 *   idx_api_token_user{user_id,delete_sign}
 */
@Entity('dl_api_token')
@Index('uk_api_token_hash', ['token_hash'], { unique: true })
@Index('idx_api_token_user', ['user_id', 'delete_sign'])
export class ApiToken {
  /** 业务主键（雪花串） */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  token_id!: string;

  /** 属主（ADR-005） */
  @Column({ type: 'varchar', length: 32 })
  user_id!: string;

  /** 用途名（≤50） */
  @Column({ type: 'varchar', length: 50 })
  token_name!: string;

  /** 明文前 12 字符（dlpat_+6），列表回显 */
  @Column({ type: 'varchar', length: 16 })
  token_prefix!: string;

  /** SHA-256(全 token) hex，唯一索引（INV-27；明文不落库 INV-28） */
  @Column({ type: 'varchar', length: 64 })
  token_hash!: string;

  /** 过期时刻（null=永久） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  expires_at?: Date | null;

  /** 最近使用（校验时节流更新，≤1 次/分钟） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  last_used_at?: Date | null;

  /** 吊销时刻（null=未吊销；吊销用本列，无软删需求） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  revoked_at?: Date | null;

  /* ---------- 统一模板：乐观锁/软删/审计六件套 ---------- */

  @Column({ type: 'int', default: 0 })
  data_version!: number;

  @Column({ type: 'int', default: 0 })
  delete_sign!: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  created_name?: string | null;

  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  created_time?: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  updated_by?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  updated_name?: string | null;

  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  updated_time?: Date | null;
}