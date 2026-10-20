import 'reflect-metadata';
// 副作用导入必须在 AppModule 之前：app.module 顶层即读 process.env
// （MongooseModule.forRoot），import 求值先于本文件任何语句（见 load-env.ts 头注）
import './load-env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** 默认端口 8080（与宝塔 Nginx 反代配置对齐，env PORT 可覆盖） */
const DEFAULT_PORT = 8080;

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // 全局校验管道：白名单剥离未知字段 + 类型变换（NR-10）
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 跨域放行：/api 类请求经 Web 代理同源无 CORS，但素材限时 URL（/files）
  // 与导出下载 URL 是签发给客户端直连的绝对地址（Tauri WebView / dev 5173），
  // 文件流响应必须带 CORS 头才能被 fetch/<img> 消费；鉴权靠 token/HMAC，与源无关
  app.enableCors();

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
