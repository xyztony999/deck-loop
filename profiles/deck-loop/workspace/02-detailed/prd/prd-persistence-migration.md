# PRD — 持久层迁移（MongoDB → PostgreSQL / TypeORM）

| 属性 | 值 |
|------|-----|
| 模块 | 跨域横切（全八域持久层；ADR-016） |
| 功能类型 | 非功能需求 + 数据迁移（纯内部持久层，无新增业务功能） |
| 版本 | v1.0 |
| 日期 | 2026-11-24 |
| 关联 | ADR-016、AA v1.3 持久层注记、06 规约 v1.2 增补节、D3 数据模型/迁移规约 |

## 1. 业务目标（G1）

在**不改变任何对外行为**的前提下，将 deck-loop 云端持久层从 MongoDB 全量迁移到 PostgreSQL，使生产服务器（1.6 GB 内存）只运行一个数据库实例（与用户另一项目 UniGate 共用 PG 实例、不同 database），收敛内存占用与运维面，并以 PG 原生事务消除 v3 Mongo 两段式事务遗留偏离。

## 2. 功能范围（G2）

**做**：
- mongoose 全量替换为 TypeORM（@nestjs/typeorm + pg）；13 schema → 11 物理表 entity；12 仓储 + 跨聚合只读投影重写为 SQL/QueryBuilder。
- Mongo aggregate（用量 $lookup/$group/$facet、deck 统计 $group、sync 复合游标扫描）→ 等价 SQL。
- 多文档事务 → PG 原生事务；版本留档恢复 v1 单事务（insert + movePointer + adjustRefCounts）。
- 一次性数据迁移脚本（Mongo 读 → transform → PG 写，支持干跑、幂等可重入）。
- 服务端 jest 全量测试改造（mongodb-memory-server → pg-mem 进程内 PG）。
- `.env`/配置增 `DATABASE_URL`；部署 runbook（宝塔装 PG → 配 .env → 迁移 → 切应用 → 触库健康检查 → Mongo 下线）。

**不做**：
- 任何对外接口/字段/错误码/枚举改动；任何客户端改动；任何业务规则/状态机改动。
- 自动执行破坏性操作（装 PG/迁数据/切应用/下线 Mongo 均须用户授权）。

## 3. 角色（G3）

创作者：**零感知**（透明迁移，行为完全一致）。运维/用户：执行部署切换 runbook 与真机验证。

## 4. 非功能需求（NFR）

| 编号 | 需求 | 验收口径 |
|------|------|---------|
| NFR-1 内存 | 单 PG 实例替代独立 mongod，目标净省 **200–300 MB**；与 UniGate 共实例 | 部署后 `free -m`/进程 RSS 对比；PG `shared_buffers` 保守配置（建议 128–256 MB）适配 1.6 G |
| NFR-2 共实例隔离 | deck-loop 用 `deck_loop` database + 专用角色；UniGate 用其自有库；互不访问 | 角色权限仅授 `deck_loop`；连接串 database 段隔离 |
| NFR-3 原生事务 | 跨聚合写编排走 PG ACID 事务；版本留档单事务（seq 分配 FOR UPDATE + insert + 指针 + 引用计数） | 事务回滚测试绿；无 rs0/keyFile 依赖 |
| NFR-4 契约不变 | 66 端点路径/方法/AO/VO/Result/错误码/枚举池一字不改 | server jest 全量绿（含既有契约用例）；client typecheck/build 零改动绿 |
| NFR-5 游标精度 | 同步游标时间列毫秒精度不截断（timestamptz），复合游标 (time,id) 全序推进口径不变 | sync-cursor 用例绿（同毫秒续传 F07） |
| NFR-6 查询安全 | NR-02/NR-03/NR-05 红线保持：SQL 服务端静态构造，入参仅作绑定值（$1/$2），userId 服务端注入 | 代码审查 + 既有用例 |
| NFR-7 部署约束 | 服务器端构建永久禁令（1.6 G OOM）；CD=runner 构建+scp 产物+宝塔重启；健康检查触库 payload | runbook 遵循；健康检查合法 email 登录回 BIZ_AUTH_CREDENTIALS |
| NFR-8 密钥红线 | Mongo/PG 密码仅存服务器 .env，不入 git/聊天；域名 api.deckloop.tonyxyz.cn 不入 git | .env gitignore；仓库扫描无密值 |

## 5. 数据迁移需求（DM）

| 编号 | 需求 | 验收口径 |
|------|------|---------|
| DM-1 全量 | 11 表全量迁移（含软删行 delete_sign=1、不可变版本全量、日志型 usage 全量） | 逐表行数 Mongo==PG |
| DM-2 字段保真 | 业务 id/审计六件套/data_version/delete_sign/规则编码逐字平移；Mixed→jsonb 形状不变；Date→timestamptz 毫秒不变；数值 number→int/bigint 安全 | 抽样字段比对 + content_hash 一致性 |
| DM-3 幂等可重入 | 脚本以业务主键 upsert（ON CONFLICT DO UPDATE），重复运行不产生重复行 | 二次运行行数不变 |
| DM-4 干跑 | `--dry-run` 只读源库 +  transform + 校验，不写目标库，输出逐表统计与差异 | 干跑通过报告 |
| DM-5 校验 | 迁移后逐表 count + 关键聚合（版本 seq 连续性、引用计数、用量 token 汇总）比对 | 校验报告全等 |
| DM-6 可回滚 | Mongo 下线前保持在线只读兜底；应用回滚=回退产物+.env 指回 Mongo | runbook 回滚节 |

## 6. 对外契约红线声明（验收唯一硬约束）

> **对外 API 契约零变化、客户端零变化。** 本次迁移为纯内部持久层替换：所有 `/xxx` 接口签名/响应/错误码不变；字典 key 驼峰契约（deckType/taskStatus/exportFormat 等）不变；07 UI 设计语言 v2.0 不受影响；D4 交互设计跳过（API 不变 → PageSpec 不变）。任何导致对外行为差异的实现均视为验收 FAIL。

## 7. 业务规则

无新增业务规则。既有全部 INV（INV-1…INV-26）与状态机口径在 PG 实现下逐条保持（见 D3 仓储规约与既有 jest 用例）。

## 8. 验收

- server jest 全量绿（pg-mem）；client typecheck/build 零变化绿；迁移脚本干跑通过。
- 部署切换 Gate：完成代码+测试+干跑后**停下等用户授权**，不自动执行破坏性操作。
- 真机验证清单随交付报告（部署后由用户执行）。