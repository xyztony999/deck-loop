import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, FilterQuery, Model } from 'mongoose';
import { DeleteSign } from '../common/enums';
import { Result } from '../common/result';
import { BizException } from '../common/exceptions';
import {
  GENERATION_TASK_MODEL,
  type GenerationTask,
  type GenerationTaskDocument,
} from './schemas/dl_generation_task.schema';

/**
 * generation 域列表查询白名单输入（NR-02：AO 字段→查询字段的显式映射表专用类型；
 * 请求体键名不得成为 filter/sort/projection 键——字段与 collection 字段一一对应，
 * 由 repository 内固定映射，Service 只传值）。
 */
export interface GenerationTaskListQueryInput {
  userId: string;
  /** 归属创作物精确匹配（deck_id） */
  deckId?: string | null;
  /** 状态精确匹配（TaskStatus code → task_status） */
  taskStatus?: string | null;
  /** 类型精确匹配（TaskType code → task_type） */
  taskType?: string | null;
  /** 创建时间起（服务端已解析为 Date → created_time） */
  createdTimeStart?: Date | null;
  /** 创建时间止 */
  createdTimeEnd?: Date | null;
  pageNum: number;
  pageSize: number;
}

/**
 * 状态机条件更新参数（filter 固定 = task_id + task_status $in 期望前置状态（幂等键，
 * api-generation §4.3）+ 可选 user_id 属主隔离；update = $set（业务字段 + updated_* 审计））。
 */
export interface TaskConditionalAdvanceInput {
  taskId: string;
  /** 期望前置状态集合（幂等键：QUEUED/RUNNING→CANCELLED、RUNNING→SUCCEEDED/FAILED） */
  expectedStatuses: string[];
  /** 目标状态（TaskStatus code） */
  targetStatus: string;
  /** $set 附加业务字段（result_version_id / error_msg 等，snake_case 白名单由调用方构造） */
  setFields?: Record<string, unknown>;
  /** 属主隔离（用户操作路径传入；回调线程已按 task 属主加载，可不传） */
  userId?: string;
  /** 审计：操作人（默认取 userId，回调线程取 task.user_id） */
  updatedBy?: string;
  session?: ClientSession;
}

/**
 * 生成任务聚合根仓储（dl_generation_task，v1 GenerationTaskMapper 对齐）。
 *
 * 仓储契约（api-generation §4.5）：
 * - 任务互斥创建：insertOne（多文档事务内存在性校验 INV-8，countActiveTasks）
 * - 终态幂等更新：conditionalAdvanceStatus（filter 含前置状态；0 行=已被取消/并发推进）
 * - 分页查询：pageList（AO→查询字段白名单映射，skip/limit）
 *
 * 与 platform 侧 GenerationTaskCoreRepository 同表共治（D1）：网关推进
 * QUEUED→RUNNING/兜底 FAILED/计量回填；本仓储承载创建插入与终态/取消推进，
 * 两写路径均以「task_id + 期望前置状态」条件更新互斥，不经 data_version 乐观锁。
 */
@Injectable()
export class GenerationTaskRepository {
  constructor(
    @InjectModel(GENERATION_TASK_MODEL)
    private readonly taskModel: Model<GenerationTaskDocument>,
  ) {}

  /* ------------------------------------------------------------------ */
  /* 写路径                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * 插入任务（创建链唯一写路径；task_id/task_code/审计由调用方组装）。
   * uk_task_code 唯一索引兜底并发取号（同前缀 MAX+1 竞态）：E11000 映射可重试冲突。
   */
  async insert(task: GenerationTask, session?: ClientSession): Promise<GenerationTaskDocument> {
    try {
      const [created] = await this.taskModel.create([task], { session });
      return created;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BizException(Result.CODE_FAIL, '任务编码取号冲突，请重试');
      }
      throw error;
    }
  }

  /**
   * 状态机条件推进（终态/取消统一入口，幂等键=taskId+期望前置状态）：
   * $set task_status + 附加业务字段 + updated_* 审计 + updated_time（同步游标推进）。
   *
   * @returns true=推进成功；false=0 行（前置状态已变/不存在），由调用方解释
   */
  async conditionalAdvanceStatus(input: TaskConditionalAdvanceInput): Promise<boolean> {
    const filter: FilterQuery<GenerationTaskDocument> = {
      task_id: input.taskId,
      delete_sign: DeleteSign.NOT_DELETED,
      task_status: { $in: input.expectedStatuses },
    };
    if (input.userId != null && input.userId.length > 0) {
      filter.user_id = input.userId;
    }
    const now = new Date();
    const updatedBy = input.updatedBy ?? input.userId ?? '';
    const result = await this.taskModel.updateOne(
      filter,
      {
        $set: {
          ...input.setFields,
          task_status: input.targetStatus,
          updated_by: updatedBy,
          updated_name: updatedBy,
          updated_time: now,
        },
      },
      { session: input.session },
    );
    return result.matchedCount === 1;
  }

  /* ------------------------------------------------------------------ */
  /* INV-8 互斥 / GT 取号（创建链事务内）                                 */
  /* ------------------------------------------------------------------ */

  /**
   * INV-8 互斥校验：deck 当前非终态（QUEUED/RUNNING）任务数。
   * v1 countActiveTasksForUpdate（FOR UPDATE）对齐：Mongo 事务快照读 + 同事务插入
   * 收窄并发窗口（「检查-插入」竞态由 idx_deck_status 扫描 + 事务序列化兜底）。
   */
  countActiveTasks(deckId: string, statuses: string[], session?: ClientSession): Promise<number> {
    return this.taskModel
      .countDocuments(
        { deck_id: deckId, task_status: { $in: statuses }, delete_sign: DeleteSign.NOT_DELETED },
        { session },
      )
      .exec();
  }

  /**
   * 规则编码取号：当日前缀下最大 task_code（v1 selectMaxTaskCodeForUpdate 对齐；
   * Mongo 事务快照读 + 同事务插入收窄并发窗口，uk_task_code 唯一索引兜底）。
   */
  async findMaxTaskCode(prefix: string, session?: ClientSession): Promise<string | null> {
    const row = await this.taskModel
      .findOne(
        { task_code: { $regex: `^${escapeRegex(prefix)}` } },
        { task_code: 1, _id: 0 },
      )
      .sort({ task_code: -1 })
      .session(session ?? null)
      .lean<{ task_code?: string }>()
      .exec();
    return row != null && typeof row.task_code === 'string' ? row.task_code : null;
  }

  /* ------------------------------------------------------------------ */
  /* 读路径                                                              */
  /* ------------------------------------------------------------------ */

  /** 业务主键点查（回调线程/进程内读取，不做属主过滤——v1 getById 语义，调用方自行保证上下文） */
  findById(taskId: string, session?: ClientSession): Promise<GenerationTaskDocument | null> {
    return this.taskModel
      .findOne({ task_id: taskId, delete_sign: DeleteSign.NOT_DELETED })
      .session(session ?? null)
      .exec();
  }

  /** 属主加载（user_id 隔离；detail/cancel/retry 入口） */
  findByIdOwned(taskId: string, userId: string): Promise<GenerationTaskDocument | null> {
    return this.taskModel
      .findOne({ task_id: taskId, user_id: userId, delete_sign: DeleteSign.NOT_DELETED })
      .exec();
  }

  /** 批量属主加载（progress 轮询；taskIds 为服务端去重后 ID 集合） */
  findByIdsOwned(userId: string, taskIds: string[]): Promise<GenerationTaskDocument[]> {
    return this.taskModel
      .find({
        task_id: { $in: taskIds },
        user_id: userId,
        delete_sign: DeleteSign.NOT_DELETED,
      })
      .exec();
  }

  /**
   * 分页查询（白名单映射固定于此：deckId→deck_id、taskStatus→task_status、
   * taskType→task_type、timeRange→created_time）。
   * 排序 created_time desc + task_id desc（稳定排序，保证分页确定性；v1 orderByDesc 对齐）。
   */
  async pageList(
    input: GenerationTaskListQueryInput,
  ): Promise<{ records: GenerationTaskDocument[]; total: number }> {
    const filter = this.buildListFilter(input);
    const pageNum = Number.isInteger(input.pageNum) && input.pageNum >= 1 ? input.pageNum : 1;
    const pageSize = Number.isInteger(input.pageSize) && input.pageSize >= 1 ? input.pageSize : 20;
    const [records, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .sort({ created_time: -1, task_id: -1 })
        .skip((pageNum - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.taskModel.countDocuments(filter).exec(),
    ]);
    return { records, total };
  }

  /** 构造列表 filter（固定白名单映射，请求体键名不进 filter；userId 服务端注入 NR-05） */
  private buildListFilter(input: GenerationTaskListQueryInput): FilterQuery<GenerationTaskDocument> {
    const filter: FilterQuery<GenerationTaskDocument> = {
      user_id: input.userId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    if (this.isNotBlank(input.deckId)) {
      filter.deck_id = input.deckId!;
    }
    if (this.isNotBlank(input.taskStatus)) {
      filter.task_status = input.taskStatus!;
    }
    if (this.isNotBlank(input.taskType)) {
      filter.task_type = input.taskType!;
    }
    if (input.createdTimeStart != null) {
      filter.created_time = { $gte: input.createdTimeStart };
    }
    if (input.createdTimeEnd != null) {
      filter.created_time = {
        ...(filter.created_time as object | undefined),
        $lte: input.createdTimeEnd,
      };
    }
    return filter;
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}

/** 正则字面量转义（取号前缀固定为 GT+数字，防御性转义保持与 deck 域同口径） */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** E11000 重复键判定（鸭子类型判别，避免直接依赖 mongodb 包；version/asset 域同款） */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
