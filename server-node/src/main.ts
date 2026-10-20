import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** 默认端口 8080（与宝塔 Nginx 反代配置对齐，env PORT 可覆盖） */
const DEFAULT_PORT = 8080;

/**
 * 零依赖 .env 加载（NestJS 不自动读 .env；宝塔 Node 项目/PM2/node 直启统一生效）。
 * 真实进程环境变量优先（override=false）；按 dist/main.js 的上级（工程根）与
 * process.cwd() 两处探测，先命中先加载；Node 20+ 的 --env-file 不受影响。
 */
function loadDotEnv(): void {
  const candidates = [resolve(__dirname, '../.env'), resolve(process.cwd(), '.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}
loadDotEnv();

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // 全局校验管道：白名单剥离未知字段 + 类型变换（NR-10）
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 优雅停机（SIGTERM/SIGINT 时关闭 Mongo 连接等资源）
  app.enableShutdownHooks();

  const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  // 绑定地址可收窄（宝塔部署设 HOST=127.0.0.1，仅 Nginx 反代可达；
  // 默认 0.0.0.0 保持本地开发行为）
  const host = process.env.HOST && process.env.HOST !== '' ? process.env.HOST : '0.0.0.0';

  await app.listen(port, host);
}

void bootstrap();
