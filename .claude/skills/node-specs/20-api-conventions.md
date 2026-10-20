# Node/NestJS + MongoDB 栈 — 核心编码规约（20）

> 层级：L2 技术栈 profile（node-nestjs-mongo）。本文为 D3 契约设计（{stack.api_spec}）与代码生成的技术基线。
> 📎 参考示例（deck-loop）：路径/枚举等具体值均为示例；执行前按激活业务 profile 的 manifest 槽位替换。

## 1. 契约冻结原则

API 契约（路径/方法/AO/VO 字段/Result 包装/错误码/枚举池）以业务工作区 `{ws.api}` 文档为唯一事实源；代码不得私改契约。栈迁移（如 Java→Node 重实现）时契约一字不动。

## 2. NestJS 模块组织

- 单服务单进程：`src/app.module.ts` 聚合；**每个业务域一个 NestModule**（`src/{domain}/{domain}.module.ts`），域间进程内直调（注入对方 Service），禁 Feign/自 HTTP 回环
- 分层（域内）：`{domain}.controller.ts` → `{domain}.service.ts` → `{domain}.repository.ts`（Mongoose 封装）→ `schemas/{domain}.schema.ts`；DTO `{domain}.dto.ts`（AO/VO 平移 TS class + class-validator）
- 全局管道：`ValidationPipe({ whitelist: true, transform: true })`；全局前缀无 `/api`（由边缘反代剥前缀）；CORS 按部署白名单配置

## 3. MongoDB 建模（Mongoose）

- collection 命名沿用业务前缀（如 `dl_`）；字段=契约文档字段语义平移（审计字段/乐观锁 dataVersion（$inc）/软删 deleteSign 平移为文档字段）
- `_id` ObjectId 仅存储层内部使用，**不进 VO**；业务主键（雪花串）独立 string 字段 + 唯一索引
- 嵌入 vs 引用：聚合根=document；不可变内容快照整体嵌入；无独立生命周期值对象内嵌；跨聚合引用只存业务 id
- 跨文档编排用事务（replica set / `session`）承载；索引在 schema 声明式创建（unique/compound）
- 多端同步游标：按 `updatedTime`（毫秒精度）+ 业务 id 升序稳定排序的 collection 扫描，幂等可重拉

## 4. 查询安全红线（强制）

- **白名单映射**：所有查询构造只允许 AO 字段→查询字段的显式映射表；请求体键名不得成为 filter/sort/projection 键
- id 入参一律格式校验（长度≤32、`[A-Za-z0-9_-]`）后再查询；枚举入参值域校验
- 禁 `$where`/`$eval`/mapReduce/服务端 JS；聚合管道服务端静态构造（用户输入只作 `$match` 值，不作运算符）
- 隔离字段（如 userId）服务端注入，永不取信客户端

## 5. 进程内事件

- EventEmitter2：事件名=契约 businessType；`@OnEvent` 订阅
- **事务提交后发布**（回滚不发）；单实例假设（多实例化时引 Redis/MQ，事件名不变）

## 6. 错误码/枚举

- 错误码常量集中于 `{domain}.errors.ts`，格式 `{BIZ}_{OBJECT}_{ERROR}`；异常经全局 ExceptionFilter 转 `Result{status,code,msg,data}`
- 枚举 TS const 对象 + `getLabelByCode`，与业务枚举池一一对应，禁跨模块重复定义
