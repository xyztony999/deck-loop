import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { DeleteSign } from '../../common/enums';
import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

/**
 * 导出任务聚合根 — dl_export_task（api-delivery §5.3，18 字段与 v1 列逐字平移，
 * snake_case 契约口径；ADR-016 TypeORM entity）。
 *
 * - 业务主键 export_id（雪花串）= 表主键（取代 ObjectId，NR-08 无 _id 暴露面）；
 *   SUCCEEDED 终态即「导出记录」（api-delivery §1.4）
 * - 子流程聚合（独立状态机 export_status：QUEUED→SUCCEEDED/FAILED/CANCELLED；
 *   RENDERING 留枚举兼容，ADR-015 客户端渲染）；终态推进=条件 UPDATE
 *   （filter 含前置状态，幂等键=exportId+前置状态）
 * - 不变量：INV-14 version_id 必须为该 deck 的 finalVersionId（提交时锚定）；
 *   INV-15 SUCCEEDED ⇔ file_key 非空（终态条件更新内保证）
 * - 引用（仅存业务 id）：deck_id / version_id（跨聚合引用）；file_key 指向对象存储（外部引用，D1）
 * - 更新语义：终态字段标量更新；data_version 乐观锁（+1）；delete_sign 保留统一模板列
 * - 索引（entity 声明式，api-delivery §5.3 索引表）：idx_deck{deck_id,export_status}、
 *   idx_user_created{user_id,created_time}；export_id 主键即唯一
 * - 审计/时间字段手工维护（updated_time 为 EXPORT 聚合同步游标派生源）
 * - file_size bigint（产物字节数恒在 JS 安全整数内，仓储归一 number）
 */
@Entity('dl_export_task')
@Index('idx_export_deck', ['deck_id', 'export_status'])
@Index('idx_export_user_created', ['user_id', 'created_time'])
export class ExportTask {
  /** 业务主键（雪花串，common/utils/snowflake nextId()） */
  @PrimaryColumn({ type: 'varchar' })
  export_id!: string;

  /** 规则编码：EX+yyMMdd+4 位序列（业务表 MAX+1 取号，事务内与插入同事务） */
  @Column({ type: 'varchar' })
  export_code!: string;

  /** 归属创作物（跨聚合引用，dl_deck.deck_id） */
  @Column({ type: 'varchar' })
  deck_id!: string;

  /** 来源定稿版本（INV-14：=提交时 Deck.final_version_id） */
  @Column({ type: 'varchar' })
  version_id!: string;

  /** 导出格式：ExportFormat（PDF/IMAGES/PPTX） */
  @Column({ type: 'varchar' })
  export_format!: string;

  /** 导出状态：ExportStatus（QUEUED/RENDERING/SUCCEEDED/FAILED/CANCELLED） */
  @Column({ type: 'varchar' })
  export_status!: string;

  /** 产物对象存储 key（INV-15：SUCCEEDED 必有） */
  @Column({ type: 'varchar', nullable: true })
  file_key?: string | null;

  /** 产物大小（字节；未成功为 null。bigint→number 归一在仓储） */
  @Column({ type: 'bigint', nullable: true })
  file_size?: number | null;

  /** 失败摘要（FAILED 终态填写，≤512） */
  @Column({ type: 'varchar', nullable: true })
  error_msg?: string | null;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 创建人 ID（审计，=user_id） */
  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，与 deck 域口径一致） */
  @Column({ type: 'varchar', nullable: true })
  created_name?: string | null;

  /** 创建时间（审计） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  created_time?: Date | null;

  /** 最后修改人 ID（审计，=user_id；系统回调推进时同 user_id） */
  @Column({ type: 'varchar', nullable: true })
  updated_by?: string | null;

  /** 最后修改人姓名（审计；同 created_name 兜底） */
  @Column({ type: 'varchar', nullable: true })
  updated_name?: string | null;

  /** 最后修改时间（审计；EXPORT 聚合同步游标派生源，每次写推进） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  updated_time?: Date | null;

  /** 乐观锁版本号（条件更新 +1 推进） */
  @Column({ type: 'int', default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（导出记录不删除，保留统一模板列） */
  @Column({ type: 'int', default: DeleteSign.NOT_DELETED })
  delete_sign!: number;
}

/** 文档类型别名（ADR-016：TypeORM entity 即行类型；保留旧名以兼容服务层 import） */
export type ExportTaskDocument = ExportTask;