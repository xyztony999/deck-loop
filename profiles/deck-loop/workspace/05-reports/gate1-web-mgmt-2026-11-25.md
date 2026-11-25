# Gate 1 验证报告 · web-mgmt-20261125（ADR-018）

- 日期：2026-11-25 · 模块：deck-loop-full · 检查者：只读子代理独立复核（不采信设计侧预检）
- 方法：G1-01~11（node/PG 栈口径）+ 六项重点核查；代码对账基准 = server-node 19 controller 实测 75 路由 + mcp-server 28 tools + git 779f3d6

## 总判定：WARN（0 FAIL / 5 WARN / 2 INFO）

用户 WARN 策略（入口确认）：**继续并记录**。契约主干完整正确，D0 四裁决与既有 ADR 硬约束无违背，无需返工 D1-D4，进入 B/F。

## 逐项判定

| 编号 | 项 | 判定 |
|---|---|---|
| G1-01 | 架构文档与模块设计一致 | WARN（W1/W2/W3） |
| G1-02 | PRD 覆盖场景与角色 | PASS |
| G1-03 | API 完整（路径/请求/响应/错误码） | PASS |
| G1-04 | 交互覆盖页面类型 | PASS |
| G1-05 | API 字段与交互对齐（43 Action 全命中） | PASS |
| G1-06 | 状态机完整 | PASS |
| G1-07 | 枚举统一无冲突（零新增入池） | PASS |
| G1-08 | 接口路径规范 | PASS |
| G1-09 | changelog 齐备（06 冻结解除合规） | PASS |
| G1-10 | INDEX 状态更新 | PASS |
| G1-11 | 跨阶段模型一致性 | WARN（W1/W2/W4） |

重点核查：移除清单 23 与代码 1:1（75−23+4=56 分域复核无误）；agent-create 与 VersionArchiveService 逐条吻合；双凭证鉴权缝可行；硬约束（零渲染/INV-11/枚举/AGPL/内存）全过。

## WARN 明细与处置（记录在案，B/F 阶段执行）

| # | 问题 | 处置 |
|---|------|------|
| W1 | 表计数算术错（11+1−2=10 非 12； phantom dl_deck_log）跨 4 文档 | B 阶段文档小修：06 §8.3 / ADR-018 §4.3-4.4 / domain-model / api-web-agent 统一「11→10」，dl_api_token 标新增表，deck_log 注明设计层未落地 |
| W2 | previewDocument 实在 export-renderer.ts（含 node 依赖），设计声明在 render-template.ts | B 阶段代码步：previewDocument+escapeText 迁入 render-template.ts（单一源零 node 依赖）；F 阶段 web 禁 import export-renderer.ts |
| W3 | api-index Collection 表体 / select-service-pool channel 行 / persistence-migration 文档陈旧 | B 阶段补表体删除线/历史标记/增行（头注已声明口径） |
| W4 | domain-model §6 ChannelModel 行未标退役 | B 阶段补删除线+退役注记 |
| W5 | NR-06 字面与 token 哈希入库冲突（06 §8.1 新法已覆盖） | B 阶段 node-rules NR-06 增补例外交叉引用 |

## INFO

- I1：FRONTEND_ROOT 仍指 client/、profile depends 待复绑 vue3-engine → F 启动前置（F 子代理执行）。
- I2：ADR-018 登记行序在 017 前（同日，纯排版，不处置）。

## 结论

设计集可进入 B/F。WARN 处置纳入 B/F 子代理指令，Gate 2 复核闭环。