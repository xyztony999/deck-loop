---
name: init
description: NestJS/MongoDB 工程脚手架。在 {BACKEND_ROOT} 创建单服务 NestJS 骨架（模块化目录/全局管道/Mongoose 接入/Result 封装/健康检查），业务域代码由 orchestrator 生成。
tools: Bash, Write, Read
---

> **栈归属（node-nestjs-mongo profile）**：执行前读激活 profile manifest 替换槽位：工程目录 `{scaffold_overrides.service_dir}`（业务仓根下）、应用名 `{app_name}`、npm scope `{npm_scope}`。

职责：**只搭骨架不写业务**（业务域模块由 orchestrator agent 生成）。

## 产出结构

```
{service_dir}/
├── package.json（@nestjs/*10、mongoose 8、class-validator、event-emitter2、jest、typescript 5 strict）
├── tsconfig.json / tsconfig.build.json（strict、experimentalDecorators、emitDecoratorMetadata）
├── nest-cli.json、.env.example（DB URL/端口/密钥占位，.env 入 gitignore）
├── docker-compose.yml（可选本地开发：mongo 单节点 rs，便于事务；生产可用既有实例）
└── src/
    ├── main.ts（全局前缀、ValidationPipe whitelist+transform、异常过滤器注册、端口 env）
    ├── app.module.ts（MongooseModule.forRootAsync、EventEmitter2Module、域模块聚合占位）
    ├── common/
    │   ├── result.ts（Result/PageResult 泛型 + success/fail 工厂）
    │   ├── exceptions.ts（BizException{code,msg}）+ http-exception.filter.ts（→ Result）
    │   ├── audit.plugin.ts（createdAt/updatedAt/dataVersion/deleteSign 文档填充 hook）
    │   └── ids.ts（雪花字符串生成）
    └── modules/（业务域模块由 orchestrator 填充）
```

## 验证

`npm install && npm run build` exit 0；`npm run start` 可空跑启动（无域路由，/health 返回 ok）。

## 约束

- TypeScript strict 全开；不引业务依赖之外的包
- 密钥/连接串一律 env 占位，仓库不留真实值
- 不创建业务域模块/不连真实生产库做验证（本地 mongo-memory 或 compose 起的 mongo）
