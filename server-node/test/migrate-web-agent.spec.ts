/**
 * ADR-018 结构迁移脚本单测（scripts/migrate-web-agent.ts）：
 * pg-mem 内存库验证 +dl_api_token（DDL/索引）/ −dl_channel / −dl_channel_preference /
 * 幂等重跑 / dry-run 只报告不执行 / 历史表保留。
 */
import { DataType, newDb } from 'pg-mem';
import {
  DROP_TABLES,
  countRows,
  migrateWebAgent,
  tableExists,
  type PgExecutor,
} from '../scripts/migrate-web-agent';

describe('migrate-web-agent（ADR-018 结构迁移）', () => {
  let pg: PgExecutor;
  let destroy: () => Promise<void>;

  beforeAll(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 14.0 (pg-mem)' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'deck_loop' });
    db.public.registerFunction({ name: 'current_schema', returns: DataType.text, implementation: () => 'public' });
    const { Client } = db.adapters.createPg();
    const client = new Client();
    await client.connect();
    pg = client as unknown as PgExecutor;
    destroy = () => client.end();
    // 铺底：渠道两表（退役对象）+ 历史审计表（保留对象）
    await pg.query(`CREATE TABLE dl_channel (channel_code varchar(32) PRIMARY KEY, channel_name varchar(64))`);
    await pg.query(`CREATE TABLE dl_channel_preference (preference_id varchar(32) PRIMARY KEY, user_id varchar(32))`);
    await pg.query(`CREATE TABLE dl_generation_task (task_id varchar(32) PRIMARY KEY)`);
    await pg.query(`CREATE TABLE dl_usage_record (usage_id varchar(32) PRIMARY KEY)`);
    await pg.query(`INSERT INTO dl_channel (channel_code, channel_name) VALUES ('MOCK', '模拟渠道')`);
    await pg.query(`INSERT INTO dl_channel_preference (preference_id, user_id) VALUES ('p1', 'u1')`);
    await pg.query(`INSERT INTO dl_generation_task (task_id) VALUES ('t1')`);
  });

  afterAll(async () => {
    await destroy();
  });

  it('dry-run：只报告现状，不执行 DDL', async () => {
    const result = await migrateWebAgent(pg, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.apiTokenCreated).toBe(true); // 尚不存在 → 将新建
    expect(result.dropped).toEqual([
      { table: 'dl_channel_preference', rowsBefore: 1 },
      { table: 'dl_channel', rowsBefore: 1 },
    ]);
    expect(await tableExists(pg, 'dl_api_token')).toBe(false);
    expect(await tableExists(pg, 'dl_channel')).toBe(true);
  });

  it('执行：建 dl_api_token + 索引，DROP 渠道两表，历史表保留', async () => {
    const result = await migrateWebAgent(pg, { dryRun: false });
    expect(result.apiTokenCreated).toBe(true);
    expect(await tableExists(pg, 'dl_api_token')).toBe(true);
    for (const table of DROP_TABLES) {
      expect(await tableExists(pg, table)).toBe(false);
    }
    // 历史审计表不动
    expect(await countRows(pg, 'dl_generation_task')).toBe(1);
    expect(await tableExists(pg, 'dl_usage_record')).toBe(true);

    // 唯一索引行为验证（INV-27：同哈希二次插入拒绝；pg-mem 无 pg_indexes 视图，
    // 以约束行为断言替代索引名查询）
    await pg.query(
      `INSERT INTO dl_api_token (token_id, user_id, token_name, token_prefix, token_hash)
       VALUES ('tok1', 'u1', '甲', 'dlpat_aaaaaa', '${'a'.repeat(64)}')`,
    );
    await expect(
      pg.query(
        `INSERT INTO dl_api_token (token_id, user_id, token_name, token_prefix, token_hash)
         VALUES ('tok2', 'u1', '乙', 'dlpat_bbbbbb', '${'a'.repeat(64)}')`,
      ),
    ).rejects.toThrow();
  });

  it('幂等重跑：已存在跳过建表，已删除表报告不存在', async () => {
    const result = await migrateWebAgent(pg, { dryRun: false });
    expect(result.apiTokenCreated).toBe(false);
    expect(result.dropped).toEqual([
      { table: 'dl_channel_preference', rowsBefore: null },
      { table: 'dl_channel', rowsBefore: null },
    ]);
    expect(await countRows(pg, 'dl_api_token')).toBe(1);
  });
});