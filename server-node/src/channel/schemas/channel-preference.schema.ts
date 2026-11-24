import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 渠道偏好聚合根 entity（dl_channel_preference，api-channel §5.3；ADR-016 TypeORM）：
 * - 1:1 用户（每用户至多一行），upsert 键=user_id（uk_user 唯一索引，INV-23）
 * - 嵌入：preference_map=jsonb（{OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST:
 *   {channelCode,modelCode}}，无独立生命周期值对象整体嵌入；缺省档位回落默认）
 * - 引用：default_channel_code/default_model_code 为渠道配置代码（引用服务端渠道注册，
 *   非业务 id 外键；可用性校验 INV-22 由应用层守卫）
 * - 审计/data_version（+1 乐观锁）/delete_sign（统一模板，配置型无删除路径）按 06 §7
 * - 字段命名=契约 §5.3 字段清单逐字平移（snake_case，v1 列名）
 * - 业务主键 preference_id（雪花串）= 表主键（取代 ObjectId，NR-08）
 */

/** preference_map 档位值对象（嵌入值；契约键名 channelCode/modelCode 驼峰逐字对齐） */
export interface PreferenceTier {
  channelCode: string;
  modelCode: string;
}

@Entity('dl_channel_preference')
@Index('uk_user', ['user_id'], { unique: true })
export class ChannelPreference {
  /** 业务主键（雪花串） */
  @PrimaryColumn({ type: 'varchar' })
  preference_id!: string;

  /** 属主（唯一，upsert 键 uk_user，INV-23；隔离字段服务端注入 ADR-005/NR-05） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 默认渠道编码（有可用渠道时必填；INV-22 应用层守卫） */
  @Column({ type: 'varchar', nullable: true })
  default_channel_code?: string | null;

  /** 默认模型编码（INV-22 应用层守卫） */
  @Column({ type: 'varchar', nullable: true })
  default_model_code?: string | null;

  /** 分任务类型档位（键=TaskType code；jsonb 整体嵌入，读取即纯对象） */
  @Column({ type: 'jsonb', nullable: true })
  preference_map?: Record<string, PreferenceTier> | null;

  /** 乐观锁版本号（+1 平移，06 §7） */
  @Column({ type: 'int', default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（统一模板保留；配置型主数据无删除路径） */
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