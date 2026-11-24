import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { DeleteSign } from '../common/enums';
import { Result } from '../common/result';
import { BizException } from '../common/exceptions';
import { escapeLike, isDuplicateKeyError, type TxSession } from '../common/persistence';
import { GenerationTask, type GenerationTaskDocument } from './schemas/dl_generation_task.schema';

/**
 * generation 域列表查询白名单输入（NR-02：AO 字段→查询字段的显式映射表专用类型）。
 */
export interface GenerationTaskListQueryInput {
  userId: string;
  deckId?: string | null;
  taskStatus?: string | null;
  taskType?: string | null;
  createdTimeStart?: Date | null;
  createdTimeEnd?: Date | null;
  pageNum: number;
  pageSize: number;
}

/**
 * 状态机条件更新参数（filter 固定 = task_id + task_status IN 期望前置状态（幂等键）
 * + 可选 user_id 属主隔离；update = SET（业务字段 + updated_* 审计））。
 */
export interface TaskConditionalAdvanceInput {
  taskId: string;
  expectedStatuses: string[];
  targetStatus: string;
  setFields?: Record<string, unknown>;
  userId?: string;
  updatedBy?: string;
  session?: TxSession;
}

/**
 * 生成任务聚合根仓储（dl_generation_task，v1 GenerationTaskMapper 对齐；ADR-016 TypeORM）。
 *
 * 仓储契约（api-generation §4.5）：
 * - 任务互斥创建：insert（事务内存在性校验 INV-8，countActiveTasks）
 * - 终态幂等更新：conditionalAdvanceStatus（filter 含前置状态；0 行=已被取消/并发推进）
 * - 分页查询：pageList（AO→查询字段白名单映射，offset/limit）
 *
 * 与 platform 侧 GenerationTaskCoreRepository 同表共治（D1）：两写路径均以
 * 「task_id + 期望前置状态」条件更新互斥，不经 data_version 乐观锁。
 */
@Injectable()
export class GenerationTaskRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /* ------------------------------------------------------------------ */
  /* 写路径                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * 插入任务（创建链唯一写路径；task_id/task_code/审计由调用方组装）。
   * uk_task_code 唯一索引兜底并发取号：23505 映射可重试冲突。
   */
  async insert(task: GenerationTask, session?: TxSession): Promise<GenerationTaskDocument> {
    try {
      await this.manager(session).getRepository(GenerationTask).insert(task);
      return task;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BizException(Result.CODE_FAIL, '任务编码取号冲突，请重试');
      }
      throw error;
    }
  }

  /**
   * 状态机条件推进（终态/取消统一入口，幂等键=taskId+期望前置状态）：
   * SET task_status + 附加业务字段 + updated_* 审计 + updated_time（同步游标推进）。
   *
   * @returns true=推进成功；false=0 行（前置状态已变/不存在），由调用方解释
   */
  async conditionalAdvanceStatus(input: TaskConditionalAdvanceInput): Promise<boolean> {
    const updatedBy = input.updatedBy ?? input.userId ?? '';
    const setFields: Record<string, unknown> = {
      ...(input.setFields ?? {}),
      task_status: input.targetStatus,
      updated_by: updatedBy,
      updated_name: updatedBy,
      updated_time: new Date(),
    };
    const qb = this.manager(input.session)
      .getRepository(GenerationTask)
      .createQueryBuilder()
      .update(GenerationTask)
      .set(setFields)
      .where('task_id = :taskId', { taskId: input.taskId })
      .andWhere('delete_sign = :ds', { ds: DeleteSign.NOT_DELETED })
      .andWhere('task_status IN (:...statuses)', { statuses: input.expectedStatuses });
    if (input.userId != null && input.userId.length > 0) {
      qb.andWhere('user_id = :userId', { userId: input.userId });
    }
    const result = await qb.execute();
    return result.affected === 1;
  }

  /* ------------------------------------------------------------------ */
  /* INV-8 互斥 / GT 取号（创建链事务内）                                 */
  /* ------------------------------------------------------------------ */

  /**
   * INV-8 互斥校验：deck 当前非终态（QUEUED/RUNNING）任务数。
   * 事务内存在性校验 + 同事务插入收窄并发窗口。
   */
  async countActiveTasks(deckId: string, statuses: string[], session?: TxSession): Promise<number> {
    if (statuses.length === 0) {
      return 0;
    }
    const placeholders = statuses.map((_, i) => `$${i + 2}`).join(',');
    const rows = await this.manager(session).query(
      `SELECT COUNT(*)::int AS cnt FROM dl_generation_task WHERE deck_id = $1 AND delete_sign = 0 AND task_status IN (${placeholders})`,
      [deckId, ...statuses],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /**
   * 规则编码取号：当日前缀下最大 task_code（事务内读 + 同事务插入收窄并发窗口，
   * uk_task_code 唯一索引兜底）。
   */
  async findMaxTaskCode(prefix: string, session?: TxSession): Promise<string | null> {
    const rows = await this.manager(session).query(
      `SELECT task_code FROM dl_generation_task WHERE task_code LIKE $1 ORDER BY task_code DESC LIMIT 1`,
      [`${escapeLike(prefix)}%`],
    );
    const row = rows[0];
    return row != null && typeof row.task_code === 'string' ? row.task_code : null;
  }

  /* ------------------------------------------------------------------ */
  /* 读路径                                                              */
  /* ------------------------------------------------------------------ */

  /** 业务主键点查（回调线程/进程内读取，不做属主过滤——v1 getById 语义） */
  findById(taskId: string, session?: TxSession): Promise<GenerationTaskDocument | null> {
    return this.manager(session).getRepository(GenerationTask).findOne({
      where: { task_id: taskId, delete_sign: DeleteSign.NOT_DELETED },
    });
  }

  /** 属主加载（user_id 隔离；detail/cancel/retry 入口） */
  findByIdOwned(taskId: string, userId: string): Promise<GenerationTaskDocument | null> {
    return this.dataSource.getRepository(GenerationTask).findOne({
      where: { task_id: taskId, user_id: userId, delete_sign: DeleteSign.NOT_DELETED },
    });
  }

  /** 批量属主加载（progress 轮询；taskIds 为服务端去重后 ID 集合） */
  async findByIdsOwned(userId: string, taskIds: string[]): Promise<GenerationTaskDocument[]> {
    if (taskIds.length === 0) {
      return [];
    }
    return this.dataSource
      .getRepository(GenerationTask)
      .createQueryBuilder('t')
      .where('t.user_id = :userId', { userId })
      .andWhere('t.delete_sign = :ds', { ds: DeleteSign.NOT_DELETED })
      .andWhere('t.task_id IN (:...ids)', { ids: taskIds })
      .getMany();
  }

  /**
   * 分页查询（白名单映射固定于此）。排序 created_time desc + task_id desc（稳定排序）。
   */
  async pageList(
    input: GenerationTaskListQueryInput,
  ): Promise<{ records: GenerationTaskDocument[]; total: number }> {
    const pageNum = Number.isInteger(input.pageNum) && input.pageNum >= 1 ? input.pageNum : 1;
    const pageSize = Number.isInteger(input.pageSize) && input.pageSize >= 1 ? input.pageSize : 20;
    const repo = this.dataSource.getRepository(GenerationTask);
    const recordsQb = this.applyListFilter(repo.createQueryBuilder('t'), input)
      .orderBy('t.created_time', 'DESC')
      .addOrderBy('t.task_id', 'DESC')
      .skip((pageNum - 1) * pageSize)
      .take(pageSize);
    const totalQb = this.applyListFilter(repo.createQueryBuilder('t'), input);
    const [records, total] = await Promise.all([recordsQb.getMany(), totalQb.getCount()]);
    return { records, total };
  }

  /** 构造列表 filter（固定白名单映射，请求体键名不进 filter；userId 服务端注入 NR-05） */
  private applyListFilter(
    qb: SelectQueryBuilder<GenerationTask>,
    input: GenerationTaskListQueryInput,
  ): SelectQueryBuilder<GenerationTask> {
    qb.where('t.user_id = :userId', { userId: input.userId })
      .andWhere('t.delete_sign = :ds', { ds: DeleteSign.NOT_DELETED });
    if (this.isNotBlank(input.deckId)) {
      qb.andWhere('t.deck_id = :deckId', { deckId: input.deckId! });
    }
    if (this.isNotBlank(input.taskStatus)) {
      qb.andWhere('t.task_status = :taskStatus', { taskStatus: input.taskStatus! });
    }
    if (this.isNotBlank(input.taskType)) {
      qb.andWhere('t.task_type = :taskType', { taskType: input.taskType! });
    }
    if (input.createdTimeStart != null) {
      qb.andWhere('t.created_time >= :cts', { cts: input.createdTimeStart });
    }
    if (input.createdTimeEnd != null) {
      qb.andWhere('t.created_time <= :cte', { cte: input.createdTimeEnd });
    }
    return qb;
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}