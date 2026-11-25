import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { DeleteSign } from '../../common/enums';
import { JSON_COLUMN_TYPE, TIMESTAMP_COLUMN_TYPE } from '../../common/db-column-types';

/**
 * 生成任务聚合根（子流程）— dl_generation_task（api-generation §5.3，22 字段与 v1 列
 * 逐字平移；四类 taskType 共用，adjustment 域 C-03 同表写入；ADR-016 TypeORM entity）。
 *
 * - 业务主键 task_id（雪花串）= 表主键（取代 ObjectId，NR-08 无 _id 暴露面）
 * - 嵌入：instruction_snapshot=jsonb（入参/指令快照整体嵌入，含 adjust 节值对象
 *   ——api-adjustment §4.1；不可变快照，创建链一次写入）
 * - 引用（仅存业务 id）：deck_id / base_version_id / result_version_id（跨聚合引用；
 *   不变量「SUCCEEDED ⇔ result_version_id 非空」由成功回调的原子条件更新保证）
 * - 快照语义：channel_code/model_code 为路由快照 string（非解引用，D2 可追溯）
 * - 更新语义：状态推进=条件 UPDATE（filter 含 task_id + user_id（可选）+ 前置状态，
 *   幂等键=taskId+期望前置状态，api-generation §4.3）；不用 data_version 乐观锁承载
 *   状态推进（与网关侧 GenerationTaskCore 条件更新互不踩版本，D1 同表共治）
 * - INV-8 互斥（同 deck 至多 1 个非终态任务）=事务内存在性查询（仓储承载）
 * - 索引（entity 声明式，06 §3.5）：uk_task_code{unique}（GT 取号并发兜底）、
 *   idx_deck_status{deck_id,task_status}、idx_user_created{user_id,created_time}；
 *   task_id 主键即唯一。platform 侧 GenerationTaskCore 同表只读投影不声明索引（ADR-016）
 * - updated_time 手工维护（TASK 同步扫描游标派生源，必须随每次写推进）；delete_sign 保留统一模板
 */
@Entity('dl_generation_task')
@Index('uk_task_code', ['task_code'], { unique: true })
@Index('idx_gentask_deck_status', ['deck_id', 'task_status'])
@Index('idx_gentask_user_created', ['user_id', 'created_time'])
export class GenerationTask {
  /** 业务主键（雪花串，common/utils/snowflake nextId()；provider 调用幂等键） */
  @PrimaryColumn({ type: 'varchar' })
  task_id!: string;

  /** 规则编码：GT+yyMMdd+4 位序列（业务表 MAX+1，事务内取号；uk_task_code 兜底并发） */
  @Column({ type: 'varchar' })
  task_code!: string;

  /** 归属创作物（跨聚合引用，dl_deck.deck_id） */
  @Column({ type: 'varchar' })
  deck_id!: string;

  /** 任务类型：TaskType（OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST） */
  @Column({ type: 'varchar' })
  task_type!: string;

  /** 基线版本（跨聚合引用；OUTLINE 空；调整类任务=调整起点版本） */
  @Column({ type: 'varchar', nullable: true })
  base_version_id?: string | null;

  /** 入参/指令快照（整体嵌入 jsonb；大纲快照/指令/scope/brandKitId/assetIds/usedTemplateIds/lengthOption） */
  // jsonb 不透明 blob 用 Record<string, any>：TypeORM _QueryDeepPartialEntity 对 unknown 值不可赋值
  @Column({ type: JSON_COLUMN_TYPE })
  instruction_snapshot!: Record<string, any>;

  /** 路由快照：渠道编码（D2，偏好变更不影响在途任务审计） */
  @Column({ type: 'varchar' })
  channel_code!: string;

  /** 路由快照：模型编码 */
  @Column({ type: 'varchar' })
  model_code!: string;

  /** 任务状态：TaskStatus（QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED，api-generation §4.2） */
  @Column({ type: 'varchar' })
  task_status!: string;

  /** 成功产物版本（跨聚合引用；SUCCEEDED 必有值——不变量「SUCCEEDED ⇔ result_version_id 非空」） */
  @Column({ type: 'varchar', nullable: true })
  result_version_id?: string | null;

  /** 失败摘要（≤512，DDL VARCHAR(512) 对齐） */
  @Column({ type: 'varchar', nullable: true })
  error_msg?: string | null;

  /** 用量计量：输入 token（网关回填） */
  @Column({ type: 'int', nullable: true })
  prompt_tokens?: number | null;

  /** 用量计量：输出 token（网关回填） */
  @Column({ type: 'int', nullable: true })
  completion_tokens?: number | null;

  /** 属主（隔离字段，ADR-005；服务端注入，永不取信客户端 NR-05） */
  @Column({ type: 'varchar' })
  user_id!: string;

  /** 乐观锁版本号（统一模板保留；终态/取消推进一律走条件更新，不经此列） */
  @Column({ type: 'int', default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（DeleteSign.NOT_DELETED），1-已删除（保留统一模板，子流程级无删除需求） */
  @Column({ type: 'int', default: DeleteSign.NOT_DELETED })
  delete_sign!: number;

  /** 创建人 ID（审计，=user_id） */
  @Column({ type: 'varchar', nullable: true })
  created_by?: string | null;

  /** 创建人姓名（审计；AuthPrincipal 无昵称位，暂以 userId 兜底，与 deck/version 域同口径） */
  @Column({ type: 'varchar', nullable: true })
  created_name?: string | null;

  /** 创建时间（审计；列表排序键） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  created_time?: Date | null;

  /** 最后修改人 ID（审计） */
  @Column({ type: 'varchar', nullable: true })
  updated_by?: string | null;

  /** 最后修改人姓名（审计；同 created_name 兜底） */
  @Column({ type: 'varchar', nullable: true })
  updated_name?: string | null;

  /** 最后修改时间（审计；TASK 聚合同步游标派生源，每次写推进） */
  @Column({ type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  updated_time?: Date | null;
}

/** 文档类型别名（ADR-016：TypeORM entity 即行类型；保留旧名以兼容服务层 import） */
export type GenerationTaskDocument = GenerationTask;