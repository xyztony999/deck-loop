---
name: node-rules
description: Node/NestJS+MongoDB 栈级强制规则（Gate 2 扫描基线）
---

# 栈级强制规则（node-nestjs-mongo）

> Gate 2 的栈层执行清单；与引擎 GR 条目、业务 profile 规则分层组装。

## CRITICAL（违反即 FAIL）

| # | 规则 | 检查方式 |
|---|------|---------|
| NR-01 | TypeScript strict，禁 `any`（确需 escapes 须注释理由） | tsconfig strict + grep `: any` |
| NR-02 | 查询构造仅白名单映射；请求体键名不得成为 filter/sort/projection 键 | 逐 Repository 审查 AO→查询映射表 |
| NR-03 | 禁 `$where`/`$eval`/mapReduce/动态拼接运算符；聚合管道服务端静态构造 | grep `\$where\|\$eval\|mapReduce` |
| NR-04 | id/枚举入参格式与值域校验后再查询（DTO class-validator + 白名单） | DTO 注解审查 |
| NR-05 | 隔离字段（userId）服务端注入，不取信客户端 | grep 客户端入参直接入 filter |
| NR-06 | 密钥/凭证仅 env/config，禁入库、禁进 VO、禁日志输出 | grep apiKey/secret + schema/VO 扫描 |
| NR-07 | 事件仅事务提交后发布（回滚不发） | 事务封装处审查 |
| NR-08 | `_id`(ObjectId) 不进 VO；业务主键为 string 字段 | VO/DTO 扫描 `_id` |
| NR-09 | 统一 Result 包装 + 全局 ExceptionFilter；错误码走 `{domain}.errors.ts` 常量，禁字面量 | grep `"BIZ_` |
| NR-10 | DTO 校验管道 whitelist+transform 开启；Controller 不写业务逻辑 | main.ts 管道 + Controller 审查 |

## WARN 级

- NR-11 未测路径：Service 核心流缺集成测试（jest）——记覆盖率缺口
- NR-12 事件订阅方做了重业务逻辑（订阅方应仅做通知/投影类轻处理）
- NR-13 多实例不安全实现（内存队列/内存会话未声明单实例假设）
