/**
 * ADR-018 结构迁移：+dl_api_token / −dl_channel / −dl_channel_preference
 * （api-web-agent §5.3；web-mgmt-20261125）。
 *
 * 纯 SQL（pg Client，**无 TypeORM 装饰器**，可独立编译——沿 migrate-mongo-to-pg 体例）：
 * - 本地：pnpm migrate:web-agent -- [--dry-run] [--pg-url=…]（env DATABASE_URL 兜底；
 *   .env 探测同 load-env 口径）
 * - 服务器（部署包内编译产物）：node dist/scripts/migrate-web-agent.js --dry-run
 *
 * 红线与口径：
 * - synchronize=false 不变——应用启动绝不自动改表，结构变更经本脚本显式执行；
 * - **幂等**：CREATE TABLE IF NOT EXISTS / CREATE [UNIQUE] INDEX IF NOT EXISTS /
 *   DROP TABLE IF EXISTS，可重跑；
 * - dl_generation_task / dl_usage_record **保留**（历史审计只读，不动）；
 * - dl_channel / dl_channel_preference 配置数据无审计价值（task/usage 行内渠道编码
 *   为快照字符串，无解引用依赖）——DROP 前报告行数，--dry-run 只报告不执行；
 * - 安全：连接串只经 env/参数，日志只打脱敏形态。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

/** 写目标最小接口（pg Client / pg-mem Client 均满足，可测） */
export interface PgExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows?: unknown[] }>;
}

/** dl_api_token DDL（api-web-agent §5.3 逐字；索引声明式登记 06 §3.5/§7） */
export const CREATE_API_TOKEN_SQL = `CREATE TABLE IF NOT EXISTS dl_api_token (
  token_id      varchar(32)  PRIMARY KEY,
  user_id       varchar(32)  NOT NULL,
  token_name    varchar(50)  NOT NULL,
  token_prefix  varchar(16)  NOT NULL,
  token_hash    varchar(64)  NOT NULL,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  data_version  integer      NOT NULL DEFAULT 0,
  delete_sign   integer      NOT NULL DEFAULT 0,
  created_by    varchar(32), created_name varchar(64), created_time timestamptz,
  updated_by    varchar(32), updated_name varchar(64), updated_time timestamptz
)`;

export const CREATE_API_TOKEN_INDEXES_SQL: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS uk_api_token_hash ON dl_api_token(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_api_token_user ON dl_api_token(user_id, delete_sign)`,
];

/** 退役表（渠道域 D-01；先 preference 后 channel，顺序仅为报告可读——无物理外键） */
export const DROP_TABLES: readonly string[] = ['dl_channel_preference', 'dl_channel'];

export interface WebAgentMigrationResult {
  dryRun: boolean;
  apiTokenCreated: boolean;
  indexesCreated: number;
  dropped: Array<{ table: string; rowsBefore: number | null }>;
}

/** 表是否存在（information_schema 自省） */
export async function tableExists(executor: PgExecutor, table: string): Promise<boolean> {
  const res = await executor.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return (res.rows ?? []).length > 0;
}

/** 表行数（不存在返回 null） */
export async function countRows(executor: PgExecutor, table: string): Promise<number | null> {
  if (!(await tableExists(executor, table))) {
    return null;
  }
  const res = await executor.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
  return Number((res.rows?.[0] as { cnt?: unknown } | undefined)?.cnt ?? 0);
}

/**
 * 执行结构迁移（幂等）：建 dl_api_token + 索引 → DROP 渠道两表。
 * dryRun=true 只报告现状，不执行任何 DDL。
 */
export async function migrateWebAgent(
  executor: PgExecutor,
  options: { dryRun: boolean },
): Promise<WebAgentMigrationResult> {
  const result: WebAgentMigrationResult = {
    dryRun: options.dryRun,
    apiTokenCreated: false,
    indexesCreated: 0,
    dropped: [],
  };

  const existed = await tableExists(executor, 'dl_api_token');
  // 应用层幂等守卫：已存在则整体跳过建表/索引（DDL 仍带 IF NOT EXISTS 双保险；
  // 亦规避 pg-mem 对已存在表 CREATE 语句的 AST 重解析限制）
  if (!options.dryRun && !existed) {
    await executor.query(CREATE_API_TOKEN_SQL);
    for (const sql of CREATE_API_TOKEN_INDEXES_SQL) {
      await executor.query(sql);
    }
  }
  result.apiTokenCreated = !existed;
  result.indexesCreated = CREATE_API_TOKEN_INDEXES_SQL.length;

  for (const table of DROP_TABLES) {
    const rowsBefore = await countRows(executor, table);
    if (!options.dryRun && rowsBefore !== null) {
      await executor.query(`DROP TABLE IF EXISTS ${table}`);
    }
    result.dropped.push({ table, rowsBefore });
  }
  return result;
}

/** 连接串脱敏（`://user:pass@host` → `://***@host`；日志/错误信息专用） */
export function maskUri(text: string): string {
  return text.replace(/:\/\/[^@/\s]+@/g, '://***@');
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

/** .env 探测（同 src/load-env.ts 口径：cwd/.env；真实环境变量优先） */
function loadDotEnv(): void {
  for (const file of [resolve(process.cwd(), '.env')]) {
    if (!existsSync(file)) {
      continue;
    }
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) {
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] === true;
  loadDotEnv();
  const pgUrl = typeof args['pg-url'] === 'string' ? args['pg-url'] : process.env.DATABASE_URL;
  if (!pgUrl) {
    console.error('缺少连接串：需提供 --pg-url 或 env DATABASE_URL');
    process.exit(2);
  }
  console.log(`[migrate-web-agent] 模式=${dryRun ? 'DRY-RUN（只报告不执行）' : '执行'}`);
  console.log(`[migrate-web-agent] 目标=${maskUri(pgUrl)}`);

  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  try {
    const result = await migrateWebAgent(pg, { dryRun });
    console.log(
      `[migrate-web-agent] dl_api_token: ${result.apiTokenCreated ? (dryRun ? '将新建' : '已新建') : '已存在（幂等跳过建表）'}` +
        `，索引 ${result.indexesCreated} 个（uk_api_token_hash / idx_api_token_user）`,
    );
    for (const { table, rowsBefore } of result.dropped) {
      if (rowsBefore === null) {
        console.log(`[migrate-web-agent] ${table}: 不存在（幂等跳过）`);
      } else {
        console.log(
          `[migrate-web-agent] ${table}: ${dryRun ? '将删除' : '已删除'}（删前行数=${rowsBefore}）`,
        );
      }
    }
    console.log('[migrate-web-agent] dl_generation_task / dl_usage_record 保留（历史审计只读，不动）');
  } finally {
    await pg.end();
  }
  console.log(`[migrate-web-agent] 完成${dryRun ? '（未执行）' : ''}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`[migrate-web-agent] 失败：${maskUri(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}