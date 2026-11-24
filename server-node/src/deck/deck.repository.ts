import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { DeckStatus, DeleteSign } from '../common/enums';
import { escapeLike, type TxSession } from '../common/persistence';
import { Deck, type DeckDocument } from './schemas/dl_deck.schema';

/**
 * deck 域列表查询白名单输入（NR-02：AO 字段→查询字段的显式映射表专用类型；
 * 请求体键名不得成为 filter/sort/projection 键——本接口字段与表字段一一对应，
 * 由 repository 内固定映射，Service 只传值）。
 */
export interface DeckListQueryInput {
  userId: string;
  /** 名称模糊匹配（deck_name，ILIKE 子串语义，大小写不敏感） */
  keyword?: string | null;
  /** 类型精确匹配（DeckType code） */
  deckType?: string | null;
  /** 状态精确匹配（DeckStatus code） */
  deckStatus?: string | null;
  /** 归档范围：0/null=默认不含归档，1=仅归档（状态筛选强制 ARCHIVED） */
  archivedScope?: number | null;
  /** 创建时间起（服务端已解析为 Date） */
  createdTimeStart?: Date | null;
  /** 创建时间止（服务端已解析为 Date） */
  createdTimeEnd?: Date | null;
  /** 页码（默认 1） */
  pageNum: number;
  /** 页大小（默认 20） */
  pageSize: number;
}

/** 状态机条件更新参数（filter 固定携带 deck_status 期望值 + data_version 乐观锁） */
export interface DeckConditionalUpdateInput {
  deckId: string;
  userId: string;
  /** 期望前置状态集合（状态机守卫条件化：filter 含 deck_status IN 期望值） */
  expectedStatuses: string[];
  /** 期望 data_version（乐观锁；不匹配=并发修改） */
  expectedDataVersion: number;
  /** SET 业务字段（snake_case 白名单由调用方 Service 构造） */
  setFields: Record<string, unknown>;
  session?: TxSession;
}

/** 选择池查询输入（deck.select.deckList） */
export interface DeckSelectQueryInput {
  userId: string;
  keyword?: string | null;
  deckStatus?: string | null;
}

/**
 * 创作物聚合根仓储（dl_deck，v1 DeckMapper 对齐；ADR-016 TypeORM）。
 *
 * - 全部查询强制 user_id + delete_sign=0（ADR-005 属主隔离）
 * - 状态机更新=条件 UPDATE（filter 携带 deck_status 期望值 + data_version，
 *   data_version+1 推进；0 行=并发冲突/状态已变，由调用方解释）
 * - 支持 TxSession（EntityManager）加入外层跨聚合事务（generation 成功回调编排）
 */
@Injectable()
export class DeckRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(session?: TxSession): EntityManager {
    return session ?? this.dataSource.manager;
  }

  /** 属主加载（user_id 隔离 + 未删除；不存在/非属主返回 null） */
  async findByIdOwned(
    deckId: string,
    userId: string,
    session?: TxSession,
  ): Promise<DeckDocument | null> {
    return this.manager(session).getRepository(Deck).findOne({
      where: { deck_id: deckId, user_id: userId, delete_sign: DeleteSign.NOT_DELETED },
    });
  }

  /** 进程内读取（跨域 getDeck；userId 省略时不做属主过滤，v1 getById 语义） */
  async findById(deckId: string, userId?: string, session?: TxSession): Promise<DeckDocument | null> {
    const where: Record<string, unknown> = {
      deck_id: deckId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    if (userId !== undefined && userId !== null) {
      where.user_id = userId;
    }
    return this.manager(session).getRepository(Deck).findOne({ where });
  }

  /**
   * 分页查询（白名单映射固定于此：keyword→deck_name、deckType→deck_type、
   * deckStatus/archivedScope→deck_status、timeRange→created_time）。
   * 排序 updated_time desc + deck_id desc（同步游标同构的稳定排序，保证分页确定性）。
   */
  async pageList(
    input: DeckListQueryInput,
  ): Promise<{ records: DeckDocument[]; total: number }> {
    const pageNum = Number.isInteger(input.pageNum) && input.pageNum >= 1 ? input.pageNum : 1;
    const pageSize = Number.isInteger(input.pageSize) && input.pageSize >= 1 ? input.pageSize : 20;
    const repo = this.dataSource.getRepository(Deck);
    const recordsQb = this.applyListFilter(repo.createQueryBuilder('d'), input)
      .orderBy('d.updated_time', 'DESC')
      .addOrderBy('d.deck_id', 'DESC')
      .skip((pageNum - 1) * pageSize)
      .take(pageSize);
    const totalQb = this.applyListFilter(repo.createQueryBuilder('d'), input);
    const [records, total] = await Promise.all([recordsQb.getMany(), totalQb.getCount()]);
    return { records, total };
  }

  /** 构造列表 filter（固定白名单映射，请求体键名不进 filter） */
  private applyListFilter(
    qb: SelectQueryBuilder<Deck>,
    input: DeckListQueryInput,
  ): SelectQueryBuilder<Deck> {
    qb.where('d.user_id = :userId', { userId: input.userId })
      .andWhere('d.delete_sign = :ds', { ds: DeleteSign.NOT_DELETED });
    if (this.isNotBlank(input.keyword)) {
      qb.andWhere('d.deck_name ILIKE :kw', { kw: `%${escapeLike(input.keyword!)}%` });
    }
    if (this.isNotBlank(input.deckType)) {
      qb.andWhere('d.deck_type = :deckType', { deckType: input.deckType! });
    }
    const archivedOnly = input.archivedScope != null && input.archivedScope === 1;
    if (archivedOnly) {
      qb.andWhere('d.deck_status = :archived', { archived: DeckStatus.ARCHIVED });
    } else if (this.isNotBlank(input.deckStatus)) {
      qb.andWhere('d.deck_status = :deckStatus', { deckStatus: input.deckStatus! });
    } else {
      qb.andWhere('d.deck_status <> :archived', { archived: DeckStatus.ARCHIVED });
    }
    if (input.createdTimeStart != null) {
      qb.andWhere('d.created_time >= :cts', { cts: input.createdTimeStart });
    }
    if (input.createdTimeEnd != null) {
      qb.andWhere('d.created_time <= :cte', { cte: input.createdTimeEnd });
    }
    return qb;
  }

  /** 插入（新建；雪花 id 由调用方生成，审计字段随 doc 传入） */
  async create(deck: Deck, session?: TxSession): Promise<DeckDocument> {
    await this.manager(session).getRepository(Deck).insert(deck);
    return deck;
  }

  /**
   * 状态机条件更新：filter 固定 = deck_id + user_id + delete_sign=0
   * + deck_status IN 期望值 + data_version 期望值；
   * update = SET（业务字段 + updated_time）+ data_version+1。
   *
   * @returns true=更新成功；false=0 行（状态已变/并发修改/不存在），由调用方解释
   */
  async conditionalUpdate(input: DeckConditionalUpdateInput): Promise<boolean> {
    const setFields: Record<string, unknown> = {
      ...input.setFields,
      updated_time: new Date(),
      data_version: () => 'data_version + 1',
    };
    const result = await this.manager(input.session)
      .getRepository(Deck)
      .createQueryBuilder()
      .update(Deck)
      .set(setFields)
      .where('deck_id = :deckId', { deckId: input.deckId })
      .andWhere('user_id = :userId', { userId: input.userId })
      .andWhere('delete_sign = :ds', { ds: DeleteSign.NOT_DELETED })
      .andWhere('deck_status IN (:...statuses)', { statuses: input.expectedStatuses })
      .andWhere('data_version = :dv', { dv: input.expectedDataVersion })
      .execute();
    return result.affected === 1;
  }

  /**
   * draft_outline 单字段定向更新（generation 域 outline/save 与 OUTLINE 成功回调用；
   * 无状态守卫，属主隔离一并校验；updated_time 推进 + data_version+1 保持锁字段一致）。
   */
  async updateDraftOutline(
    deckId: string,
    userId: string,
    outline: Record<string, any>,
    updatedBy: string,
    updatedName: string,
    session?: TxSession,
  ): Promise<boolean> {
    const result = await this.manager(session)
      .getRepository(Deck)
      .createQueryBuilder()
      .update(Deck)
      .set({
        draft_outline: outline,
        updated_by: updatedBy,
        updated_name: updatedName,
        updated_time: new Date(),
        data_version: () => 'data_version + 1',
      })
      .where('deck_id = :deckId', { deckId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('delete_sign = :ds', { ds: DeleteSign.NOT_DELETED })
      .execute();
    return result.affected === 1;
  }

  /** 选择池查询（deck.select.deckList：默认非归档，名称模糊，updated_time desc） */
  async selectList(input: DeckSelectQueryInput): Promise<DeckDocument[]> {
    const qb = this.dataSource
      .getRepository(Deck)
      .createQueryBuilder('d')
      .where('d.user_id = :userId', { userId: input.userId })
      .andWhere('d.delete_sign = :ds', { ds: DeleteSign.NOT_DELETED });
    if (this.isNotBlank(input.keyword)) {
      qb.andWhere('d.deck_name ILIKE :kw', { kw: `%${escapeLike(input.keyword!)}%` });
    }
    if (this.isNotBlank(input.deckStatus)) {
      qb.andWhere('d.deck_status = :deckStatus', { deckStatus: input.deckStatus! });
    } else {
      qb.andWhere('d.deck_status <> :archived', { archived: DeckStatus.ARCHIVED });
    }
    return qb.orderBy('d.updated_time', 'DESC').addOrderBy('d.deck_id', 'DESC').getMany();
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}