import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * 生成任务表（dl_generation_task）的**网关侧精简映射**（api-platform 决策 D1 同表共治）。
 *
 * 完整聚合建模在 generation 域（api-generation §4.1，模型名 GenerationTask）；
 * platform 网关仅推进状态（QUEUED→RUNNING、编排崩溃兜底 FAILED）与计量回填
 * （prompt_tokens/completion_tokens），因此本模型只声明网关读写的列：
 *
 * - 不声明唯一/复合索引——dl_generation_task 索引归 generation 域全量 schema 声明
 *   （uk_task_id 等），两个模型同 collection 共存、互不重复建索引；
 * - task_id 非唯一声明：网关从不 insert（任务由 generation 域创建）；
 * - instruction_snapshot/result_version_id 等业务列不声明——归 generation 域写；
 * - 状态推进采用「task_id + 期望前置状态」条件更新实现幂等
 *   （api-generation §4.3 幂等键约定），不使用 data_version 乐观锁（避免与
 *   generation 域实体版本互踩——v1 GenerationTaskCoreEntity 同语义）；
 * - TASK 同步扫描（GenerationTaskSyncScanner）复用本模型读取
 *   （updated_time+task_id 升序，06 §3.6 复合游标）。
 */
@Schema({ collection: 'dl_generation_task', versionKey: false, timestamps: false })
export class GenerationTaskCore {
  /** 主键（generation 域生成；网关只读/条件更新；provider 调用幂等键） */
  @Prop({ type: String, required: true })
  task_id!: string;

  /** 归属创作物（SSE deckId 过滤用） */
  @Prop({ type: String })
  deck_id?: string;

  /** 任务类型：TaskType（适配器方法分派） */
  @Prop({ type: String })
  task_type?: string;

  /** 路由快照：渠道编码 */
  @Prop({ type: String })
  channel_code?: string;

  /** 路由快照：模型编码 */
  @Prop({ type: String })
  model_code?: string;

  /** 任务状态：TaskStatus（QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED） */
  @Prop({ type: String })
  task_status?: string;

  /** 失败摘要（正常路径由 generation 编排写；网关仅回调编排崩溃时兜底写） */
  @Prop({ type: String })
  error_msg?: string;

  /** 用量计量：输入 token（网关回填） */
  @Prop({ type: Number })
  prompt_tokens?: number;

  /** 用量计量：输出 token（网关回填） */
  @Prop({ type: Number })
  completion_tokens?: number;

  /** 属主（隔离字段，ADR-005；SSE 定向推送/用量入账/同步扫描过滤用） */
  @Prop({ type: String })
  user_id?: string;

  /** 最后更新时间（同步游标派生源，毫秒精度不截断——06 §3.6） */
  @Prop({ type: Date })
  updated_time?: Date;

  /** 逻辑删除标记（TASK 扫描器 DELETE 型变更判定） */
  @Prop({ type: Number })
  delete_sign?: number;
}

export type GenerationTaskCoreDocument = HydratedDocument<GenerationTaskCore>;

export const GenerationTaskCoreSchema = SchemaFactory.createForClass(GenerationTaskCore);
// 有意不声明任何业务索引：dl_generation_task 索引由 generation 域全量 schema 负责
