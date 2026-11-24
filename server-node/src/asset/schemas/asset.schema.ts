/**
 * 素材聚合根 entity — dl_asset（api-assets.md §5.3；ADR-016 TypeORM）。
 *
 * - 业务主键 asset_id（雪花串）= 表主键（取代 ObjectId，NR-08 无 _id 暴露面）
 * - 无结构化嵌入（元数据标量）；无出站引用；被 dl_brand_kit.logo_asset_id
 *   与版本 content 引用（ref_count 计数维护 INV-18）
 * - uk_user_hash{user_id,file_hash} unique：重复上传检测 INV-20（含软删行——
 *   同 hash 重传走复活路径而非撞唯一键）
 * - data_version 乐观锁（+1）+ delete_sign 软删（查询默认 0）+ 审计字段平移
 * - 字段名沿契约 §5.3 snake_case（=v1 列平移，与其他域 entity 同口径）
 * - file_size bigint（仓储归一 number）
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('dl_asset')
@Index('uk_user_hash', ['user_id', 'file_hash'], { unique: true })
@Index('idx_user_type', ['user_id', 'asset_type', 'asset_status'])
export class Asset {
  /** 业务主键（雪花串，服务层生成） */
  @PrimaryColumn({ type: 'varchar' })
  asset_id!: string;

  /** 名称（默认文件名） */
  @Column({ type: 'varchar' })
  asset_name!: string;

  /** 分类（自由文本目录；编辑可清空 → 可空） */
  @Column({ type: 'varchar', nullable: true })
  category?: string | null;

  /** 类型：AssetType（IMAGE/LOGO） */
  @Column({ type: 'varchar' })
  asset_type!: string;

  /** 对象存储 key（{userId}/{fileHash}.{ext}，白名单字符构成，防穿越） */
  @Column({ type: 'varchar' })
  storage_key!: string;

  /** 文件 SHA-256（重复检测 INV-20） */
  @Column({ type: 'varchar' })
  file_hash!: string;

  /** 宽（px；图片尺寸读取为占位简化，可空） */
  @Column({ type: 'int', nullable: true })
  width?: number | null;

  /** 高（px；同上可空） */
  @Column({ type: 'int', nullable: true })
  height?: number | null;

  /** 文件大小（字节） */
  @Column({ type: 'bigint' })
  file_size!: number;

  /** 状态：AssetStatus（ACTIVE/DISABLED，启停生命周期） */
  @Column({ type: 'varchar' })
  asset_status!: string;

  /** 被引用计数（>0 禁删，INV-18；GREATEST(0) 语义原子更新） */
  @Column({ type: 'int', default: 0 })
  ref_count!: number;

  /** 属主（隔离字段，ADR-005，服务端注入） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 乐观锁版本（更新 +1；复活时重置 0，对齐 v1 revive SQL） */
  @Column({ type: 'int', default: 0 })
  data_version!: number;

  /** 软删标记（0=未删除/1=已删除；查询默认过滤 0，hash 查重除外） */
  @Column({ type: 'int', default: 0 })
  delete_sign!: number;

  /** 审计：创建人（userId；无昵称上下文，name 位留空） */
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

  /** 多端同步游标扫描依据（毫秒精度 + 业务 id 升序） */
  @Column({ type: 'timestamptz', nullable: true })
  updated_time?: Date | null;
}