/**
 * 品牌规范聚合根 entity — dl_brand_kit（api-assets.md §5.3；ADR-016 TypeORM）。
 *
 * - colors/fonts 为 JSON 值对象（D3）：无独立生命周期，整体嵌入 jsonb
 * - logo_asset_id → dl_asset 业务 id 引用（仅存 id；INV-16 启用态守卫在应用层）
 * - is_default 用户维度唯一（INV-17：set-default 事务切换）
 * - 字段名沿契约 §5.3 snake_case（=v1 列平移，与其他域 entity 同口径）
 * - 业务主键 brand_kit_id = 表主键（取代 ObjectId，NR-08）
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { JSON_COLUMN_TYPE, TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

/** 色彩值对象（{primary,assistants[]}，整体嵌入 jsonb） */
export interface BrandKitColors {
  /** 主色 */
  primary: string;
  /** 辅色数组（≤16 项） */
  assistants?: string[];
}

/** 字体值对象（{title, body}，预置清单引用名，整体嵌入 jsonb，可空） */
export interface BrandKitFonts {
  title?: string | null;
  body?: string | null;
}

@Entity('dl_brand_kit')
@Index('idx_user', ['user_id', 'delete_sign'])
export class BrandKit {
  /** 业务主键（雪花串，服务层生成） */
  @PrimaryColumn({ type: 'varchar' })
  brand_kit_id!: string;

  /** 规范名称（≤50） */
  @Column({ type: 'varchar' })
  kit_name!: string;

  /** 色彩值对象（嵌入 jsonb） */
  @Column({ type: JSON_COLUMN_TYPE })
  colors!: BrandKitColors;

  /** 字体值对象（嵌入 jsonb，可空；编辑可清空） */
  @Column({ type: JSON_COLUMN_TYPE, nullable: true })
  fonts?: BrandKitFonts | null;

  /** logo 素材引用（dl_asset 业务 id；INV-16 启用态守卫；解绑清空） */
  @Column({ type: 'varchar', nullable: true })
  logo_asset_id?: string | null;

  /** 是否默认规范（用户维度唯一，INV-17）：1-是 / 0-否（YesNo INT(1) 语义） */
  @Column({ type: 'int', default: 0 })
  is_default!: number;

  /** 属主（隔离字段，ADR-005，服务端注入） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 乐观锁版本（更新 +1） */
  @Column({ type: 'int', default: 0 })
  data_version!: number;

  /** 软删标记（0=未删除/1=已删除） */
  @Column({ type: 'int', default: 0 })
  delete_sign!: number;

  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', nullable: true })
  created_name?: string | null;

  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  created_time?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  updated_by?: string | null;

  @Column({ type: 'varchar', nullable: true })
  updated_name?: string | null;

  /** 多端同步游标扫描依据 */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  updated_time?: Date | null;
}