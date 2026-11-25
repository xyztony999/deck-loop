import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { JSON_COLUMN_TYPE, TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

/**
 * 内容版本聚合根 — dl_deck_version（api-version §5.3，字段=v1 列平移；ADR-016 TypeORM entity）。
 *
 * - 业务主键 version_id（雪花串）= 表主键（取代 ObjectId，NR-08 无 _id 暴露面）
 * - **不可变语义（INV-11，ADR-002/009）**：版本插入后任何字段不可更新，仓储仅 insert；
 *   因此本 entity **无 data_version / delete_sign / updated_by / updated_name / updated_time**，
 *   审计仅 created 三项（沿用 v1 不可变约定，api-version §5.3）
 * - 嵌入：content=jsonb（页面树快照整体嵌入：pages[]→blocks[]，值对象契约见
 *   api-version §4.1，blockType TEXT|IMAGE|PLACEHOLDER）；instruction_snapshot=jsonb
 *   （来源指令/入参快照整体嵌入，含 scope/brand/assetIds/outline 快照）
 * - 引用（仅存业务 id）：deck_id / parent_version_id / task_id（跨聚合引用，
 *   INV-13 应用层守卫；task_id 归 dl_generation_task，fork 复制行沿用源版本任务）
 * - version_seq 冗余列（deck 维度自增，树浏览免解析 content）
 * - 索引（entity 声明式，api-version §5.3 索引表）：
 *   uk_deck_branch{deck_id,branch_name,version_seq unique 复合}、
 *   idx_deck_parent{deck_id,parent_version_id}；version_id 主键即唯一
 * - created_time 手工维护（VERSION 聚合同步游标派生源：insert-only，插入即变更）
 */
@Entity('dl_deck_version')
@Index('uk_deck_branch', ['deck_id', 'branch_name', 'version_seq'], { unique: true })
@Index('idx_deck_parent', ['deck_id', 'parent_version_id'])
export class DeckVersion {
  /** 业务主键（雪花串，common/utils/snowflake nextId()） */
  @PrimaryColumn({ type: 'varchar' })
  version_id!: string;

  /** 归属创作物（跨聚合引用，dl_deck.deck_id） */
  @Column({ type: 'varchar' })
  deck_id!: string;

  /** 谱系内序号（deck 维度自增，展示用；分配=事务内 MAX+1，api-version §4.5） */
  @Column({ type: 'int' })
  version_seq!: number;

  /** 分支名（首版=main；INV-12 同 deck 唯一，uk_deck_branch 兜底） */
  @Column({ type: 'varchar' })
  branch_name!: string;

  /** 父版本（首版为空；INV-13 非空必须同 deck 存在） */
  @Column({ type: 'varchar', nullable: true })
  parent_version_id?: string | null;

  /** 来源：VersionSourceType（FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST，无 OUTLINE） */
  @Column({ type: 'varchar' })
  source_type!: string;

  /** 来源任务（dl_generation_task.task_id；fork 复制行沿用源版本任务） */
  @Column({ type: 'varchar' })
  task_id!: string;

  /** 来源指令/入参快照（整体嵌入 jsonb；含 scope/brand/assetIds/outline 快照） */
  // jsonb 不透明 blob 用 Record<string, any>：TypeORM _QueryDeepPartialEntity 对 unknown 值不可赋值
  @Column({ type: JSON_COLUMN_TYPE })
  instruction_snapshot!: Record<string, any>;

  /** 页面树快照（整体嵌入 jsonb：pages[]→blocks[]，契约见 api-version §4.1） */
  @Column({ type: JSON_COLUMN_TYPE })
  content!: Record<string, any>;

  /** content SHA-256（hex 小写 64 位；对比加速/一致性校验，canonical 序列化） */
  @Column({ type: 'varchar' })
  content_hash!: string;

  /** 页数（冗余，树浏览列表免解析 content） */
  @Column({ type: 'int' })
  page_count!: number;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 创建人 ID（审计，=user_id；不可变聚合仅 created 三项） */
  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，与 deck 域口径一致） */
  @Column({ type: 'varchar', nullable: true })
  created_name?: string | null;

  /** 创建时间（审计；VERSION 聚合同步游标派生源） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  created_time?: Date | null;
}

/** 文档类型别名（ADR-016：TypeORM entity 即行类型；保留旧名以兼容服务层 import） */
export type DeckVersionDocument = DeckVersion;