# Gate 1 验证报告 — 设计→代码门控（持久层迁移 ADR-016）

**模块**：deck-loop-full（增量：持久层 MongoDB→PostgreSQL/TypeORM）
**检查时间**：2026-11-24
**设计产物**：ADR-016（00-architecture）、AA v1.3、prd-persistence-migration v1.0、api-persistence-migration v1.0、06 规约 v1.2 §7
**适用口径**：增量迁移——8 份 api-*.md 契约文档**冻结不变**（v3 Gate 1 已 PASS，gate1-v3-2026-10-08.md）；本次仅新增持久层实现规格，不新增/修改对外契约。

## PRD 就绪检查（prd-persistence-migration v1.0）

| 层级 | 通过/总数 | 状态 |
|------|----------|------|
| 第一层 G1-G5（目标/范围/角色/领域对象/关系） | 5/5 | PASS |
| 第二层（横切迁移：NFR+DM 替代 T 系列） | NFR 8/8 + DM 6/6 | PASS |
| 第三层 N1-N4（非功能/异常/规则/追溯） | 4/4 | PASS |

## 设计完整性（持久层规格 api-persistence-migration v1.0）

| 检查块 | 通过/总数 | 状态 |
|--------|----------|------|
| 物理表↔entity 映射（13 schema→11 表，含双模型消解） | 11/11 | PASS |
| 逐表字段清单（snake_case 平移 + 审计/乐观锁/软删） | 11/11 | PASS |
| 仓储重写规约（12 仓储 + adjustment 只读投影） | 12/12 | PASS |
| 聚合→SQL 对照（用量三维/deck 统计/sync 游标） | 3/3 | PASS |
| 版本归档单事务方案（rs0/keyFile 移除） | 1/1 | PASS |
| 一次性迁移脚本规约（干跑/幂等/校验/回滚） | 1/1 | PASS |
| 测试基建改造（pg-mem） | 1/1 | PASS |

## 前后端契约一致性（红线核验）

| 编号 | 检查项 | 状态 |
|------|--------|------|
| CT-001 | API 路径与 PageSpec Action 对齐（不变） | PASS |
| CT-002 | 请求/响应字段对应（不变） | PASS |
| CT-003 | 枚举值前后端一致（枚举池零改动） | PASS |
| CT-007 | 字典 Key 驼峰契约（deckType/taskStatus/exportFormat 等不变） | PASS |
| 红线 | 对外 API 契约零变化 + 客户端零变化声明（PRD §6 / ADR-016 §5） | PASS |

## WARN 记录（按策略继续推进，最后汇总）

| 编号 | 事项 | 处置 |
|------|------|------|
| W1 | profile.yaml `depends` 键仍为 node-nestjs-mongo（实质后端栈已 node-nestjs-psql） | 键改名属配置动作，留待用户授权；ADR-016/AA v1.3/06 §7 已注明实质栈 |
| W2 | 本地 Node v22.22.3（约束目标 Node 24；engines>=20 满足，jest 在 22 运行） | 部署目标 Node 版本于部署 Gate 确认；不阻塞本地测试 |
| W3 | D4 交互跳过（API 不变→客户端零变化→PageSpec 不变） | 已在 INDEX/报告记录原因 |
| W4 | pg-mem 需 registerFunction(version/current_database) shim；row-value 游标改展开 OR 式 | 已在 D3 §0/§6 与测试基建落实，生产 PG 行为等价 |

## 总结

**判定**：PASS（含 4 项 WARN，按「继续推进并记录」策略放行至代码阶段）

- CRITICAL 违规：0
- WARN：4（W1-W4，均非阻塞，部署 Gate 前汇总）
- 契约冻结红线：守住（8 份 api 文档零改动；客户端零改动）