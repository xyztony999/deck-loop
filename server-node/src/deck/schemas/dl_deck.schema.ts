import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { DeleteSign } from '../../common/enums';

/**
 * 创作物聚合根 — dl_deck collection（api-deck §5.3，22 字段与 v1 列逐字平移）。
 *
 * - `_id` ObjectId 仅存储层内部使用，不进 VO（NR-08）；业务主键 deck_id（雪花串，唯一索引）
 * - 嵌入：draft_outline=object（大纲节点树，无独立生命周期值对象整体嵌入；
 *   由 generation 域经 DeckDomainService#updateDraftOutline 定向写入）
 * - 引用（仅存业务 id）：default_brand_kit_id / current_version_id / final_version_id
 *   （跨聚合指针，INV-1/INV-2 应用层守卫）
 * - 更新语义：可更新文档；data_version 乐观锁（$inc）；delete_sign 逻辑删除（查询默认 0）
 * - 索引（schema 声明式创建，06 §3.5）：uk_deck_id{unique}、
 *   idx_user_status{user_id,deck_status,delete_sign}、idx_user_updated{user_id,updated_time}
 * - 字段名沿契约 snake_case（§5.3 字段清单=v1 列平移，跨 collection 只读统计同口径）
 * - versionKey 关闭（__v 不落库；乐观锁由 data_version 承载）；审计/时间字段手工维护
 *   （updated_time 为多端同步游标派生源，必须随每次写推进）
 */
@Schema({
  collection: 'dl_deck',
  versionKey: false,
  timestamps: false,
  minimize: false,
})
export class Deck {
  /** 业务主键（雪花串，common/utils/snowflake nextId()） */
  @Prop({ required: true })
  deck_id!: string;

  /** 规则编码：DL+yyMMdd+4 位序列（业务表 MAX+1，事务内取号） */
  @Prop({ required: true })
  deck_code!: string;

  /** 名称（INV-5：非空 ≤100） */
  @Prop({ required: true })
  deck_name!: string;

  /** 类型：DeckType（首期仅 DECK） */
  @Prop({ required: true })
  deck_type!: string;

  /** 主题（INV-5：非空 ≤200） */
  @Prop({ required: true })
  topic!: string;

  /** 需求描述（可空） */
  @Prop({ type: String })
  requirement?: string | null;

  /** 状态：DeckStatus（DRAFT/ITERATING/FINALIZED/ARCHIVED，api-deck §4.2 状态机） */
  @Prop({ required: true })
  deck_status!: string;

  /** 草稿大纲（节点树整体嵌入，Mixed；首个版本生成后转只读） */
  @Prop({ type: MongooseSchema.Types.Mixed })
  draft_outline?: Record<string, unknown> | null;

  /** 默认品牌规范（跨聚合引用，启用态，INV-7） */
  @Prop({ type: String })
  default_brand_kit_id?: string | null;

  /** 当前版本指针（DRAFT 态为空；INV-1 归属守卫在 DeckDomainService#movePointer） */
  @Prop({ type: String })
  current_version_id?: string | null;

  /** 活动分支（默认 main；INV-6 同 deck 内唯一） */
  @Prop({ required: true, default: 'main' })
  active_branch!: string;

  /** 定稿版本（FINALIZED 必有值，INV-2；解锁后保留作最近定稿记录） */
  @Prop({ type: String })
  final_version_id?: string | null;

  /** 归档前状态（restore 恢复目标） */
  @Prop({ type: String })
  archived_from_status?: string | null;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Prop({ required: true })
  user_id!: string;

  /** 创建人 ID（审计，=user_id） */
  @Prop({ type: String })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，见域报告缺口） */
  @Prop({ type: String })
  created_name?: string | null;

  /** 创建时间（审计） */
  @Prop({ type: Date })
  created_time?: Date | null;

  /** 最后修改人 ID（审计） */
  @Prop({ type: String })
  updated_by?: string | null;

  /** 最后修改人姓名（审计；同 created_name 兜底） */
  @Prop({ type: String })
  updated_name?: string | null;

  /** 最后修改时间（审计；多端同步游标派生源，每次写推进） */
  @Prop({ type: Date })
  updated_time?: Date | null;

  /** 乐观锁版本号（条件更新 filter 携带期望值 + $inc 推进） */
  @Prop({ required: true, default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（DeleteSign.NOT_DELETED），1-已删除（查询默认过滤 0） */
  @Prop({ required: true, default: DeleteSign.NOT_DELETED })
  delete_sign!: number;
}

export const DeckSchema = SchemaFactory.createForClass(Deck);

/* 索引声明（api-deck §5.3 索引表） */
DeckSchema.index({ deck_id: 1 }, { unique: true, name: 'uk_deck_id' });
DeckSchema.index(
  { user_id: 1, deck_status: 1, delete_sign: 1 },
  { name: 'idx_user_status' },
);
DeckSchema.index({ user_id: 1, updated_time: 1 }, { name: 'idx_user_updated' });

export type DeckDocument = HydratedDocument<Deck>;

/** Mongoose model 注册名（MongooseModule.forFeature / @InjectModel 用） */
export const DECK_MODEL = 'Deck';
