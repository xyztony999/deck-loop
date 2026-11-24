import '../load-env';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES, buildTypeOrmOptions } from '../common/typeorm-config';

/**
 * 一次性建表脚本（生产 DDL 入口；ADR-016）。
 *
 * - 应用运行时 `synchronize=false`（红线：应用启动绝不自动改表）；表/索引由本脚本
 *   **显式一次性**按 entity 同步创建。
 * - 安全闸：目标库已存在本应用任一表时拒绝执行（防对非空库做破坏性结构同步），
 *   确需重建加 `--force`（会按 entity 对齐列，可能删列——仅限空库/开发）。
 * - 运行（服务器，工程根目录下，.env 同目录）：
 *     cd /www/wwwroot/deck-loop && node server-node/dist/scripts/init-schema.js
 *   本地开发：pnpm init-schema
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const base = buildTypeOrmOptions();

  // 探测阶段（synchronize=false，只读元数据）：计算表名清单 + 已存在表
  const probe = new DataSource(base);
  await probe.initialize();
  let tableNames: string[] = [];
  let existing: string[] = [];
  try {
    tableNames = probe.entityMetadatas.map((m) => m.tableName).sort();
    const placeholders = tableNames.map((_, i) => `$${i + 1}`).join(',');
    const rows = (await probe.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
      tableNames,
    )) as Array<{ table_name: string }>;
    existing = rows.map((r) => r.table_name).sort();
  } finally {
    await probe.destroy();
  }

  if (existing.length > 0 && !force) {
    console.error(
      `[init-schema] 目标库已存在表 [${existing.join(', ')}]——为防止对非空库做结构同步，已拒绝执行。` +
        '空库首次建表不应出现此提示；确需强制对齐请加 --force（可能删列，先备份）。',
    );
    process.exit(1);
  }

  const dataSource = new DataSource({ ...base, synchronize: true });
  await dataSource.initialize();
  try {
    const created = dataSource.entityMetadatas.map((m) => m.tableName).sort();
    console.log(`[init-schema] 已建表 ${created.length} 张：${created.join(', ')}`);
    const indexCount = dataSource.entityMetadatas.reduce((sum, m) => sum + m.indices.length, 0);
    console.log(`[init-schema] 索引 ${indexCount} 个（含 entity 声明的唯一/普通索引）`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(`[init-schema] 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
