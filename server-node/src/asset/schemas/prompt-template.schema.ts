/**
 * 话术模板聚合根（薄）entity — dl_prompt_template（api-assets.md §5.3，S-02；ADR-016 TypeORM）。
 *
 * - content 为含 {占位符} 的 string 值（无结构化嵌入；占位符语法元数据即 content 本身，
 *   语法校验 INV-21 于 save 应用层执行：{名称} 且 ≤10 处）
 * - 独立聚合，无关联边；use_count 由 /asset/prompt/touch 原子 +1
 * - 字段名沿契约 §5.3 snake_case（=v1 列平移，与其他域 entity 同口径）
 * - 业务主键 template_id = 表主键（取代 ObjectId，NR-08）
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

@Entity('dl_prompt_template')
@Index('idx_user_scene', ['user_id', 'template_scene'])
export class PromptTemplate {
  /** 业务主键（雪花串，服务层生成） */
  @PrimaryColumn({ type: 'varchar' })
  template_id!: string;

  /** 标题（≤50） */
  @Column({ type: 'varchar' })
  title!: string;

  /** 话术正文（≤2000，含 {占位符}，INV-21） */
  @Column({ type: 'varchar' })
  content!: string;

  /** 分类（编辑可清空 → 可空） */
  @Column({ type: 'varchar', nullable: true })
  category?: string | null;

  /** 场景：TemplateScene（WHOLE/TARGETED） */
  @Column({ type: 'varchar' })
  template_scene!: string;

  /** 使用计数（touch 原子 +1） */
  @Column({ type: 'int', default: 0 })
  use_count!: number;

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