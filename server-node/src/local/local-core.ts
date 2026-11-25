/**
 * 本地 headless 核心运行时（ADR-017 本地优先 MCP）。
 *
 * 同一套域模块（deck/version/asset/deliver）跑在 SQLite 上，供 mcp-server 进程内
 * 直调——无 HTTP、无鉴权、无网关（AI 推理由 coding agent 侧承担）。线上 PG 服务
 * （main.ts/AppModule）不经本模块，行为不变。
 *
 * 复用口径：
 * - 直接 import 四域真实模块（application context 不实例化 controller，无路由绑定）；
 * - entity 列类型经 common/db-column-types 常量切换（**调用方须在 import 本模块前
 *   设置 process.env.DECK_LOOP_DB='sqlite'**，createLocalCore 入口断言兜底）；
 * - 仓储 PG 口径 SQL 在 QueryRunner.prototype.query 唯一漏斗翻译（sqlite-dialect），
 *   QueryBuilder 与原生 query 两条路径全覆盖；
 * - better-sqlite3 驱动对象由宿主经 options.driver 注入（TypeORM SqliteConnectionOptions
 *   .driver），本包依赖树不引 native 驱动。
 *
 * reflect-metadata 首行 import：保证装饰器元数据与 core 树单实例（mcp 宿主不得
 * 另行 import 第二份 reflect-metadata/typeorm，否则元数据/实例同一性断裂）。
 */
import 'reflect-metadata';
import { Module, type INestApplicationContext, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../common/typeorm-config';
import { AssetModule } from '../asset/asset.module';
import { DeckModule } from '../deck/deck.module';
import { DeliverModule } from '../deliver/deliver.module';
import { VersionModule } from '../version/version.module';
import { translatePgToSqlite } from './sqlite-dialect';

/** 本地核心创建选项 */
export interface LocalCoreOptions {
  /** SQLite 数据库文件路径（':memory:' 供测试） */
  database: string;
  /** better-sqlite3 模块对象（宿主注入，避免 core 树引 native 依赖） */
  driver?: unknown;
  /** 自动建表（本地单用户库默认 true；生产 PG 红线 synchronize=false 不受影响） */
  synchronize?: boolean;
}

/** 本地核心句柄（域服务经 get(Class) 取用） */
export interface LocalCore {
  context: INestApplicationContext;
  dataSource: DataSource;
  get<T>(cls: Type<T>): T;
  close(): Promise<void>;
}

/** QueryRunner 原型翻译补丁标记（同进程多核心共享原型，防重复包裹） */
const PATCH_FLAG = '__deckLoopSqliteDialectPatched';

/**
 * 创建本地 headless 核心（Nest application context + SQLite）。
 * @throws Error DECK_LOOP_DB 未置 sqlite（entity 列类型已按 PG 加载，不可运行）
 */
export async function createLocalCore(options: LocalCoreOptions): Promise<LocalCore> {
  if (process.env.DECK_LOOP_DB !== 'sqlite') {
    throw new Error(
      'createLocalCore 要求先设置 process.env.DECK_LOOP_DB="sqlite"（须在 import entity 前）',
    );
  }

  @Module({
    imports: [
      TypeOrmModule.forRootAsync({
        useFactory: () => ({
          type: 'better-sqlite3' as const,
          database: options.database,
          driver: options.driver,
          entities: ALL_ENTITIES,
          synchronize: options.synchronize ?? true,
          logging: false,
        }),
      }),
      EventEmitterModule.forRoot(),
      DeckModule,
      VersionModule,
      AssetModule,
      DeliverModule,
    ],
  })
  class LocalCoreModule {}

  const context = await NestFactory.createApplicationContext(LocalCoreModule, {
    logger: false,
  });
  const dataSource = context.get(DataSource);
  patchSqliteDialect(dataSource);

  return {
    context,
    dataSource,
    get: <T>(cls: Type<T>): T => context.get(cls),
    close: () => context.close(),
  };
}

/**
 * QueryRunner.prototype.query 包裹方言翻译（QB 与原生 query 的唯一漏斗；
 * EntityManager.query → DataSource.query → runner.query 亦经此）。
 */
function patchSqliteDialect(dataSource: DataSource): void {
  const runner = dataSource.createQueryRunner();
  const proto = Object.getPrototypeOf(runner) as Record<string, unknown> & {
    query: (sql: string, params?: unknown[], useStructuredResult?: boolean) => Promise<unknown>;
  };
  void runner.release();
  if (proto[PATCH_FLAG] === true) {
    return;
  }
  const original = proto.query;
  proto.query = function patchedQuery(
    this: unknown,
    sql: string,
    params?: unknown[],
    useStructuredResult?: boolean,
  ): Promise<unknown> {
    const translated = translatePgToSqlite(sql, params ?? []);
    return original.call(this, translated.sql, translated.params, useStructuredResult);
  };
  proto[PATCH_FLAG] = true;
}