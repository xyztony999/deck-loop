---
name: node-specs
description: Node/NestJS+MongoDB 栈代码规格 - 契约冻结、模块组织、Mongoose 建模、查询安全、进程内事件（随栈 profile 激活挂载）
---

# Node/NestJS + MongoDB 栈 — 前端之外的后端代码规格

> 层级：L2 技术栈 profile（node-nestjs-mongo）。📎 参考示例（deck-loop）来自参考实现；执行前按激活 profile manifest 槽位替换。

## 专题索引

| 文档 | 内容 | 状态 |
|------|------|------|
| [20-api-conventions.md](20-api-conventions.md) | 契约冻结、NestJS 模块组织、Mongoose 建模、查询安全红线、进程内事件、错误码/枚举 | ✅ v1.0 |
| 10-schema-patterns.md | Mongoose schema 模式（嵌入/引用、索引、乐观锁、软删、审计填充 hook） | 规划（生成时按 20 §3 执行） |
| 03-service-patterns.md | Service 模式（事务边界、跨域直调、幂等键、状态机条件更新） | 规划（生成时按契约文档 §4 编排语义执行） |
| 09-controller-dto.md | Controller/DTO 模式（class-validator 注解、Result 包装、SSE 端点） | 规划（生成时按 20 §2 执行） |
| 15-validation-checklist.md | Gate 2 前自检清单（TS strict、白名单、事件时序、密钥 env） | 规划（以 rules/node-rules.md 为强制基线） |

## 快速定位

- 契约怎么守 → 20 §1/§2
- collection 怎么建模 → 20 §3
- 查询怎么防注入 → 20 §4（红线，违反即 FAIL）
- 事件怎么发 → 20 §5
