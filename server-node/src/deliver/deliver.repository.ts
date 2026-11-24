import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { DeleteSign, ExportStatus } from '../common/enums';
import { cursorCondition, inClause, toNumberOrNull, type CursorTiebreak, type TxSession } from '../common/persistence';
import { ExportTask, type ExportTaskDocument } from './schemas/dl_export_task.schema';

/**
 * deliver 域列表查询白名单输入（NR-02：AO 字段→查询字段的显式映射表专用类型）。
 */
export interface ExportListQueryInput {
  userId: string;
  deckId?: string | null;
  exportFormat?: string | null;
  exportStatus?: string | null;
  createdTimeStart?: Date | null;
  createdTimeEnd?: Date | null;
  pageNum: number;
  pageSize: number;
}

/** 状态机条件更新参数（filter 固定携带 export_status 期望前置集合，幂等键=exportId+前置状态） */
export interface ExportTransitionInput {
  exportId: string;
  fromStatuses: string[];
  toStatus: string;
  setFields?: Record<string, unknown>;
  operatorId: string;
}

/** EXPORT 聚合同步扫描行（投影，无 _id，NR-08） */
export interface ExportTaskSyncRow {
  export_id: string;
  deck_id?: string;
  version_id?: string;
  export_format?: string;
  export_status?: string;
  updated_time?: Date;
}

/** dl_deck 只读冗余行（列表 deckName / 下载附件名 deck_code；v1 DeckRefRow 对齐） */
export interface DeckRefRow {
  deckId: string;
  deckCode: string | null;
  deckName: string | null;
}

/** dl_deck_version 只读冗余行（versionSeq 冗余展示 / 附件名 seq / INV-14 防御校验） */
export interface VersionRefRow {
  versionId: string;
  versionSeq: number | null;
  deckId: string | null;
}

/**
 * 导出任务聚合根仓储（dl_export_task，v1 ExportTaskMapper + ExportQueryMapper 对齐；ADR-016 TypeORM）。
 *
 * - 提交（insert）/ 终态幂等更新（条件 UPDATE，前置状态守卫）/ 分页
 * - EX 取号：当日前缀下 MAX+1，事务内（session 透传，与插入同事务收窄并发窗口）
 * - 跨聚合只读冗余（deckName/deck_code/version_seq）：直查 dl_deck / dl_deck_version
 *   只读投影；findDeckRefs 不带 delete_sign 过滤（软删 deck 历史导出行仍回显名称，v1 口径）
 * - file_size bigint → number 归一（JS 安全整数内）
 */
@Injectable()
export class ExportTaskRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /** bigint file_size 归一为 number（TypeORM bigint 列返回 string） */
  private normalize(task: ExportTaskDocument | null): ExportTaskDocument | null {
    if (task != null) {
      task.file_size = toNumberOrNull(task.file_size);
    }
    return task;
  }

  /* ------------------------------------------------------------------ */
  /* 写路径                                                              */
  /* ------------------------------------------------------------------ */

  /** 插入（提交；雪花 id/export_code/审计字段由调用方组装） */
  async insert(task: ExportTask, session?: TxSession): Promise<ExportTaskDocument> {
    await this.manager(session).getRepository(ExportTask).insert(task);
    return task;
  }

  /**
   * 状态机条件终态更新（幂等键=exportId+前置状态）：
   * filter = export_id + delete_sign=0 + export_status IN 期望前置；
   * update = SET（业务字段 + export_status/updated_by/updated_name/updated_time）+ data_version+1。
   *
   * @returns 更新后的行（条件 UPDATE 命中后回读，事件载荷直接可用）；
   *          null=0 行（已取消/已终态/重复投递），由调用方按幂等空转解释
   */
  async conditionalTransition(
    input: ExportTransitionInput,
  ): Promise<ExportTaskDocument | null> {
    const setFields: Record<string, unknown> = {
      ...(input.setFields ?? {}),
      export_status: input.toStatus,
      updated_by: input.operatorId,
      updated_name: input.operatorId,
      updated_time: new Date(),
      data_version: () => 'data_version + 1',
    };
    const result = await this.dataSource
      .getRepository(ExportTask)
      .createQueryBuilder()
      .update(ExportTask)
      .set(setFields)
      .where('export_id = :exportId', { exportId: input.exportId })
      .andWhere('delete_sign = :ds', { ds: DeleteSign.NOT_DELETED })
      .andWhere('export_status IN (:...statuses)', { statuses: input.fromStatuses })
      .execute();
    if (result.affected !== 1) {
      return null;
    }
    return this.normalize(
      await this.dataSource.getRepository(ExportTask).findOne({ where: { export_id: input.exportId } }),
    );
  }

  /**
   * 规则编码取号：当日前缀下最大 export_code（事务内读 + 同事务插入收窄并发窗口）。
   */
  async findMaxExportCode(prefix: string, session?: TxSession): Promise<string | null> {
    const rows = await this.manager(session).query(
      `SELECT export_code FROM dl_export_task WHERE export_code LIKE $1 ORDER BY export_code DESC LIMIT 1`,
      [`${prefix}%`],
    );
    const row = rows[0];
    return row != null && typeof row.export_code === 'string' ? row.export_code : null;
  }

  /* ------------------------------------------------------------------ */
  /* 读路径                                                              */
  /* ------------------------------------------------------------------ */

  /** 业务主键点查（下载凭证校验路径：属主由 HMAC 凭证绑定 task.user_id 验证） */
  async findById(exportId: string): Promise<ExportTaskDocument | null> {
    return this.normalize(
      await this.dataSource.getRepository(ExportTask).findOne({
        where: { export_id: exportId, delete_sign: DeleteSign.NOT_DELETED },
      }),
    );
  }

  /** 属主加载（user_id 隔离，cancel/download-ticket 用） */
  async findByIdOwned(exportId: string, userId: string): Promise<ExportTaskDocument | null> {
    return this.normalize(
      await this.dataSource.getRepository(ExportTask).findOne({
        where: { export_id: exportId, user_id: userId, delete_sign: DeleteSign.NOT_DELETED },
      }),
    );
  }

  /**
   * 分页查询（白名单映射固定于此）。排序 created_time desc + export_id desc（稳定排序）。
   */
  async pageList(
    input: ExportListQueryInput,
  ): Promise<{ records: ExportTaskDocument[]; total: number }> {
    const pageNum = Number.isInteger(input.pageNum) && input.pageNum >= 1 ? input.pageNum : 1;
    const pageSize = Number.isInteger(input.pageSize) && input.pageSize >= 1 ? input.pageSize : 20;
    const repo = this.dataSource.getRepository(ExportTask);
    const recordsQb = this.applyListFilter(repo.createQueryBuilder('e'), input)
      .orderBy('e.created_time', 'DESC')
      .addOrderBy('e.export_id', 'DESC')
      .skip((pageNum - 1) * pageSize)
      .take(pageSize);
    const totalQb = this.applyListFilter(repo.createQueryBuilder('e'), input);
    const [records, total] = await Promise.all([recordsQb.getMany(), totalQb.getCount()]);
    records.forEach((r) => this.normalize(r));
    return { records, total };
  }

  /** 构造列表 filter（固定白名单映射，请求体键名不进 filter） */
  private applyListFilter(
    qb: SelectQueryBuilder<ExportTask>,
    input: ExportListQueryInput,
  ): SelectQueryBuilder<ExportTask> {
    qb.where('e.user_id = :userId', { userId: input.userId })
      .andWhere('e.delete_sign = :ds', { ds: DeleteSign.NOT_DELETED });
    if (this.isNotBlank(input.deckId)) {
      qb.andWhere('e.deck_id = :deckId', { deckId: input.deckId! });
    }
    if (this.isNotBlank(input.exportFormat)) {
      qb.andWhere('e.export_format = :fmt', { fmt: input.exportFormat! });
    }
    if (this.isNotBlank(input.exportStatus)) {
      qb.andWhere('e.export_status = :status', { status: input.exportStatus! });
    }
    if (input.createdTimeStart != null) {
      qb.andWhere('e.created_time >= :cts', { cts: input.createdTimeStart });
    }
    if (input.createdTimeEnd != null) {
      qb.andWhere('e.created_time <= :cte', { cte: input.createdTimeEnd });
    }
    return qb;
  }

  /**
   * deck 维度成功导出数（SUCCEEDED 终态即「导出记录」）。
   */
  async countSucceededByDeck(deckId: string, userId: string): Promise<number> {
    return this.dataSource.getRepository(ExportTask).count({
      where: {
        deck_id: deckId,
        user_id: userId,
        delete_sign: DeleteSign.NOT_DELETED,
        export_status: ExportStatus.SUCCEEDED,
      },
    });
  }

  /**
   * EXPORT 聚合同步扫描：user_id + updated_time 复合游标（展开 OR 式），
   * (updated_time, export_id) 升序稳定排序。cursor=0 全量起始。
   */
  async scanUpdatedAfter(
    userId: string,
    cursorMs: number,
    limit: number,
    tiebreak?: CursorTiebreak | null,
  ): Promise<ExportTaskSyncRow[]> {
    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (cursorMs > 0) {
      const cur = cursorCondition('updated_time', 'export_id', cursorMs, tiebreak, 2);
      conditions.push(cur.sql);
      params.push(...cur.params);
    }
    const limitIndex = params.length + 1;
    params.push(limit);
    return this.dataSource.query(
      `SELECT export_id, deck_id, version_id, export_format, export_status, updated_time FROM dl_export_task WHERE ${conditions.join(' AND ')} ORDER BY updated_time ASC, export_id ASC LIMIT $${limitIndex}`,
      params,
    );
  }

  /* ------------------------------------------------------------------ */
  /* 跨聚合只读冗余（v1 ExportQueryMapper#selectDeckRows/selectVersionSeqRows） */
  /* ------------------------------------------------------------------ */

  /** deck 冗余行（deckId/deckCode/deckName；v1 同口径不带删除过滤） */
  async findDeckRefs(deckIds: string[]): Promise<Map<string, DeckRefRow>> {
    const result = new Map<string, DeckRefRow>();
    if (deckIds.length === 0) {
      return result;
    }
    const inc = inClause('deck_id', deckIds, 1);
    const rows = await this.dataSource.query(
      `SELECT deck_id, deck_code, deck_name FROM dl_deck WHERE ${inc.sql}`,
      inc.params,
    );
    for (const row of rows) {
      result.set(String(row.deck_id), {
        deckId: String(row.deck_id),
        deckCode: typeof row.deck_code === 'string' ? row.deck_code : null,
        deckName: typeof row.deck_name === 'string' ? row.deck_name : null,
      });
    }
    return result;
  }

  /** 版本冗余行（versionId → version_seq/deck_id；versionSeq 展示 + INV-14 防御校验） */
  async findVersionRefs(versionIds: string[]): Promise<Map<string, VersionRefRow>> {
    const result = new Map<string, VersionRefRow>();
    if (versionIds.length === 0) {
      return result;
    }
    const inc = inClause('version_id', versionIds, 1);
    const rows = await this.dataSource.query(
      `SELECT version_id, version_seq, deck_id FROM dl_deck_version WHERE ${inc.sql}`,
      inc.params,
    );
    for (const row of rows) {
      result.set(String(row.version_id), {
        versionId: String(row.version_id),
        versionSeq: row.version_seq == null ? null : Number(row.version_seq),
        deckId: typeof row.deck_id === 'string' ? row.deck_id : null,
      });
    }
    return result;
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}