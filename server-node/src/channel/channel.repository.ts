import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage as MongoPipelineStage } from 'mongoose';
import { nextId } from '../common/utils/snowflake';
import {
  ChannelPreference,
  type ChannelPreferenceLean,
  type PreferenceTier,
} from './schemas/channel-preference.schema';
import { ChannelUsageRecordRow } from './schemas/channel-usage-record.schema';

/** 用量聚合维度（契约查询参数，值域白名单；未入枚举池——domain-manifest §12） */
export type UsageDimension = 'CHANNEL' | 'DECK' | 'TASK_TYPE';

/** 偏好读取快照（解 Mongoose Map 语义后的纯对象，Service 层消费） */
export interface PreferenceSnapshot {
  preferenceId: string;
  userId: string;
  defaultChannelCode: string | null;
  defaultModelCode: string | null;
  tiers: Record<string, PreferenceTier>;
  dataVersion: number;
  createdBy: string | null;
}

/** 偏好保存入参（save 全量替换语义） */
export interface PreferenceUpsertInput {
  defaultChannelCode: string;
  defaultModelCode: string;
  preferenceMap: Record<string, PreferenceTier>;
}

/** 用量聚合行（仓储输出；dimName 仅 DECK 维度由管道 $lookup 回填） */
export interface UsageAggregateRow {
  dimKey: string;
  dimName: string | null;
  taskCount: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: Date | null;
}

/* ------------------------------------------------------------------ */
/* AO→查询字段白名单映射（NR-02/NR-03 红线：请求体键名不得成为          */
/* filter/sort/projection/$group 键；用户输入只作 $match/skip/limit 值） */
/* ------------------------------------------------------------------ */

/**
 * 偏好定位白名单：channel 域为 1:1 用户主数据，唯一定位键=服务端注入的
 * userId（@CurrentUser，NR-05）→ 存储字段 user_id（uk_user 唯一索引）。
 */
const PREFERENCE_FILTER_MAP: Readonly<Record<'userId', 'user_id'>> = {
  userId: 'user_id',
};

/**
 * 用量聚合 $group 维度字段白名单：dimension 值（DTO @IsIn 值域校验后进入）
 * 仅允许映射到下列**服务端常量**（字面量，无拼接），未知维度不构造管道。
 */
const USAGE_GROUP_FIELD_MAP: Readonly<Partial<Record<UsageDimension, string>>> = {
  CHANNEL: '$channel_code',
  TASK_TYPE: '$task_type',
  // DECK 不在此列：dl_usage_record 无 deck_id，走 $lookup 专用静态管道归组
};

/** 简单维度（CHANNEL/TASK_TYPE）聚合管道输出行 */
interface SimpleAggRow {
  dimKey: string;
  taskCount: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: Date | null;
}

/** DECK 维度 $facet 输出 */
interface DeckFacetOutput {
  page: Array<SimpleAggRow & { dimName: string | null }>;
  total: Array<{ value: number }>;
}

/** $match 共同参数（值位：userId 服务端注入，start/end 由 yyyy-MM-dd 校验后构造） */
interface UsageMatchParams {
  userId: string;
  start: Date;
  end: Date;
}

/** 静态管道阶段类型（结构服务端常量；仅值位承接已校验入参） */
type StaticPipelineStage = Record<string, unknown>;

/**
 * 渠道偏好仓储（api-channel §4.5 仓储契约）：
 * - 偏好 upsert：updateOne（upsert，filter=user_id 唯一索引，INV-23）
 * - 用量聚合：dl_usage_record aggregate（服务端静态构造管道，维度值白名单校验）
 */
@Injectable()
export class ChannelRepository {
  constructor(
    @InjectModel(ChannelPreference.name)
    private readonly preferenceModel: Model<ChannelPreference>,
    @InjectModel(ChannelUsageRecordRow.name)
    private readonly usageModel: Model<ChannelUsageRecordRow>,
  ) {}

  /**
   * 按属主读取偏好快照（读路径过滤 delete_sign=0，v1 @TableLogic 语义平移）。
   */
  async findSnapshotByUserId(userId: string): Promise<PreferenceSnapshot | null> {
    const filter = { [PREFERENCE_FILTER_MAP.userId]: userId, delete_sign: 0 };
    const doc = await this.preferenceModel.findOne(filter).lean<ChannelPreferenceLean | null>();
    if (doc === null) {
      return null;
    }
    return {
      preferenceId: doc.preference_id,
      userId: doc.user_id,
      defaultChannelCode: doc.default_channel_code ?? null,
      defaultModelCode: doc.default_model_code ?? null,
      tiers: sanitizeTiers(doc.preference_map),
      dataVersion: doc.data_version,
      createdBy: doc.created_by ?? null,
    };
  }

  /**
   * 偏好 upsert（INV-23：filter=user_id 唯一索引，契约 §5.2「updateOne（upsert，
   * filter=user_id 唯一索引）」逐字对齐）：
   * - $set=save 全量替换语义（默认渠道/模型 + 归一化档位 + 更新审计）
   * - $setOnInsert 固化创建审计与雪花业务主键
   * - $inc data_version 乐观锁（20 §3；首存即 1=保存次数语义）
   * - 单文档原子 upsert，成功返回后 Service 方可发事件（NR-07）
   */
  async upsertByUser(userId: string, input: PreferenceUpsertInput): Promise<void> {
    const now = new Date();
    await this.preferenceModel.updateOne(
      { [PREFERENCE_FILTER_MAP.userId]: userId },
      {
        $set: {
          default_channel_code: input.defaultChannelCode,
          default_model_code: input.defaultModelCode,
          preference_map: input.preferenceMap,
          // 审计 name：AuthPrincipal 无昵称（仅 userId/accountId），以 userId 兜底保证非空
          updated_by: userId,
          updated_name: userId,
          updated_time: now,
        },
        $setOnInsert: {
          preference_id: nextId(),
          delete_sign: 0,
          created_by: userId,
          created_name: userId,
          created_time: now,
        },
        $inc: { data_version: 1 },
      },
      { upsert: true },
    );
  }

  /**
   * 用量聚合（CHANNEL/TASK_TYPE/DECK 三维静态管道；api-channel §5.2「aggregate
   * 服务端静态构造管道，维度值白名单校验，用户输入只作 $match 值」）：
   * - CHANNEL/TASK_TYPE：$match → $group（白名单键）→ $sort（taskCount desc，
   *   lastUsedAt desc，v1 sorted() 对齐）→ 全量行返回，total=行数
   * - DECK：$lookup dl_generation_task（task_id→deck_id）→ $unwind（任务已清理的
   *   记录不归组，v1 continue 语义）→ $group → $facet{page:$sort+$skip+$limit
   *   +$lookup dl_deck 回填 deck_name, total:$count}（分页在管道内完成）
   */
  async aggregateUsage(params: {
    userId: string;
    dimension: UsageDimension;
    start: Date;
    end: Date;
    pageNum: number;
    pageSize: number;
  }): Promise<{ rows: UsageAggregateRow[]; total: number }> {
    const match: UsageMatchParams = { userId: params.userId, start: params.start, end: params.end };
    const groupKey = USAGE_GROUP_FIELD_MAP[params.dimension];

    if (groupKey !== undefined) {
      // 静态构造管道（服务端常量结构）→ 断言为 mongoose PipelineStage 联合类型
      const pipeline = buildSimpleGroupPipeline(match, groupKey) as unknown as MongoPipelineStage[];
      const rows = await this.usageModel.aggregate<SimpleAggRow>(pipeline).exec();
      return {
        rows: rows.map((row) => ({ ...row, dimName: null })),
        total: rows.length,
      };
    }

    if (params.dimension === 'DECK') {
      const skip = Math.max(0, (params.pageNum - 1) * params.pageSize);
      const pipeline = buildDeckLookupPipeline(match, {
        skip,
        limit: params.pageSize,
      }) as unknown as MongoPipelineStage[];
      const facetDocs = await this.usageModel.aggregate<DeckFacetOutput>(pipeline).exec();
      const facet: DeckFacetOutput = facetDocs[0] ?? { page: [], total: [] };
      return {
        rows: facet.page,
        total: facet.total.length > 0 ? facet.total[0].value : 0,
      };
    }

    // 防御兜底：DTO @IsIn 已拦截未知维度，此处不可达（白名单外维度拒绝构造管道）
    throw new Error(`未白名单的用量聚合维度：${params.dimension}`);
  }
}

/** $match 阶段（值位：userId/时间边界均为服务端构造） */
function matchStage(match: UsageMatchParams): StaticPipelineStage {
  return {
    $match: { user_id: match.userId, occurred_at: { $gte: match.start, $lte: match.end } },
  };
}

/** $group 累计规格（taskCount/promptTokens/completionTokens/lastUsedAt） */
function groupAccumulators(): Record<string, unknown> {
  return {
    taskCount: { $sum: 1 },
    promptTokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } },
    completionTokens: { $sum: { $ifNull: ['$completion_tokens', 0] } },
    lastUsedAt: { $max: '$occurred_at' },
  };
}

/** 简单维度管道（groupKey=白名单表字面量常量，非用户输入） */
function buildSimpleGroupPipeline(match: UsageMatchParams, groupKey: string): StaticPipelineStage[] {
  return [
    matchStage(match),
    { $group: { _id: groupKey, ...groupAccumulators() } },
    { $sort: { taskCount: -1, lastUsedAt: -1, _id: 1 } },
    {
      $project: {
        _id: 0,
        dimKey: '$_id',
        taskCount: 1,
        promptTokens: 1,
        completionTokens: 1,
        lastUsedAt: 1,
      },
    },
  ];
}

/**
 * DECK 维度管道（跨集合 $lookup 集合名/字段名均为契约 §5.3 服务端常量；
 * dl_deck 查找不过滤 delete_sign——历史用量的维度名称展示不因创作物后续
 * 软删而丢失，v1 DeckRefEntity 不映射 @TableLogic 语义对齐）。
 */
function buildDeckLookupPipeline(
  match: UsageMatchParams,
  page: { skip: number; limit: number },
): StaticPipelineStage[] {
  return [
    matchStage(match),
    {
      $lookup: {
        from: 'dl_generation_task',
        let: { tid: '$task_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$task_id', '$$tid'] } } },
          { $project: { _id: 0, deck_id: 1 } },
        ],
        as: 'taskRef',
      },
    },
    { $unwind: '$taskRef' },
    { $group: { _id: '$taskRef.deck_id', ...groupAccumulators() } },
    {
      $facet: {
        page: [
          { $sort: { taskCount: -1, lastUsedAt: -1, _id: 1 } },
          { $skip: page.skip },
          { $limit: page.limit },
          {
            $lookup: {
              from: 'dl_deck',
              localField: '_id',
              foreignField: 'deck_id',
              as: 'deckRef',
            },
          },
          { $addFields: { dimName: { $arrayElemAt: ['$deckRef.deck_name', 0] } } },
          {
            $project: {
              _id: 0,
              dimKey: '$_id',
              dimName: 1,
              taskCount: 1,
              promptTokens: 1,
              completionTokens: 1,
              lastUsedAt: 1,
            },
          },
        ],
        total: [{ $count: 'value' }],
      },
    },
  ];
}

/** 档位对象容错清洗（异常/畸形值按空档位处理，等价回落默认，v1 parseTierMap 对齐） */
function sanitizeTiers(raw: Record<string, PreferenceTier> | null | undefined): Record<string, PreferenceTier> {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {};
  }
  const tiers: Record<string, PreferenceTier> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof value.channelCode === 'string' &&
      typeof value.modelCode === 'string'
    ) {
      tiers[key] = { channelCode: value.channelCode, modelCode: value.modelCode };
    }
  }
  return tiers;
}
