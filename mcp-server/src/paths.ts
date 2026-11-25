/**
 * 本地数据目录解析（ADR-017 本地优先）。
 *
 * 默认 ~/.deck-loop/（env DECK_LOOP_HOME 可覆盖）：
 * - deck-loop.db：SQLite 库（11 表与线上 PG 同构，可选同步预留）
 * - assets/：素材内容寻址存储（ASSET_STORAGE_DIR）
 * - artifacts/：导出产物（EXPORT_ARTIFACT_DIR）
 * - previews/：HTML 预览产物
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface LocalPaths {
  home: string;
  database: string;
  assetsDir: string;
  artifactsDir: string;
  previewsDir: string;
}

export function resolvePaths(): LocalPaths {
  const home = resolve(process.env.DECK_LOOP_HOME ?? join(homedir(), '.deck-loop'));
  return {
    home,
    database: join(home, 'deck-loop.db'),
    assetsDir: join(home, 'assets'),
    artifactsDir: join(home, 'artifacts'),
    previewsDir: join(home, 'previews'),
  };
}

/** 建目录 + 存储 env 注入（须先于 createLocalCore——存储服务构造期读 env） */
export function prepareStorage(paths: LocalPaths): void {
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.assetsDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });
  mkdirSync(paths.previewsDir, { recursive: true });
  process.env.ASSET_STORAGE_DIR ??= paths.assetsDir;
  process.env.EXPORT_ARTIFACT_DIR ??= paths.artifactsDir;
}