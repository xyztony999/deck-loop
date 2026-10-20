import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';
import { DeleteSign } from '../../common/enums';

/**
 * 生成任务聚合根（子流程）— dl_generation_task collection（api-generation §5.3，
 * 22 字段与 v1 列逐字平移；四类 taskType 共用，adjustment 域 C-03 同表写入）。
 *
 * - `_id` ObjectId 仅存储层内部使用，不进 VO（NR-08）；业务主键 task_id（雪花串，唯一索引）
 * - 嵌入：instruction_snapshot=object（入参/指令快照整体嵌入 Mixed，含 adjust 节值对象
 *   ——api-adjustment §4.1；不可变快照，创建链一次写入）
 * - 引用（仅存业务 id）：deck_id / base_version_id / result_version_id（跨聚合引用；
 *   不变量「SUCCEEDED ⇔ result_version_id 非空」由成功回调的原子条件更新保证）
 * - 快照语义：channel_code/model_code 为路由快照 string（非解引用，D2 可追溯）
 * - 更新语义：状态推进=条件 updateOne（filter 含 task_id + user_id（可选）+ 前置状态，
 *   幂等键=taskId+期望前置状态，api-generation §4.3）；不用 data_version 乐观锁承载
 *   状态推进（与网关侧 GenerationTaskCore 条件更新互不踩版本，D1 同表共治）
 * - INV-8 互斥（同 deck 至多 1 个非终态任务）=多文档事务内存在性查询（仓储承载）
 * - 索引（schema 声明式创建，06 §3.5）：uk_task_id{unique}、uk_task_code{unique}
 *   （GT 取号并发兜底）、idx_deck_status{deck_id,task_status}、idx_user_created
 *   {user_id,created_time}；platform 侧 GenerationTaskCore 同 collection 精简模型
 *   不声明索引（索引归本全量 schema，见该文件注释）
 * - versionKey 关闭（__v 不落库）；updated_time 手工维护（TASK 同步扫描游标派生源，
 *   必须随每次写推进）；delete_sign 保留统一模板（子流程级无删除需求）
 */
@Schema({
  collection: 'dl_generation_task',
  versionKey: false,
  timestamps: false,
  minimize: false,
})
export class GenerationTask {
  /** 业务主键（雪花串，common/utils/snowflake nextId()；provider 调用幂等键） */
  @Prop({ required: true })
  task_id!: string;

  /** 规则编码：GT+yyMMdd+4 位序列（业务表 MAX+1，事务内取号；uk_task_code 兜底并发） */
  @Prop({ required: true })
  task_code!: string;

  /** 归属创作物（跨聚合引用，dl_deck.deck_id） */
  @Prop({ required: true })
  deck_id!: string;

  /** 任务类型：TaskType（OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST） */
  @Prop({ required: true })
  task_type!: string;

  /** 基线版本（跨聚合引用；OUTLINE 空；调整类任务=调整起点版本） */
  @Prop({ type: String })
  base_version_id?: string | null;

  /** 入参/指令快照（整体嵌入 Mixed；大纲快照/指令/scope/brandKitId/assetIds/usedTemplateIds/lengthOption） */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  instruction_snapshot!: Record<string, unknown>;

  /** 路由快照：渠道编码（D2，偏好变更不影响在途任务审计） */
  @Prop({ required: true })
  channel_code!: string;

  /** 路由快照：模型编码 */
  @Prop({ required: true })
  model_code!: string;

  /** 任务状态：TaskStatus（QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED，api-generation §4.2） */
  @Prop({ required: true })
  task_status!: string;

  /** 成功产物版本（跨聚合引用；SUCCEEDED 必有值——不变量「SUCCEEDED ⇔ result_version_id 非空」） */
  @Prop({ type: String })
  result_version_id?: string | null;

  /** 失败摘要（≤512，DDL VARCHAR(512) 对齐） */
  @Prop({ type: String })
  error_msg?: string | null;

  /** 用量计量：输入 token（网关回填） */
  @Prop({ type: Number })
  prompt_tokens?: number | null;

  /** 用量计量：输出 token（网关回填） */
  @Prop({ type: Number })
  completion_tokens?: number | null;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Prop({ required: true })
  user_id!: string;

  /** 乐观锁版本号（统一模板保留；终态/取消推进一律走条件更新，不经此列） */
  @Prop({ required: true, default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（DeleteSign.NOT_DELETED），1-已删除（保留统一模板，子流程级无删除需求） */
  @Prop({ required: true, default: DeleteSign.NOT_DELETED })
  delete_sign!: number;

  /** 创建人 ID（审计，=user_id） */
  @Prop({ type: String })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，与 deck/version 域同口径） */
  @Prop({ type: String })
  created_name?: string | null;

  /** 创建时间（审计；列表排序键） */
  @Prop({ type: Date })
  created_time?: Date | null;

  /** 最后修改人 ID（审计） */
  @Prop({ type: String })
  updated_by?: string | null;

  /** 最后修改人姓名（审计；同 created_name 兜底） */
  @Prop({ type: String })
  updated_name?: string | null;

  /** 最后修改时间（审计；TASK 聚合同步游标派生源，每次写推进） */
  @Prop({ type: Date })
  updated_time?: Date | null;
}

export const GenerationTaskSchema = SchemaFactory.createForClass(GenerationTask);

/* 索引声明（api-generation §5.3 索引表 + uk_task_code 取号并发兜底） */
GenerationTaskSchema.index({ task_id: 1 }, { unique: true, name: 'uk_task_id' });
GenerationTaskSchema.index({ task_code: 1 }, { unique: true, name: 'uk_task_code' });
GenerationTaskSchema.index({ deck_id: 1, task_status: 1 }, { name: 'idx_deck_status' });
GenerationTaskSchema.index({ user_id: 1, created_time: 1 }, { name: 'idx_user_created' });

export type GenerationTaskDocument = HydratedDocument<GenerationTask>;

/** Mongoose model 注册名（MongooseModule.forFeature / @InjectModel 用；
 *  ≠ platform 侧 'GenerationTaskCore'——两模型同 collection 共存，索引归本模型声明） */
export const GENERATION_TASK_MODEL = 'GenerationTask';
