# Gate 2 验证报告 · web-mgmt-20261125（ADR-018）

- 日期：2026-11-25 · 模块：deck-loop-full · 检查者：只读子代理独立复核（未改源码，独立重跑构建/测试/路由 dump）
- 绑定：ACTIVE_PROFILE=deck-loop，栈 node-nestjs-mongo(实质 PG)+vue3-engine；FRONTEND_ROOT=web/ ✓

## 总判定：PASS（0 FAIL / 0 WARN / 4 INFO）

## 逐项判定

| # | 项 | 判定 |
|---|---|---|
| 1 | 契约对账（路由 dump 56=POST54+GET2；23 移除零残留；4 新增 AO/VO/错误码逐字；outline-save 迁移逐字） | PASS |
| 2 | agent-create 红线（仅 token / VersionArchiveService 唯一写入口 / 单事务 / 载荷 2MB·200页·2000字 / 不变性 BIZ 码 / 首版流转 / NR-07） | PASS |
| 3 | 双凭证（会话优先回落 / SHA-256+恒时 / 明文一次 / 吊销即时 / 节流 60s / SessionOnlyGuard 反向 / NR-06 例外在案） | PASS |
| 4 | MCP 双模式（28 tools 1:1 / remote 零 SQLite·native / 渲染始终本地 / 错误透传不含 token） | PASS |
| 5 | NR-01~13 + INV 保留 + 枚举零新增 | PASS |
| 6 | web（43 Action 全覆盖 / 退役零引用 / ADR-014 三层色板·禁卡中卡·accent / @render 共享 / fs.allow / Nginx / 轮询 10s） | PASS |
| 7 | W1-W5 闭环 | PASS |
| 8 | 测试重跑（server-node 16/105 · mcp 3/32 · web 5/5+vue-tsc+vite）+ 迁移脚本 dry-run/执行/幂等三例 | PASS |
| 9 | 部署配套（README web 节 / env 渠道退役+AGENT_CONTENT_MAX_MB / profile 复绑 / AGPL） | PASS |

GR-01~06 机制项全过（扫描/三端编译/新接口 E2E 五 spec/测试运行/契约对齐记录）。

## INFO（不阻塞）

1. server-node/dist 残留退役域旧编译目录（tsc 不清理；运行时零加载）→ 主会话已 clean rebuild 处置。
2. web antd vendor chunk >500kB 警告（非错误，后续 manualChunks 优化）。
3. profile 栈键 node-nestjs-mongo→psql 改名外部待办（注释在案）。
4. NR-13 单实例假设既有口径（token 每次查库不受此限）。

## 遗留（交付后联调，用户验收）

- 浏览器 golden path 需真实环境：真实 PG + Nginx 反代 + 签名 URL 取图 + 预览放映；token 签发→MCP remote 直写→网站轮询见版端到端闭环。
- 部署时先 `node dist/scripts/migrate-web-agent.js --dry-run` 核对再执行（+dl_api_token / −dl_channel / −dl_channel_preference；幂等可重跑）。**DROP 表须用户授权**。

## 结论

PASS，可交付。代码未提交（主会话统一提交，待用户授权）；部署含破坏性迁移，须用户确认后执行。