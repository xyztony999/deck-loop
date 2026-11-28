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
import { join } from 'node:path';
import { freePort } from './free-port';
import {
  Module,
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
  type INestApplicationContext,
  type Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
  /**
   * 驱动对象（宿主注入，避免 core 树引 native/wasm 依赖）：
   * - better-sqlite3：模块本体；
   * - sqljs：**已初始化**的 SQL 对象（宿主先 initSqlJs({locateFile})，ADR-019 市场包）。
   */
  driver?: unknown;
  /** SQLite 引擎（缺省 better-sqlite3；sqljs=纯 JS+wasm，跨平台市场包用） */
  engine?: 'better-sqlite3' | 'sqljs';
  /** 自动建表（本地单用户库默认 true；生产 PG 红线 synchronize=false 不受影响） */
  synchronize?: boolean;
  /**
   * HTTP 管理站（ADR-019 manage_open）：给本地核心挂 /api 控制器 + web 静态站。
   * 不传=纯 application context（MCP tools 够用，无 HTTP）。
   */
  http?: {
    /** 监听端口（缺省取空闲端口，绑 127.0.0.1） */
    port?: number;
    /** web/ 前端构建产物目录（index.html）；缺失时仅 API 无静态站 */
    webDist?: string;
  };
}

/** 本地核心句柄（域服务经 get(Class) 取用） */
export interface LocalCore {
  context: INestApplicationContext;
  dataSource: DataSource;
  get<T>(cls: Type<T>): T;
  close(): Promise<void>;
  /** 管理站地址（http 选项缺省时为 null） */
  httpUrl: string | null;
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

  const typeOrmFactory = () => {
    const shared = {
      driver: options.driver,
      entities: ALL_ENTITIES,
      synchronize: options.synchronize ?? true,
      logging: false,
    };
    if (options.engine === 'sqljs') {
      // sql.js：location=文件路径（autoSave 落盘）；':memory:' 无 location=纯内存
      const inMemory = options.database === ':memory:';
      return {
        type: 'sqljs' as const,
        location: inMemory ? undefined : options.database,
        autoSave: !inMemory,
        ...shared,
      };
    }
    return {
      type: 'better-sqlite3' as const,
      database: options.database,
      ...shared,
    };
  };

  /** 本地通行守卫：单用户无鉴权（127.0.0.1 绑定），web 前端的 @CurrentUser 由它供体 */
  class LocalPassGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      context.switchToHttp().getRequest().user = {
        userId: 'local',
        accountId: null,
      };
      return true;
    }
  }

  @Module({
    imports: [
      TypeOrmModule.forRootAsync({ useFactory: typeOrmFactory }),
      EventEmitterModule.forRoot(),
      DeckModule,
      VersionModule,
      AssetModule,
      DeliverModule,
    ],
    providers: options.http != null ? [{ provide: APP_GUARD, useClass: LocalPassGuard }] : [],
  })
  class LocalCoreModule {}

  if (options.http == null) {
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
      httpUrl: null,
    };
  }

  // ---- HTTP 管理站（ADR-019 manage_open）：先定端口再设签名基址 env（存储/票据服务构造期读取） ----
  const port = options.http.port ?? (await freePort());
  process.env.ASSET_URL_PUBLIC_BASE_URL ??= `http://127.0.0.1:${port}/api/files`;
  process.env.EXPORT_DOWNLOAD_BASE_URL ??= `http://127.0.0.1:${port}/api`;

  const app = await NestFactory.create(LocalCoreModule, { logger: false });
  const dataSource = app.get(DataSource);
  patchSqliteDialect(dataSource);

  const expressApp = app.getHttpAdapter().getInstance();
  if (options.http.webDist != null) {
    const { static: expressStatic } = await import('express');
    expressApp.use(expressStatic(options.http.webDist));
    // SPA 兜底：/api 交给 Nest 路由，其余 GET 回 index.html
    expressApp.use(
      (
        req: { path: string; method: string },
        res: { sendFile: (p: string) => void },
        next: () => void,
      ) => {
        if (req.path.startsWith('/api') || req.method !== 'GET') {
          next();
          return;
        }
        res.sendFile(join(options.http!.webDist!, 'index.html'));
      },
    );
  }
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, stopAtFirstError: true }),
  );
  await app.listen(port, '127.0.0.1');

  return {
    context: app,
    dataSource,
    get: <T>(cls: Type<T>): T => app.get(cls),
    close: () => app.close(),
    httpUrl: `http://127.0.0.1:${port}`,
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