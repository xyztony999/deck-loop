import { translatePgToSqlite } from '../src/local/sqlite-dialect';

/**
 * ADR-017：PG → SQLite 方言翻译单测（纯函数）。
 * 覆盖：$n 乱序/重复重排、::int 剥离、ILIKE→LIKE+ESCAPE、FOR UPDATE 剥离、
 * GREATEST→MAX、now()→UTC 参数、QB 纯 ? 形态参数保序、无 PG 构造原样返回。
 */
describe('PG → SQLite 方言翻译', () => {
  it('无 PG 构造原样返回（参数浅拷贝）', () => {
    const params = [1, 'x'];
    const result = translatePgToSqlite('SELECT a FROM t WHERE b = ? AND c = ?', params);
    expect(result.sql).toBe('SELECT a FROM t WHERE b = ? AND c = ?');
    expect(result.params).toEqual(params);
    expect(result.params).not.toBe(params);
  });

  it('纯 LIKE 亦补 ESCAPE（escapeLike 反斜杠转义语义对齐）', () => {
    const result = translatePgToSqlite('SELECT x FROM t WHERE code LIKE ?', ['DL%']);
    expect(result.sql).toBe("SELECT x FROM t WHERE code LIKE ? ESCAPE '\\'");
  });

  it('$n 乱序引用按出现位次重排参数', () => {
    const result = translatePgToSqlite(
      'SELECT x FROM t WHERE a = $2 AND b = $1',
      ['first', 'second'],
    );
    expect(result.sql).toBe('SELECT x FROM t WHERE a = ? AND b = ?');
    expect(result.params).toEqual(['second', 'first']);
  });

  it('$n 重复引用重复推值', () => {
    const result = translatePgToSqlite(
      'SELECT x FROM t WHERE a = $1 OR b = $1',
      ['v'],
    );
    expect(result.params).toEqual(['v', 'v']);
  });

  it('::int cast 剥离', () => {
    const result = translatePgToSqlite(
      'SELECT COUNT(*)::int AS cnt FROM t WHERE id = $1',
      ['id1'],
    );
    expect(result.sql).toBe('SELECT COUNT(*) AS cnt FROM t WHERE id = ?');
    expect(result.params).toEqual(['id1']);
  });

  it('FOR UPDATE 剥离（事务内取号）', () => {
    const result = translatePgToSqlite(
      'SELECT version_seq FROM dl_deck_version WHERE deck_id = $1 ORDER BY version_seq DESC LIMIT 1 FOR UPDATE',
      ['d1'],
    );
    expect(result.sql).toBe(
      'SELECT version_seq FROM dl_deck_version WHERE deck_id = ? ORDER BY version_seq DESC LIMIT 1 ',
    );
    expect(result.params).toEqual(['d1']);
  });

  it('ILIKE → LIKE 并补 ESCAPE（原生 $n 形态）', () => {
    const result = translatePgToSqlite(
      'SELECT x FROM t WHERE name ILIKE $1',
      ['%kw%'],
    );
    expect(result.sql).toBe("SELECT x FROM t WHERE name LIKE ? ESCAPE '\\'");
    expect(result.params).toEqual(['%kw%']);
  });

  it('QB 纯 ? 形态：ILIKE 替换 + ESCAPE，参数位次不变', () => {
    const result = translatePgToSqlite(
      'SELECT "d"."deck_id" FROM "dl_deck" "d" WHERE "d"."deck_name" ILIKE ? AND "d"."user_id" = ?',
      ['%kw%', 'u1'],
    );
    expect(result.sql).toBe(
      'SELECT "d"."deck_id" FROM "dl_deck" "d" WHERE "d"."deck_name" LIKE ? ESCAPE \'\\\' AND "d"."user_id" = ?',
    );
    expect(result.params).toEqual(['%kw%', 'u1']);
  });

  it('adjustRefCounts 真实 SQL：GREATEST→MAX + now()→UTC 参数 + IN 展开', () => {
    const result = translatePgToSqlite(
      'UPDATE dl_asset SET ref_count = GREATEST(ref_count + $1, 0), updated_time = now() WHERE user_id = $2 AND asset_id IN ($3)',
      [1, 'local', 'a1'],
    );
    expect(result.sql).toBe(
      'UPDATE dl_asset SET ref_count = MAX(ref_count + ?, 0), updated_time = ? WHERE user_id = ? AND asset_id IN (?)',
    );
    expect(result.params).toHaveLength(4);
    expect(result.params[0]).toBe(1);
    expect(String(result.params[1])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(result.params[2]).toBe('local');
    expect(result.params[3]).toBe('a1');
  });

  it('now() UTC 串与 TypeORM sqlite datetime 归一格式一致', () => {
    const before = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const result = translatePgToSqlite('UPDATE t SET updated_time = now() WHERE id = $1', ['x']);
    const after = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const stamp = String(result.params[0]);
    expect(stamp >= before && stamp <= after).toBe(true);
  });
});