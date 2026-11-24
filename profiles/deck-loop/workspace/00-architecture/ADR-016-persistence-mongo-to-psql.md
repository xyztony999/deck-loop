# ADR-016：持久层 MongoDB → PostgreSQL（TypeORM）

| 属性 | 值 |
|------|-----|
| 编号 | ADR-016 |
| 状态 | 已采纳（Accepted） |
| 日期 | 2026-11-24 |
| 决策者 | 用户（D0 拍板四项）+ 流水线编排 |
| 关联 | ADR-006（单服务）、ADR-011（宝塔部署）、ADR-012（存储模型，本 ADR 修订）、ADR-013（同步游标）、ADR-015（客户端渲染） |
| 影响域 | 全部八域持久层（deck/generation/adjustment/version/deliver/asset/channel/platform）；**对外 API 契约零变化、客户端零变化** |

## 1. 背景与动机（Context）

- 用户另有项目 **UniGate** 需使用 PostgreSQL；生产服务器物理内存仅 **1.6 GB**，希望**只运行一个数据库实例**以收敛内存与运维面。
- 现状（ADR-012）：deck-loop 持久层为 MongoDB（mongoose 8 / @nestjs/mongoose），服务器既有实例以**单节点副本集 rs0 + keyFile** 形态运行以支撑多文档事务（版本留档 seq 分配 + insertOnly + movePointer + 引用计数、deck/GT/EX 取号、brandkit 默认切换）。WiredTiger 缓存 + mongod 进程常态占用约 200–300 MB，且 rs0/keyFile 为事务而引入的额外运维负担。
- 目标：**全量迁移**到 PostgreSQL（单库），mongoose 全换 ORM，Mongo 最终下线；与 UniGate **共用同一 PostgreSQL 实例、不同 database**（deck-loop 用 `deck_loop` 库，UniGate 用其自有库），从而服务器只跑一个 DB 进程。

## 2. 决策（Decision）

1. **现在全量迁**：mongoose 全部替换为 ORM；PSQL 单库；Mongo 最终下线（下线为最后一步，须用户授权）。
2. **ORM = TypeORM**（`@nestjs/typeorm` ^10 + `typeorm` ^0.3 + `pg` ^8 驱动）。
3. **执行方式 = 会话编排**（流水线连续执行 D1→D3→Gate1→代码→验证门）。
4. **Gate WARN 策略 = 继续推进并记录，最后汇总**。

### 2.1 技术选型理由

| 维度 | 结论 |
|------|------|
| 事务 | PostgreSQL **原生 ACID 事务**（`DataSource.transaction` / `EntityManager`），无需副本集/keyFile；版本留档恢复 v1 **单事务**编排（insert + movePointer + adjustRefCounts 同事务），消除 v3 Mongo 两段式遗留偏离 |
| 内存 | 单 PG 实例（与 UniGate 共享）替代独立 mongod，目标净省 **200–300 MB**；`shared_buffers` 保守配置适配 1.6 G |
| JSON 快照 | 版本 content / instruction_snapshot / draft_outline / colors / fonts / preference_map / channel.models 等原 Mixed 嵌入 → **jsonb** 列（整体读写，契约形状不变） |
| 聚合 | Mongo aggregate（用量 $lookup/$group/$facet、deck 统计 $group、sync 游标扫描）→ **SQL**（JOIN/GROUP BY/COALESCE/窗口分页），服务端静态构造，入参仅作绑定值（NR-02/NR-03 红线保持） |
| 契约 | 业务主键（雪花串）升为表 **PRIMARY KEY**（取代 ObjectId `_id`）；字段名沿契约 snake_case 逐字平移；审计六件套 / data_version 乐观锁 / delete_sign 软删语义保留 |

### 2.2 栈依赖迁移说明

- `ACTIVE_STACKS` 名义仍为 `node-nestjs-mongo,vue3-engine`（profile 未改键）；**后端栈实质变为 `node-nestjs-psql`**。本 ADR 与 06 规约 v1.2 增补节为权威口径；`profile.yaml` 的 `depends` 键改名属配置动作，留待用户确认后执行（不阻塞本次迁移）。
- 运行时依赖：移除 `@nestjs/mongoose`、`mongoose`；新增 `@nestjs/typeorm`、`typeorm`、`pg`。
- 测试依赖：移除 `mongodb-memory-server`；新增 `pg-mem`（进程内 PG，测试专用）。
- 迁移工具依赖（devDependency，仅一次性脚本消费）：`mongodb` 驱动（读源库）、`tsx`（运行 TS 脚本）。

## 3. 数据模型映射（概览，详表见 D3）

13 个 mongoose schema → **11 张物理表**（`dl_generation_task`/`dl_usage_record`/`dl_channel` 各有「全量 + 只读投影」双模型，TypeORM 下每物理表单一 entity，投影侧改为只读 SQL/共享 entity）：

| 物理表 | 权威 entity | 只读投影消费方 |
|--------|------------|----------------|
| dl_account | Account | — |
| dl_deck | Deck | deliver/asset/generation 冗余直查 |
| dl_deck_version | DeckVersion | deck stats / adjustment / deliver / generation |
| dl_generation_task | GenerationTask | platform GenerationTaskCore（同表共治 D1） |
| dl_export_task | ExportTask | deck stats |
| dl_asset | Asset | generation 入参守卫 |
| dl_brand_kit | BrandKit | deck/generation 守卫与名称冗余 |
| dl_prompt_template | PromptTemplate | — |
| dl_channel | ChannelConfig | platform GatewayRuntimeStore（快照） |
| dl_channel_preference | ChannelPreference | — |
| dl_usage_record | UsageRecord | channel 用量聚合（只读） |

- 主键：业务 id（`*_id` 雪花串）= `PRIMARY KEY`；规则编码（deck_code/task_code/export_code）普通列；唯一索引按各 api §5.3 平移（uk_email/uk_user_hash/uk_deck_branch/uk_task_code/uk_user 等）。
- 时间列：`timestamptz`（毫秒精度不截断，同步游标派生源口径不变，ADR-013）。
- 嵌入值对象：`jsonb`（content/instruction_snapshot/draft_outline/colors/fonts/preference_map/models）。

## 4. 事务与一致性

- 跨聚合写编排统一 `DataSource.transaction(async (manager) => …)`；仓储方法尾参 `session?: EntityManager` 加入外层事务（替代 mongoose `ClientSession`）。
- **版本留档恢复单事务**：seq 分配（`SELECT MAX … FOR UPDATE` 锁 deck 维度）→ insertOnly → movePointer → adjustRefCounts 同事务；`countVersionInDeck`/`adjustRefCounts` 透传 manager，消除 v3 两段式偏离。
- 取号（DL/GT/EX）：事务内 `MAX+1` + 唯一索引兜底（deck_code 无唯一约束沿 v1 口径；task_code/export_code 唯一索引兜底并发）。
- 事件 NR-07「事务提交后发布」：TypeORM 事务回调成功返回即已提交，调用点在 `await transaction(...)` 之后发布（替代 mongoose session 'ended' 监听）。

## 5. 对外契约红线（验收）

- **对外 API 契约零变化**：66 端点路径/方法/AO/VO/`Result<T>`/错误码/枚举池一字不改。
- **客户端零变化**：D4 交互跳过（API 不变 → PageSpec 不变）；client typecheck/build 必须零改动绿。
- 字典 key 驼峰契约（deckType/taskStatus/exportFormat 等）不变；07 UI 设计语言 v2.0 不受影响。

## 6. 部署与迁移（概要，runbook 见交付报告）

- 宝塔软件商店安装 PostgreSQL（与 UniGate 共实例）；建 `deck_loop` 库与专用角色；`.env` 增 `DATABASE_URL`（密码仅存服务器 .env，不入 git/聊天）。
- 一次性迁移脚本 `server-node/scripts/migrate-mongo-to-pg.ts`：Mongo 读 → 字段 transform → PG 写（jsonb/时间/数值归一），**支持干跑（--dry-run）**，幂等可重入。
- 切换顺序：装 PG → 配 .env → 干跑 → 实迁 → 切应用（TypeORM 构建产物）→ 触库健康检查（合法 email 登录回 BIZ_AUTH_CREDENTIALS）→ **Mongo 下线（最后一步，须用户授权）**。
- **服务器端构建永久禁令**不变（1.6 G 跑 pnpm install+tsc 会 OOM）；CD=runner 构建+scp 产物+宝塔启动脚本重启。

## 7. 后果（Consequences）

- 正向：单 DB 进程省内存；原生事务消除两段式偏离与 rs0/keyFile 运维；与 UniGate 共实例收敛运维。
- 代价/风险：jsonb 快照不再享受 Mongo 文档原生嵌套索引（本项目快照整体读写，无内嵌字段查询需求，影响为零）；聚合改 SQL 需逐条对照验证；一次性数据迁移须干跑+校验+可回滚。
- 回滚：切换前 Mongo 保持在线只读兜底；迁移脚本幂等；应用回滚=回退产物包+.env 指回 Mongo（Mongo 下线前均可逆）。

## 8. 验证

- server jest 全量绿（pg-mem 进程内 PG）；client typecheck/build 零变化绿；迁移脚本干跑通过。
- 真机验证清单随交付报告（部署 Gate 后由用户执行）。