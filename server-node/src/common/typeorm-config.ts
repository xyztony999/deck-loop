/**
 * TypeORM 连接配置（ADR-016：PostgreSQL 单库，与 UniGate 共实例不同 database）。
 *
 * env 直读（不引 config 包，沿 load-env.ts 口径）：
 * - DATABASE_URL：postgres://user:pass@host:port/deck_loop（密码仅存服务器 .env，不入 git）。
 * - 缺省本地 deck_loop 库（无凭证，本地开发）。
 * - PG_POOL_MAX：连接池上限（1.6G 服务器保守，默认 5）。
 *
 * synchronize=false（生产红线：schema 由迁移脚本/DDL 管理，禁止应用自动改表）；
 * 测试经 pg-mem adapter 单独 synchronize=true（见 test/global-setup.ts）。
 * entities 显式枚举 10 张物理表权威 entity（ADR-018：11−dl_channel−dl_channel_preference
 * +dl_api_token；dl_generation_task/dl_usage_record 保留历史只读；只读投影侧不独立 entity）。
 */
import type { DataSourceOptions } from 'typeorm';
import { Account } from '../platform/schemas/account.schema';
import { ApiToken } from '../platform/schemas/api-token.schema';
import { UsageRecord } from '../platform/schemas/usage-record.schema';
import { Deck } from '../deck/schemas/dl_deck.schema';
import { DeckVersion } from '../version/schemas/dl_deck_version.schema';
import { GenerationTask } from '../platform/schemas/dl_generation_task.schema';
import { ExportTask } from '../deliver/schemas/dl_export_task.schema';
import { Asset } from '../asset/schemas/asset.schema';
import { BrandKit } from '../asset/schemas/brand-kit.schema';
import { PromptTemplate } from '../asset/schemas/prompt-template.schema';

/** 全部权威 entity（10 张物理表，ADR-018 口径） */
export const ALL_ENTITIES = [
  Account,
  ApiToken,
  UsageRecord,
  Deck,
  DeckVersion,
  GenerationTask,
  ExportTask,
  Asset,
  BrandKit,
  PromptTemplate,
];

/** 默认本地连接串（无凭证；生产经 DATABASE_URL 覆盖） */
const DEFAULT_DATABASE_URL = 'postgres://127.0.0.1:5432/deck_loop';

/** 解析连接池上限（正整数兜底 5） */
function poolMax(): number {
  const parsed = Number.parseInt(process.env.PG_POOL_MAX ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

/** 构造 TypeORM 连接选项（AppModule forRoot 消费） */
export function buildTypeOrmOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    entities: ALL_ENTITIES,
    synchronize: false,
    logging: false,
    poolSize: poolMax(),
  };
}