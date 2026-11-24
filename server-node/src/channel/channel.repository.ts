import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { nextId } from '../common/utils/snowflake';
import { ChannelPreference, type PreferenceTier } from './schemas/channel-preference.schema';

/** 用量聚合维度（契约查询参数，值域白名单；未入枚举池——domain-manifest §12） */
export type UsageDimension = 'CHANNEL' | 'DECK' | 'TASK_TYPE';

/** 偏好读取快照（jsonb 纯对象，Service 层消费） */
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

/** 用量聚合行（仓储输出；dimName 仅 DECK 维度由 JOIN 回填） */
export interface UsageAggregateRow {
  dimKey: string;
  dimName: string | null;
  taskCount: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: Date | null;
}

/**
 * 用量聚合 GROUP BY 维度字段白名单：dimension 值（DTO @IsIn 值域校验后进入）
 * 仅允许映射到下列**服务端常量**（字面量，无拼接），未知维度不构造 SQL。
 * DECK 不在此列：dl_usage_record 无 deck_id，走 JOIN 专用静态 SQL 归组。
 */
const USAGE_GROUP_FIELD_MAP: Readonly<Partial<Record<UsageDimension, string>>> = {
  CHANNEL: 'channel_code',
  TASK_TYPE: 'task_type',
};

/**
 * 渠道偏好仓储（api-channel §4.5 仓储契约；ADR-016 TypeORM/SQL）：
 * - 偏好 upsert：INSERT … ON CONFLICT (user_id)（uk_user 唯一索引，INV-23）
 * - 用量聚合：dl_usage_record SQL（服务端静态构造，维度值白名单校验）
 */
@Injectable()
export class ChannelRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 按属主读取偏好快照（读路径过滤 delete_sign=0，v1 @TableLogic 语义平移）。
   */
  async findSnapshotByUserId(userId: string): Promise<PreferenceSnapshot | null> {
    const doc = await this.dataSource.getRepository(ChannelPreference).findOne({ where: { user_id: userId, delete_sign: 0 } });
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
   * 偏好 upsert（INV-23：ON CONFLICT (user_id) 唯一索引，契约 §5.2 逐字对齐）：
   * - DO UPDATE SET=save 全量替换语义（默认渠道/模型 + 归一化档位 + 更新审计）
   * - 首存固化创建审计与雪花业务主键，data_version=1（保存次数语义）
   * - 更新 data_version+1 乐观锁；单语句原子 upsert，成功返回后 Service 方可发事件（NR-07）
   */
  async upsertByUser(userId: string, input: PreferenceUpsertInput): Promise<void> {
    const now = new Date();
    await this.dataSource.query(
      `INSERT INTO dl_channel_preference
         (preference_id, user_id, default_channel_code, default_model_code, preference_map,
          delete_sign, created_by, created_name, created_time, updated_by, updated_name, updated_time, data_version)
       VALUES ($1,$2,$3,$4,$5,0,$6,$6,$7,$6,$6,$7,1)
       ON CONFLICT (user_id) DO UPDATE SET
         default_channel_code = EXCLUDED.default_channel_code,
         default_model_code = EXCLUDED.default_model_code,
         preference_map = EXCLUDED.preference_map,
         updated_by = EXCLUDED.updated_by,
         updated_name = EXCLUDED.updated_name,
         updated_time = EXCLUDED.updated_time,
         data_version = dl_channel_preference.data_version + 1`,
      [nextId(), userId, input.defaultChannelCode, input.defaultModelCode, JSON.stringify(input.preferenceMap), userId, now],
    );
  }

  /**
   * 用量聚合（CHANNEL/TASK_TYPE/DECK 三维静态 SQL；api-channel §5.2「服务端静态构造，
   * 维度值白名单校验，用户输入只作绑定值」）：
   * - CHANNEL/TASK_TYPE：GROUP BY 白名单列 → ORDER BY taskCount desc, lastUsedAt desc → 全量行，total=行数
   * - DECK：JOIN dl_generation_task（task_id→deck_id，INNER=任务已清理的记录不归组）
   *   → GROUP BY → CTE 分页（ORDER+LIMIT+OFFSET）+ LEFT JOIN dl_deck 回填 deck_name + COUNT total
   */
  async aggregateUsage(params: {
    userId: string;
    dimension: UsageDimension;
    start: Date;
    end: Date;
    pageNum: number;
    pageSize: number;
  }): Promise<{ rows: UsageAggregateRow[]; total: number }> {
    const groupCol = USAGE_GROUP_FIELD_MAP[params.dimension];

    if (groupCol !== undefined) {
      const rows = await this.dataSource.query(
        `SELECT ${groupCol} AS "dimKey",
                COUNT(*)::int AS "taskCount",
                COALESCE(SUM(prompt_tokens),0)::int AS "promptTokens",
                COALESCE(SUM(completion_tokens),0)::int AS "completionTokens",
                MAX(occurred_at) AS "lastUsedAt"
         FROM dl_usage_record
         WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY ${groupCol}
         ORDER BY "taskCount" DESC, "lastUsedAt" DESC, "dimKey" ASC`,
        [params.userId, params.start, params.end],
      );
      return {
        rows: rows.map((row: UsageAggregateRow) => ({ ...row, dimName: null })),
        total: rows.length,
      };
    }

    if (params.dimension === 'DECK') {
      const skip = Math.max(0, (params.pageNum - 1) * params.pageSize);
      const aggCte = `WITH agg AS (
          SELECT t.deck_id AS dim_key,
                 COUNT(*)::int AS task_count,
                 COALESCE(SUM(u.prompt_tokens),0)::int AS prompt_tokens,
                 COALESCE(SUM(u.completion_tokens),0)::int AS completion_tokens,
                 MAX(u.occurred_at) AS last_used_at
          FROM dl_usage_record u
          JOIN dl_generation_task t ON t.task_id = u.task_id
          WHERE u.user_id = $1 AND u.occurred_at >= $2 AND u.occurred_at <= $3
          GROUP BY t.deck_id
        )`;
      const rows = await this.dataSource.query(
        `${aggCte}
         SELECT a.dim_key AS "dimKey", d.deck_name AS "dimName",
                a.task_count AS "taskCount", a.prompt_tokens AS "promptTokens",
                a.completion_tokens AS "completionTokens", a.last_used_at AS "lastUsedAt"
         FROM agg a LEFT JOIN dl_deck d ON d.deck_id = a.dim_key
         ORDER BY a.task_count DESC, a.last_used_at DESC, a.dim_key ASC
         LIMIT $4 OFFSET $5`,
        [params.userId, params.start, params.end, params.pageSize, skip],
      );
      const totalRows = await this.dataSource.query(
        `${aggCte} SELECT COUNT(*)::int AS total FROM agg`,
        [params.userId, params.start, params.end],
      );
      return {
        rows,
        total: Number(totalRows[0]?.total ?? 0),
      };
    }

    // 防御兜底：DTO @IsIn 已拦截未知维度，此处不可达（白名单外维度拒绝构造 SQL）
    throw new Error(`未白名单的用量聚合维度：${params.dimension}`);
  }
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