import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';

/**
 * 内容版本聚合根 — dl_deck_version collection（api-version §5.3，字段=v1 列平移）。
 *
 * - `_id` ObjectId 仅存储层内部使用，不进 VO（NR-08）；业务主键 version_id（雪花串，唯一索引）
 * - **不可变语义（INV-11，ADR-002/009）**：版本插入后任何字段不可更新，仓储仅 insertOne；
 *   因此本 schema **无 data_version / delete_sign / updated_by / updated_name / updated_time**，
 *   审计仅 created 三项（沿用 v1 不可变约定，api-version §5.3）
 * - 嵌入：content=object（页面树快照整体嵌入：pages[]→blocks[]，值对象契约见
 *   api-version §4.1，blockType TEXT|IMAGE|PLACEHOLDER）；instruction_snapshot=object
 *   （来源指令/入参快照整体嵌入，含 scope/brand/assetIds/outline 快照）
 * - 引用（仅存业务 id）：deck_id / parent_version_id / task_id（跨聚合引用，
 *   INV-13 应用层守卫；task_id 归 dl_generation_task，fork 复制行沿用源版本任务）
 * - version_seq 冗余列（deck 维度自增，树浏览免解析 content；与 deck 域
 *   deck.stats.repository.ts 的 version_seq 只读投影同口径）
 * - 索引（schema 声明式创建，api-version §5.3 索引表）：
 *   uk_version_id{unique}、uk_deck_branch{deck_id,branch_name,version_seq unique 复合}、
 *   idx_deck_parent{deck_id,parent_version_id}
 * - versionKey 关闭（__v 不落库；不可变聚合无乐观锁字段）；created_time 手工维护
 *   （VERSION 聚合同步游标派生源：insert-only，插入即变更）
 */
@Schema({
  collection: 'dl_deck_version',
  versionKey: false,
  timestamps: false,
  minimize: false,
})
export class DeckVersion {
  /** 业务主键（雪花串，common/utils/snowflake nextId()） */
  @Prop({ required: true })
  version_id!: string;

  /** 归属创作物（跨聚合引用，dl_deck.deck_id） */
  @Prop({ required: true })
  deck_id!: string;

  /** 谱系内序号（deck 维度自增，展示用；分配=事务内 MAX+1，api-version §4.5） */
  @Prop({ required: true })
  version_seq!: number;

  /** 分支名（首版=main；INV-12 同 deck 唯一，uk_deck_branch 兜底） */
  @Prop({ required: true })
  branch_name!: string;

  /** 父版本（首版为空；INV-13 非空必须同 deck 存在；显式 type——可空联合不参与元数据推断） */
  @Prop({ type: String })
  parent_version_id?: string | null;

  /** 来源：VersionSourceType（FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST，无 OUTLINE） */
  @Prop({ required: true })
  source_type!: string;

  /** 来源任务（dl_generation_task.task_id；fork 复制行沿用源版本任务） */
  @Prop({ required: true })
  task_id!: string;

  /** 来源指令/入参快照（整体嵌入 Mixed；含 scope/brand/assetIds/outline 快照） */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  instruction_snapshot!: Record<string, unknown>;

  /** 页面树快照（整体嵌入 Mixed：pages[]→blocks[]，契约见 api-version §4.1） */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  content!: Record<string, unknown>;

  /** content SHA-256（hex 小写 64 位；对比加速/一致性校验，canonical 序列化） */
  @Prop({ required: true })
  content_hash!: string;

  /** 页数（冗余，树浏览列表免解析 content） */
  @Prop({ required: true })
  page_count!: number;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Prop({ required: true })
  user_id!: string;

  /** 创建人 ID（审计，=user_id；不可变聚合仅 created 三项；显式 type——可空联合） */
  @Prop({ type: String })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，与 deck 域口径一致） */
  @Prop({ type: String })
  created_name?: string | null;

  /** 创建时间（审计；VERSION 聚合同步游标派生源；显式 type——可空联合） */
  @Prop({ type: Date })
  created_time?: Date | null;
}

export const DeckVersionSchema = SchemaFactory.createForClass(DeckVersion);

/* 索引声明（api-version §5.3 索引表，3 项契约冻结） */
DeckVersionSchema.index({ version_id: 1 }, { unique: true, name: 'uk_version_id' });
DeckVersionSchema.index(
  { deck_id: 1, branch_name: 1, version_seq: 1 },
  { unique: true, name: 'uk_deck_branch' },
);
DeckVersionSchema.index({ deck_id: 1, parent_version_id: 1 }, { name: 'idx_deck_parent' });

export type DeckVersionDocument = HydratedDocument<DeckVersion>;

/** Mongoose model 注册名（MongooseModule.forFeature / @InjectModel 用） */
export const DECK_VERSION_MODEL = 'DeckVersion';
