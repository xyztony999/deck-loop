import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { DeleteSign } from '../../common/enums';

/**
 * 导出任务聚合根 — dl_export_task collection（api-delivery §5.3，18 字段与 v1 列
 * 逐字平移，snake_case 契约口径）。
 *
 * - `_id` ObjectId 仅存储层内部使用，不进 VO（NR-08）；业务主键 export_id
 *   （雪花串，唯一索引）；SUCCEEDED 终态即「导出记录」（api-delivery §1.4）
 * - 子流程聚合（独立状态机 export_status：QUEUED→RENDERING→SUCCEEDED/FAILED；
 *   QUEUED/RENDERING→CANCELLED，api-delivery §4.2）；终态推进=条件 updateOne
 *   （filter 含前置状态，幂等键=exportId+前置状态）
 * - 不变量：INV-14 version_id 必须为该 deck 的 finalVersionId（提交时锚定）；
 *   INV-15 SUCCEEDED ⇔ file_key 非空（终态条件更新内保证）
 * - 引用（仅存业务 id）：deck_id / version_id（跨聚合引用）；file_key 指向
 *   对象存储（外部引用，D1）
 * - 更新语义：终态字段标量更新；data_version 乐观锁（$inc）；delete_sign 保留
 *   统一模板列（导出记录不删除）
 * - 索引（schema 声明式创建，api-delivery §5.3 索引表，3 项契约冻结）：
 *   uk_export_id{unique}、idx_deck{deck_id,export_status}、idx_user_created{user_id,created_time}
 * - versionKey 关闭（__v 不落库）；审计/时间字段手工维护（updated_time 为 EXPORT
 *   聚合同步游标派生源，提交/状态推进/取消均须触碰）
 */
@Schema({
  collection: 'dl_export_task',
  versionKey: false,
  timestamps: false,
  minimize: false,
})
export class ExportTask {
  /** 业务主键（雪花串，common/utils/snowflake nextId()） */
  @Prop({ required: true })
  export_id!: string;

  /** 规则编码：EX+yyMMdd+4 位序列（业务表 MAX+1 取号，事务内与插入同事务） */
  @Prop({ required: true })
  export_code!: string;

  /** 归属创作物（跨聚合引用，dl_deck.deck_id） */
  @Prop({ required: true })
  deck_id!: string;

  /** 来源定稿版本（INV-14：=提交时 Deck.final_version_id） */
  @Prop({ required: true })
  version_id!: string;

  /** 导出格式：ExportFormat（PDF/IMAGES/PPTX） */
  @Prop({ required: true })
  export_format!: string;

  /** 导出状态：ExportStatus（QUEUED/RENDERING/SUCCEEDED/FAILED/CANCELLED） */
  @Prop({ required: true })
  export_status!: string;

  /** 产物对象存储 key（INV-15：SUCCEEDED 必有；显式 type——可空联合不参与元数据推断） */
  @Prop({ type: String })
  file_key?: string | null;

  /** 产物大小（字节；未成功为 null。v1 BIGINT→number，产物字节数恒在 JS 安全整数内） */
  @Prop({ type: Number })
  file_size?: number | null;

  /** 失败摘要（FAILED 终态填写，≤512） */
  @Prop({ type: String })
  error_msg?: string | null;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Prop({ required: true })
  user_id!: string;

  /** 创建人 ID（审计，=user_id） */
  @Prop({ type: String })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，与 deck 域口径一致） */
  @Prop({ type: String })
  created_name?: string | null;

  /** 创建时间（审计） */
  @Prop({ type: Date })
  created_time?: Date | null;

  /** 最后修改人 ID（审计，=user_id；系统回调推进时同 user_id） */
  @Prop({ type: String })
  updated_by?: string | null;

  /** 最后修改人姓名（审计；同 created_name 兜底） */
  @Prop({ type: String })
  updated_name?: string | null;

  /** 最后修改时间（审计；EXPORT 聚合同步游标派生源，每次写推进） */
  @Prop({ type: Date })
  updated_time?: Date | null;

  /** 乐观锁版本号（条件更新 $inc 推进） */
  @Prop({ required: true, default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（导出记录不删除，保留统一模板列） */
  @Prop({ required: true, default: DeleteSign.NOT_DELETED })
  delete_sign!: number;
}

export const ExportTaskSchema = SchemaFactory.createForClass(ExportTask);

/* 索引声明（api-delivery §5.3 索引表，3 项契约冻结） */
ExportTaskSchema.index({ export_id: 1 }, { unique: true, name: 'uk_export_id' });
ExportTaskSchema.index({ deck_id: 1, export_status: 1 }, { name: 'idx_deck' });
ExportTaskSchema.index({ user_id: 1, created_time: 1 }, { name: 'idx_user_created' });

export type ExportTaskDocument = HydratedDocument<ExportTask>;

/** Mongoose model 注册名（MongooseModule.forFeature / @InjectModel 用） */
export const EXPORT_TASK_MODEL = 'ExportTask';
