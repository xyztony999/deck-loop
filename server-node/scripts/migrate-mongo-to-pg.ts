/**
 * 一次性数据迁移：MongoDB → PostgreSQL（ADR-016 §5；api-persistence-migration.md）。
 *
 * 纯 SQL：mongodb 驱动读源 + pg Client 写目标，**无 TypeORM 装饰器**（可独立编译）。
 * - 本地：pnpm migrate:mongo-to-pg -- [--dry-run] [--mongo-uri=…] [--pg-url=…]
 *   （env MONGODB_URI / DATABASE_URL 兜底；.env 探测同 load-env 口径）
 * - 服务器（部署包内编译产物）：node dist/scripts/migrate-mongo-to-pg.js --dry-run
 *
 * 流程：连接源/目标 → 逐表全量读 → transform → 批量 `INSERT … ON CONFLICT (PK)
 * DO UPDATE`（幂等，可重跑追平切换窗口内的增量）→ 逐表 count 校验 + 关键聚合比对。
 * - 目标表须已存在（先跑 `node dist/scripts/init-schema.js`）；列集自
 *   information_schema 运行时读取——文档中不属于目标列的键被丢弃并汇总报告。
 * - 键缺失（undefined）按目标列默认值补齐（默认值解析自 information_schema，
 *   不硬编码——避免 NULL 与 0 语义漂移）；显式 null 保持 NULL。
 * - `--dry-run`：只读源 + transform + 统计，不写目标。
 * - 安全：连接串只经 env/参数，日志只打脱敏形态；**绝不删除源数据**
 *   （Mongo 下线另经授权）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { Client } from 'pg';

/* ------------------------------------------------------------------ */
/* 表清单（集合名 = 表名；PK = 业务主键雪花串）                         */
/* ------------------------------------------------------------------ */

export interface TableSpec {
  table: string;
  pk: string;
}

/**
 * 全部 10 张物理表（无外键约束，顺序仅为报告可读）。
 * ADR-018（web-mgmt-20261125）：dl_channel/dl_channel_preference 退役不再迁移
 * （配置数据无审计价值，DROP 见 scripts/migrate-web-agent.ts）；+dl_api_token。
 */
export const TABLES: readonly TableSpec[] = [
  { table: 'dl_account', pk: 'account_id' },
  { table: 'dl_api_token', pk: 'token_id' },
  { table: 'dl_brand_kit', pk: 'brand_kit_id' },
  { table: 'dl_prompt_template', pk: 'template_id' },
  { table: 'dl_asset', pk: 'asset_id' },
  { table: 'dl_deck', pk: 'deck_id' },
  { table: 'dl_generation_task', pk: 'task_id' },
  { table: 'dl_deck_version', pk: 'version_id' },
  { table: 'dl_export_task', pk: 'export_id' },
  { table: 'dl_usage_record', pk: 'usage_id' },
];

/** 关键聚合校验字段（源文档求和 vs 目标 SUM；空/null 不计） */
const SUM_FIELDS: Record<string, readonly string[]> = {
  dl_usage_record: ['prompt_tokens', 'completion_tokens'],
  dl_asset: ['ref_count'],
};

const BATCH_SIZE = 200;

/* ------------------------------------------------------------------ */
/* 纯函数（可测：pg-mem + 内存源即可跑通全链）                          */
/* ------------------------------------------------------------------ */

export interface ColumnMeta {
  name: string;
  dataType: string;
  /** information_schema.column_default（可空；部分驱动/内存库不上报） */
  columnDefault: string | null;
  /** information_schema.is_nullable（'YES'/'NO'） */
  isNullable: boolean;
}

/** 源文档类型（Mongo 文档以宽松形态读取） */
export type SourceDoc = Record<string, unknown>;

/** 写目标最小接口（pg Client / pg-mem Client 均满足） */
export interface PgExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows?: unknown[] }>;
}

interface Row {
  [column: string]: unknown;
}

/**
 * 解析 PG 列默认值表达式为 JS 值（仅认常见字面量形态；函数/序列等 → null）：
 * `'main'::character varying` → 'main'；`0` → 0；`false` → false；`'[]'::jsonb` → '[]'。
 */
export function parseColumnDefault(expr: string | null | undefined): unknown {
  if (typeof expr !== 'string') {
    return null;
  }
  let text = expr.trim();
  // 剥离显式类型转换（可能嵌套多层，如 'x'::character varying::text）
  while (true) {
    const cast = /^'((?:[^']|'')*)'(?:::.+)?$/.exec(text);
    if (cast !== null) {
      return cast[1].replace(/''/g, "'");
    }
    const next = /^([^:]+)::[\w\s."()[\]]+$/.exec(text);
    if (next === null) {
      break;
    }
    text = next[1].trim();
  }
  if (/^-?\d+$/.test(text)) {
    return Number(text);
  }
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  return null;
}

/**
 * 「NOT NULL 且默认值未知」时的类型零值兜底（仅数值/布尔——与 PG 常见默认 0/false 一致；
 * 文本/json 不臆造，留 null 交由目标库拒绝并暴露脏文档）。
 * 背景：pg-mem 的 information_schema 不上报 column_default，真 PG 不会走到这里。
 */
export function zeroValueForType(dataType: string): unknown {
  const type = dataType.toLowerCase();
  if (type === 'boolean') {
    return false;
  }
  if (
    type === 'integer' ||
    type === 'int' ||
    type === 'bigint' ||
    type === 'smallint' ||
    type === 'numeric' ||
    type === 'real' ||
    type === 'double precision'
  ) {
    return 0;
  }
  return null;
}

/** 列值归一：undefined→列默认（未知则 NOT NULL 零值兜底）；json 列字符串化；Date 原样 */
export function toColumnValue(raw: unknown, column: ColumnMeta): unknown {
  if (raw === undefined) {
    const parsed = parseColumnDefault(column.columnDefault);
    if (parsed !== null || column.isNullable) {
      return parsed;
    }
    return zeroValueForType(column.dataType);
  }
  if (raw === null) {
    return null;
  }
  const type = column.dataType.toLowerCase();
  if (type === 'jsonb' || type === 'json') {
    return typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if (raw instanceof Date) {
    return raw;
  }
  if (typeof raw === 'object') {
    // 非预期对象（防御）：序列化，避免驱动报错
    return JSON.stringify(raw);
  }
  return raw;
}

/** 单文档 transform：丢弃 _id/__v；按目标列裁剪；返回行 + 被丢弃键 + PK 缺失标记 */
export function transformDoc(
  doc: SourceDoc,
  columns: readonly ColumnMeta[],
  pk: string,
): { row: Row; droppedKeys: string[]; missingPk: boolean } {
  const row: Row = {};
  const wanted = new Set(columns.map((c) => c.name));
  const droppedKeys: string[] = [];
  for (const key of Object.keys(doc)) {
    if (key === '_id' || key === '__v' || wanted.has(key)) {
      continue;
    }
    droppedKeys.push(key);
  }
  for (const column of columns) {
    row[column.name] = toColumnValue(doc[column.name], column);
  }
  const pkValue = row[pk];
  return {
    row,
    droppedKeys,
    missingPk: pkValue === null || pkValue === undefined || pkValue === '',
  };
}

/** 批量 upsert SQL（多行 VALUES + ON CONFLICT (pk) DO UPDATE 全量非主键列） */
export function buildUpsertSql(
  table: string,
  columnNames: readonly string[],
  pk: string,
  rowCount: number,
): { sql: string; paramCount: number } {
  const nonPk = columnNames.filter((name) => name !== pk);
  const rows: string[] = [];
  let index = 1;
  for (let r = 0; r < rowCount; r += 1) {
    const cell: string[] = [];
    for (let c = 0; c < columnNames.length; c += 1) {
      cell.push(`$${index}`);
      index += 1;
    }
    rows.push(`(${cell.join(',')})`);
  }
  const updates =
    nonPk.length > 0 ? nonPk.map((name) => `${name} = EXCLUDED.${name}`).join(', ') : `${pk} = EXCLUDED.${pk}`;
  const sql =
    `INSERT INTO ${table} (${columnNames.join(', ')}) VALUES ${rows.join(', ')} ` +
    `ON CONFLICT (${pk}) DO UPDATE SET ${updates}`;
  return { sql, paramCount: index - 1 };
}

/** 读取目标表列集（名称/类型/默认；information_schema 运行时自省） */
export async function fetchColumns(executor: PgExecutor, table: string): Promise<ColumnMeta[]> {
  const res = await executor.query(
    `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  const rows = (res.rows ?? []) as Array<{
    column_name: string;
    data_type: string;
    column_default: string | null;
    is_nullable?: string;
  }>;
  return rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    columnDefault: r.column_default ?? null,
    isNullable: r.is_nullable !== 'NO',
  }));
}

export interface MigrateTableResult {
  table: string;
  sourceCount: number;
  /** 已写入（dry-run=将写入）行数 */
  toWrite: number;
  skippedMissingPk: number;
  droppedKeys: string[];
  /** 源侧字段求和（SUM_FIELDS；空/null 不计） */
  sourceSums: Record<string, number>;
  /** 首行 transform 样本（dry-run 抽样报告） */
  sample: Row | null;
}

async function* iterate(source: AsyncIterable<SourceDoc> | Iterable<SourceDoc>): AsyncIterable<SourceDoc> {
  yield* source as AsyncIterable<SourceDoc>;
}

function sumOf(docs: SourceDoc, fields: readonly string[], into: Record<string, number>): void {
  for (const field of fields) {
    const value = docs[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      into[field] = (into[field] ?? 0) + value;
    }
  }
}

/**
 * 迁移单表：源（可迭代）分批 upsert 到目标。
 * 每批一个事务（BEGIN/COMMIT），失败回滚该批并抛出；重跑幂等。
 */
export async function migrateTable(
  source: AsyncIterable<SourceDoc> | Iterable<SourceDoc>,
  executor: PgExecutor,
  spec: TableSpec,
  options: { dryRun: boolean; batchSize?: number },
): Promise<MigrateTableResult> {
  const columns = await fetchColumns(executor, spec.table);
  if (columns.length === 0) {
    throw new Error(`目标表不存在或无列：${spec.table}（请先运行 init-schema 建表）`);
  }
  const names = columns.map((c) => c.name);
  if (!names.includes(spec.pk)) {
    throw new Error(`目标表 ${spec.table} 缺少主键列 ${spec.pk}`);
  }
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const sumFields = SUM_FIELDS[spec.table] ?? [];
  const sourceSums: Record<string, number> = {};
  const dropped = new Set<string>();
  let sourceCount = 0;
  let toWrite = 0;
  let skipped = 0;
  let sample: Row | null = null;
  const batch: unknown[][] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) {
      return;
    }
    if (!options.dryRun) {
      const { sql, paramCount } = buildUpsertSql(spec.table, names, spec.pk, batch.length);
      const params = batch.flat();
      if (params.length !== paramCount) {
        throw new Error(`参数位次错位：${spec.table} 期望 ${paramCount} 实得 ${params.length}`);
      }
      await executor.query('BEGIN');
      try {
        await executor.query(sql, params);
        await executor.query('COMMIT');
      } catch (err) {
        await executor.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    }
    toWrite += batch.length;
    batch.length = 0;
  };

  for await (const doc of iterate(source)) {
    sourceCount += 1;
    sumOf(doc, sumFields, sourceSums);
    const { row, droppedKeys, missingPk } = transformDoc(doc, columns, spec.pk);
    for (const key of droppedKeys) {
      dropped.add(key);
    }
    if (missingPk) {
      skipped += 1;
      continue;
    }
    if (sample === null) {
      sample = row;
    }
    batch.push(names.map((name) => row[name]));
    if (batch.length >= batchSize) {
      await flush();
    }
  }
  await flush();

  return {
    table: spec.table,
    sourceCount,
    toWrite,
    skippedMissingPk: skipped,
    droppedKeys: [...dropped],
    sourceSums,
    sample,
  };
}

/** 目标表行数 */
export async function countTarget(executor: PgExecutor, table: string): Promise<number> {
  const res = await executor.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
  return Number((res.rows?.[0] as { cnt?: unknown } | undefined)?.cnt ?? 0);
}

/** 目标表字段求和（COALESCE→0；与源侧「空/null 不计」口径一致） */
export async function sumTarget(executor: PgExecutor, table: string, field: string): Promise<number> {
  const res = await executor.query(`SELECT COALESCE(SUM(${field}), 0)::int AS total FROM ${table}`);
  return Number((res.rows?.[0] as { total?: unknown } | undefined)?.total ?? 0);
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
  const mongoUri = typeof args['mongo-uri'] === 'string' ? args['mongo-uri'] : process.env.MONGODB_URI;
  const pgUrl = typeof args['pg-url'] === 'string' ? args['pg-url'] : process.env.DATABASE_URL;
  if (!mongoUri || !pgUrl) {
    console.error('缺少连接串：需提供 --mongo-uri/--pg-url 或 env MONGODB_URI/DATABASE_URL');
    process.exit(2);
  }
  console.log(`[migrate] 模式=${dryRun ? 'DRY-RUN（只读不写）' : '写入'}`);
  console.log(`[migrate] 源=${maskUri(mongoUri)}`);
  console.log(`[migrate] 目标=${maskUri(pgUrl)}`);

  const mongo = new MongoClient(mongoUri);
  const pg = new Client({ connectionString: pgUrl });
  await mongo.connect();
  await pg.connect();
  let failed = false;
  try {
    const db = mongo.db();
    for (const spec of TABLES) {
      const collections = await db.listCollections({ name: spec.table }, { nameOnly: true }).toArray();
      if (collections.length === 0) {
        console.log(`[migrate] ${spec.table}: 源集合不存在，跳过`);
        continue;
      }
      const cursor = db.collection(spec.table).find({}).batchSize(BATCH_SIZE);
      const result = await migrateTable(cursor, pg, spec, { dryRun });
      const dropped = result.droppedKeys.length > 0 ? ` 丢弃键=[${result.droppedKeys.join(',')}]` : '';
      const skipped = result.skippedMissingPk > 0 ? ` ⚠缺主键跳过=${result.skippedMissingPk}` : '';
      console.log(
        `[migrate] ${spec.table}: 源=${result.sourceCount} ${dryRun ? '将写入' : '已写入'}=${result.toWrite}${skipped}${dropped}`,
      );
      if (dryRun && result.sample !== null) {
        const preview: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(result.sample)) {
          const text = value instanceof Date ? value.toISOString() : String(value);
          preview[key] = text.length > 40 ? `${text.slice(0, 40)}…` : text;
        }
        console.log(`[migrate]   样本=${JSON.stringify(preview)}`);
      }
      if (!dryRun) {
        const target = await countTarget(pg, spec.table);
        if (target !== result.sourceCount) {
          // 目标可能含源中不存在的行（如 builtin 渠道 seed）；只警告不中断，由人工核对
          console.log(`[migrate]   目标行数=${target}（源 ${result.sourceCount}，差异 ${target - result.sourceCount}）`);
        }
        for (const [field, sourceSum] of Object.entries(result.sourceSums)) {
          const targetSum = await sumTarget(pg, spec.table, field);
          if (targetSum !== sourceSum) {
            failed = true;
            console.log(`[migrate]   ✗ 聚合不一致 ${field}: 源=${sourceSum} 目标=${targetSum}`);
          } else {
            console.log(`[migrate]   ✓ 聚合一致 ${field}=${sourceSum}`);
          }
        }
      }
    }
  } finally {
    await pg.end();
    await mongo.close();
  }
  if (failed) {
    console.error('[migrate] 存在聚合不一致，请人工核对后重跑（幂等）');
    process.exit(1);
  }
  console.log(`[migrate] 完成${dryRun ? '（未写入）' : ''}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`[migrate] 失败：${maskUri(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}
