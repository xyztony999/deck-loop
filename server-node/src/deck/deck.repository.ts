import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, FilterQuery, Model } from 'mongoose';
import { DeckStatus, DeleteSign } from '../common/enums';
import { DECK_MODEL, type Deck, type DeckDocument } from './schemas/dl_deck.schema';

/**
 * deck 域列表查询白名单输入（NR-02：AO 字段→查询字段的显式映射表专用类型；
 * 请求体键名不得成为 filter/sort/projection 键——本接口字段与 collection 字段
 * 一一对应，由 repository 内固定映射，Service 只传值）。
 */
export interface DeckListQueryInput {
  userId: string;
  /** 名称模糊匹配（deck_name，like 语义→正则字面量+i） */
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
  /** 期望前置状态集合（状态机守卫条件化：filter 含 deck_status $in 期望值） */
  expectedStatuses: string[];
  /** 期望 data_version（乐观锁；不匹配=并发修改） */
  expectedDataVersion: number;
  /** $set 业务字段（snake_case 白名单由调用方 Service 构造） */
  setFields: Record<string, unknown>;
  session?: ClientSession;
}

/** 选择池查询输入（deck.select.deckList） */
export interface DeckSelectQueryInput {
  userId: string;
  keyword?: string | null;
  deckStatus?: string | null;
}

/**
 * 创作物聚合根仓储（dl_deck，v1 DeckMapper 对齐）。
 *
 * - 全部查询强制 user_id + delete_sign=0（ADR-005 属主隔离）
 * - 状态机更新=条件 updateOne（filter 携带 deck_status 期望值 + data_version，
 *   $inc data_version 推进；0 行=并发冲突/状态已变，由调用方解释）
 * - 支持 mongoose ClientSession 加入外层跨聚合事务（generation 成功回调编排）
 */
@Injectable()
export class DeckRepository {
  constructor(
    @InjectModel(DECK_MODEL) private readonly deckModel: Model<DeckDocument>,
  ) {}

  /** 属主加载（user_id 隔离 + 未删除；不存在/非属主返回 null） */
  async findByIdOwned(
    deckId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<DeckDocument | null> {
    return this.deckModel
      .findOne({ deck_id: deckId, user_id: userId, delete_sign: DeleteSign.NOT_DELETED })
      .session(session ?? null)
      .exec();
  }

  /** 进程内读取（跨域 getDeck；userId 省略时不做属主过滤，v1 getById 语义） */
  async findById(deckId: string, userId?: string, session?: ClientSession): Promise<DeckDocument | null> {
    const filter: FilterQuery<DeckDocument> = {
      deck_id: deckId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    if (userId !== undefined && userId !== null) {
      filter.user_id = userId;
    }
    return this.deckModel.findOne(filter).session(session ?? null).exec();
  }

  /**
   * 分页查询（白名单映射固定于此：keyword→deck_name、deckType→deck_type、
   * deckStatus/archivedScope→deck_status、timeRange→created_time）。
   * 排序 updated_time desc + deck_id desc（同步游标同构的稳定排序，保证分页确定性）。
   */
  async pageList(
    input: DeckListQueryInput,
  ): Promise<{ records: DeckDocument[]; total: number }> {
    const filter = this.buildListFilter(input);
    const pageNum = Number.isInteger(input.pageNum) && input.pageNum >= 1 ? input.pageNum : 1;
    const pageSize = Number.isInteger(input.pageSize) && input.pageSize >= 1 ? input.pageSize : 20;
    const [records, total] = await Promise.all([
      this.deckModel
        .find(filter)
        .sort({ updated_time: -1, deck_id: -1 })
        .skip((pageNum - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.deckModel.countDocuments(filter).exec(),
    ]);
    return { records, total };
  }

  /** 构造列表 filter（固定白名单映射，请求体键名不进 filter） */
  private buildListFilter(input: DeckListQueryInput): FilterQuery<DeckDocument> {
    const filter: FilterQuery<DeckDocument> = {
      user_id: input.userId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    if (this.isNotBlank(input.keyword)) {
      // like 语义：字面量转义 + 大小写不敏感（v1 MySQL utf8mb4_unicode_ci 对齐）
      filter.deck_name = { $regex: this.escapeRegex(input.keyword!), $options: 'i' };
    }
    if (this.isNotBlank(input.deckType)) {
      filter.deck_type = input.deckType!;
    }
    const archivedOnly = input.archivedScope != null && input.archivedScope === 1;
    if (archivedOnly) {
      // 校验规则：archivedScope=1 时状态筛选强制 ARCHIVED（api-deck §4.4）
      filter.deck_status = DeckStatus.ARCHIVED;
    } else if (this.isNotBlank(input.deckStatus)) {
      filter.deck_status = input.deckStatus!;
    } else {
      // 默认不含归档
      filter.deck_status = { $ne: DeckStatus.ARCHIVED };
    }
    if (input.createdTimeStart != null) {
      filter.created_time = { ...(filter.created_time as object), $gte: input.createdTimeStart };
    }
    if (input.createdTimeEnd != null) {
      filter.created_time = {
        ...(filter.created_time as object),
        $lte: input.createdTimeEnd,
      };
    }
    return filter;
  }

  /** 插入（新建；雪花 id 由调用方生成，审计字段随 doc 传入） */
  async create(deck: Deck, session?: ClientSession): Promise<DeckDocument> {
    const [created] = await this.deckModel.create([deck], { session });
    return created;
  }

  /**
   * 状态机条件更新：filter 固定 = deck_id + user_id + delete_sign=0
   * + deck_status $in 期望值 + data_version 期望值；
   * update = $set（业务字段 + updated_by/updated_name/updated_time）+ $inc data_version。
   *
   * @returns true=更新成功；false=0 行（状态已变/并发修改/不存在），由调用方解释
   */
  async conditionalUpdate(input: DeckConditionalUpdateInput): Promise<boolean> {
    const filter: FilterQuery<DeckDocument> = {
      deck_id: input.deckId,
      user_id: input.userId,
      delete_sign: DeleteSign.NOT_DELETED,
      deck_status: { $in: input.expectedStatuses },
      data_version: input.expectedDataVersion,
    };
    const now = new Date();
    const result = await this.deckModel.updateOne(
      filter,
      {
        $set: {
          ...input.setFields,
          updated_time: now,
        },
        $inc: { data_version: 1 },
      },
      { session: input.session },
    );
    return result.matchedCount === 1;
  }

  /**
   * draft_outline 单字段定向更新（generation 域 outline/save 与 OUTLINE 成功回调用；
   * v1 GenerationTaskQueryMapper#updateDeckDraftOutline 语义平移：无状态守卫，
   * 属主隔离一并校验；updated_time 推进 + data_version $inc 保持锁字段一致）。
   */
  async updateDraftOutline(
    deckId: string,
    userId: string,
    outline: Record<string, unknown>,
    updatedBy: string,
    updatedName: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const filter: FilterQuery<DeckDocument> = {
      deck_id: deckId,
      user_id: userId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    const result = await this.deckModel.updateOne(
      filter,
      {
        $set: {
          draft_outline: outline,
          updated_by: updatedBy,
          updated_name: updatedName,
          updated_time: new Date(),
        },
        $inc: { data_version: 1 },
      },
      { session },
    );
    return result.matchedCount === 1;
  }

  /** 选择池查询（deck.select.deckList：默认非归档，名称模糊，updated_time desc） */
  async selectList(input: DeckSelectQueryInput): Promise<DeckDocument[]> {
    const filter: FilterQuery<DeckDocument> = {
      user_id: input.userId,
      delete_sign: DeleteSign.NOT_DELETED,
    };
    if (this.isNotBlank(input.keyword)) {
      filter.deck_name = { $regex: this.escapeRegex(input.keyword!), $options: 'i' };
    }
    if (this.isNotBlank(input.deckStatus)) {
      filter.deck_status = input.deckStatus!;
    } else {
      // 选择池默认非归档（可编辑/可导出池）
      filter.deck_status = { $ne: DeckStatus.ARCHIVED };
    }
    return this.deckModel.find(filter).sort({ updated_time: -1, deck_id: -1 }).exec();
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isNotBlank(s: string | null | undefined): s is string {
    return typeof s === 'string' && s.trim().length > 0;
  }
}
