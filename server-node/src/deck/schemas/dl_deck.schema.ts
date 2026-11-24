import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { DeleteSign } from '../../common/enums';

/**
 * 创作物聚合根 — dl_deck（api-deck §5.3，22 字段与 v1 列逐字平移；ADR-016 TypeORM entity）。
 *
 * - 业务主键 deck_id（雪花串）= 表主键（取代 ObjectId，NR-08 无 _id 暴露面）
 * - 嵌入：draft_outline=jsonb（大纲节点树，无独立生命周期值对象整体嵌入；
 *   由 generation 域经 DeckDomainService#updateDraftOutline 定向写入）
 * - 引用（仅存业务 id）：default_brand_kit_id / current_version_id / final_version_id
 *   （跨聚合指针，INV-1/INV-2 应用层守卫）
 * - 更新语义：可更新行；data_version 乐观锁（条件更新 +1）；delete_sign 逻辑删除（查询默认 0）
 * - 索引（entity 声明式，06 §3.5）：idx_user_status{user_id,deck_status,delete_sign}、
 *   idx_user_updated{user_id,updated_time}；deck_id 主键即唯一
 * - 字段名沿契约 snake_case（§5.3 字段清单=v1 列平移）
 * - 审计/时间字段手工维护（updated_time 为多端同步游标派生源，必须随每次写推进）
 */
@Entity('dl_deck')
@Index('idx_user_status', ['user_id', 'deck_status', 'delete_sign'])
@Index('idx_user_updated', ['user_id', 'updated_time'])
export class Deck {
  /** 业务主键（雪花串，common/utils/snowflake nextId()） */
  @PrimaryColumn({ type: 'varchar' })
  deck_id!: string;

  /** 规则编码：DL+yyMMdd+4 位序列（业务表 MAX+1，事务内取号） */
  @Column({ type: 'varchar' })
  deck_code!: string;

  /** 名称（INV-5：非空 ≤100） */
  @Column({ type: 'varchar' })
  deck_name!: string;

  /** 类型：DeckType（首期仅 DECK） */
  @Column({ type: 'varchar' })
  deck_type!: string;

  /** 主题（INV-5：非空 ≤200） */
  @Column({ type: 'varchar' })
  topic!: string;

  /** 需求描述（可空） */
  @Column({ type: 'varchar', nullable: true })
  requirement?: string | null;

  /** 状态：DeckStatus（DRAFT/ITERATING/FINALIZED/ARCHIVED，api-deck §4.2 状态机） */
  @Column({ type: 'varchar' })
  deck_status!: string;

  /** 草稿大纲（节点树整体嵌入 jsonb；首个版本生成后转只读） */
  // jsonb 不透明 blob 用 Record<string, any>：TypeORM _QueryDeepPartialEntity 对 unknown 值不可赋值
  @Column({ type: 'jsonb', nullable: true })
  draft_outline?: Record<string, any> | null;

  /** 默认品牌规范（跨聚合引用，启用态，INV-7） */
  @Column({ type: 'varchar', nullable: true })
  default_brand_kit_id?: string | null;

  /** 当前版本指针（DRAFT 态为空；INV-1 归属守卫在 DeckDomainService#movePointer） */
  @Column({ type: 'varchar', nullable: true })
  current_version_id?: string | null;

  /** 活动分支（默认 main；INV-6 同 deck 内唯一） */
  @Column({ type: 'varchar', default: 'main' })
  active_branch!: string;

  /** 定稿版本（FINALIZED 必有值，INV-2；解锁后保留作最近定稿记录） */
  @Column({ type: 'varchar', nullable: true })
  final_version_id?: string | null;

  /** 归档前状态（restore 恢复目标） */
  @Column({ type: 'varchar', nullable: true })
  archived_from_status?: string | null;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 创建人 ID（审计，=user_id） */
  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底） */
  @Column({ type: 'varchar', nullable: true })
  created_name?: string | null;

  /** 创建时间（审计） */
  @Column({ type: 'timestamptz', nullable: true })
  created_time?: Date | null;

  /** 最后修改人 ID（审计） */
  @Column({ type: 'varchar', nullable: true })
  updated_by?: string | null;

  /** 最后修改人姓名（审计；同 created_name 兜底） */
  @Column({ type: 'varchar', nullable: true })
  updated_name?: string | null;

  /** 最后修改时间（审计；多端同步游标派生源，每次写推进） */
  @Column({ type: 'timestamptz', nullable: true })
  updated_time?: Date | null;

  /** 乐观锁版本号（条件更新 filter 携带期望值 + data_version+1 推进） */
  @Column({ type: 'int', default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（DeleteSign.NOT_DELETED），1-已删除（查询默认过滤 0） */
  @Column({ type: 'int', default: DeleteSign.NOT_DELETED })
  delete_sign!: number;
}

/** 文档类型别名（ADR-016：TypeORM entity 即行类型；保留旧名以兼容服务层 import） */
export type DeckDocument = Deck;