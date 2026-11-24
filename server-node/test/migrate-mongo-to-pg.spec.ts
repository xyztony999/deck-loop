/**
 * 迁移脚本单测（ADR-016 §5；scripts/migrate-mongo-to-pg.ts）。
 * pg-mem 内存库 + 内存源文档跑通 transform / 批量 upsert / 默认值 / 幂等 / 聚合校验全链，
 * 不依赖真实 Mongo/PG。
 */
import { DataType, newDb } from 'pg-mem';
import { ALL_ENTITIES } from '../src/common/typeorm-config';
import {
  TABLES,
  buildUpsertSql,
  countTarget,
  migrateTable,
  parseColumnDefault,
  sumTarget,
  transformDoc,
  type ColumnMeta,
  type PgExecutor,
  type SourceDoc,
} from '../scripts/migrate-mongo-to-pg';

describe('migrate-mongo-to-pg（纯函数 + pg-mem 全链）', () => {
  let pg: PgExecutor;
  let destroy: () => Promise<void>;

  beforeAll(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 14.0 (pg-mem)' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'deck_loop' });
    db.public.registerFunction({ name: 'current_schema', returns: DataType.text, implementation: () => 'public' });
    const dataSource = await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: ALL_ENTITIES,
      synchronize: true,
    });
    await dataSource.initialize();
    const { Client } = db.adapters.createPg();
    const client = new Client();
    await client.connect();
    pg = client as unknown as PgExecutor;
    destroy = () => dataSource.destroy();
  });

  afterAll(async () => {
    await destroy();
  });

  it('表清单覆盖全部 11 张物理表且主键齐备', () => {
    expect(TABLES.map((t) => t.table).sort()).toEqual(
      [
        'dl_account', 'dl_asset', 'dl_brand_kit', 'dl_channel', 'dl_channel_preference',
        'dl_deck', 'dl_deck_version', 'dl_export_task', 'dl_generation_task',
        'dl_prompt_template', 'dl_usage_record',
      ].sort(),
    );
  });

  it('列默认值表达式解析（字面量形态）', () => {
    expect(parseColumnDefault("'main'::character varying")).toBe('main');
    expect(parseColumnDefault('0')).toBe(0);
    expect(parseColumnDefault('false')).toBe(false);
    expect(parseColumnDefault("'[]'::jsonb")).toBe('[]');
    expect(parseColumnDefault("nextval('seq'::regclass)")).toBeNull();
    expect(parseColumnDefault(null)).toBeNull();
  });

  it('transform：丢弃 _id/__v、报告未知键、json 列字符串化、缺失补列默认', () => {
    const columns: ColumnMeta[] = [
      { name: 'deck_id', dataType: 'character varying', columnDefault: null, isNullable: false },
      { name: 'deck_name', dataType: 'character varying', columnDefault: null, isNullable: false },
      { name: 'draft_outline', dataType: 'jsonb', columnDefault: null, isNullable: true },
      { name: 'active_branch', dataType: 'character varying', columnDefault: "'main'::character varying", isNullable: false },
      { name: 'data_version', dataType: 'integer', columnDefault: '0', isNullable: false },
      { name: 'delete_sign', dataType: 'integer', columnDefault: null, isNullable: false },
    ];
    const doc: SourceDoc = {
      _id: 'mongo-oid',
      __v: 3,
      legacyField: 'x',
      deck_id: '1001',
      deck_name: '测试',
      draft_outline: { pages: [{ pageId: 'p1' }] },
      created_time: new Date('2026-10-09T13:00:00Z'),
    };
    const { row, droppedKeys, missingPk } = transformDoc(doc, columns, 'deck_id');
    expect(missingPk).toBe(false);
    // _id/__v 静默忽略；legacyField/created_time（不在给定列集内）计入丢弃报告
    expect(droppedKeys.sort()).toEqual(['created_time', 'legacyField']);
    expect(row.draft_outline).toBe(JSON.stringify({ pages: [{ pageId: 'p1' }] }));
    expect(row.active_branch).toBe('main');
    expect(row.data_version).toBe(0);
    // delete_sign：NOT NULL 且默认未知 → 零值兜底
    expect(row.delete_sign).toBe(0);
  });

  it('upsert SQL：占位符与参数位次严格对齐', () => {
    const { sql, paramCount } = buildUpsertSql('dl_t', ['id', 'a', 'b'], 'id', 2);
    expect(sql).toBe(
      'INSERT INTO dl_t (id, a, b) VALUES ($1,$2,$3), ($4,$5,$6) ON CONFLICT (id) DO UPDATE SET a = EXCLUDED.a, b = EXCLUDED.b',
    );
    expect(paramCount).toBe(6);
  });

  it('全链：批量 upsert + 缺主键跳过 + 默认补齐 + 幂等重跑 + 聚合校验', async () => {
    const spec = TABLES.find((t) => t.table === 'dl_usage_record')!;
    const at = new Date('2026-10-09T13:00:00Z');
    const docs: SourceDoc[] = [
      {
        _id: 'oid1',
        usage_id: '9001',
        user_id: 'u1',
        task_id: 't1',
        task_type: 'FULL_GENERATE',
        channel_code: 'MOCK',
        model_code: 'MOCK-LITE',
        prompt_tokens: 120,
        completion_tokens: 80,
        occurred_at: at,
      },
      {
        usage_id: '9002',
        user_id: 'u1',
        task_id: 't2',
        task_type: 'OUTLINE',
        channel_code: 'MOCK',
        model_code: 'MOCK-LITE',
        // tokens 缺失 → 列默认 0（真 PG 走 column_default；pg-mem 不上报默认 → NOT NULL 零值兜底）
        occurred_at: at,
      },
      {
        // 缺主键 → 跳过
        user_id: 'u1',
        task_id: 't3',
        occurred_at: at,
      },
    ];

    const first = await migrateTable(docs, pg, spec, { dryRun: false, batchSize: 2 });
    expect(first.sourceCount).toBe(3);
    expect(first.toWrite).toBe(2);
    expect(first.skippedMissingPk).toBe(1);
    expect(first.sourceSums).toEqual({ prompt_tokens: 120, completion_tokens: 80 });
    expect(await countTarget(pg, 'dl_usage_record')).toBe(2);
    expect(await sumTarget(pg, 'dl_usage_record', 'prompt_tokens')).toBe(120);

    const rows = (await pg.query(
      'SELECT usage_id, model_code, prompt_tokens, completion_tokens FROM dl_usage_record ORDER BY usage_id',
    )).rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ usage_id: '9001', model_code: 'MOCK-LITE', prompt_tokens: 120 });
    expect(rows[1]).toMatchObject({ usage_id: '9002', model_code: 'MOCK-LITE', prompt_tokens: 0, completion_tokens: 0 });

    // 幂等重跑：同主键更新不翻倍
    const rerun = await migrateTable(
      [{ ...docs[0], prompt_tokens: 150 }],
      pg,
      spec,
      { dryRun: false },
    );
    expect(rerun.toWrite).toBe(1);
    expect(await countTarget(pg, 'dl_usage_record')).toBe(2);
    expect(await sumTarget(pg, 'dl_usage_record', 'prompt_tokens')).toBe(150);
  });

  it('dry-run：不写目标', async () => {
    const spec = TABLES.find((t) => t.table === 'dl_channel_preference')!;
    const before = await countTarget(pg, 'dl_channel_preference');
    const result = await migrateTable(
      [{ _id: 'x', preference_id: 'p1', user_id: 'u9', preference_map: { OUTLINE: { channelCode: 'MOCK' } } }],
      pg,
      spec,
      { dryRun: true },
    );
    expect(result.toWrite).toBe(1);
    expect(result.sample?.preference_id).toBe('p1');
    expect(await countTarget(pg, 'dl_channel_preference')).toBe(before);
  });

  it('目标表无列时显式报错（提示先 init-schema）', async () => {
    const fake: PgExecutor = { query: async () => ({ rows: [] }) };
    await expect(
      migrateTable([{ a: 1 }], fake, { table: 'dl_missing', pk: 'a' }, { dryRun: false }),
    ).rejects.toThrow(/init-schema/);
  });
});
