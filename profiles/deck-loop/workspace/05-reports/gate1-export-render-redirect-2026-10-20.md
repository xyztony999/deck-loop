# Gate 1 验证报告 — 设计→代码门控（导出渲染重定向 ADR-015）

**模块**：deck-loop-full（C-06 导出交付渲染重定向增量）
**检查时间**：2026-10-20
**范围**：①D0-export-render-redirect-2026-10-20.md（新增）；②api-delivery.md v1.3；③prd-delivery.md v1.2；④delivery PageSpec v1.1；⑤ADR-015/INDEX/architecture-choices 登记

## PRD就绪检查（prd-delivery v1.2）

| 层级 | 通过/总数 | 状态 |
|------|----------|------|
| 第一层（G1-G5） | 5/5 | PASS（目标/范围/角色/对象/关系齐备，渲染位置表述已更新） |
| 第二层（T2 状态流转） | PASS | 状态机 v2 明确（QUEUED→SUCCEEDED/FAILED/CANCELLED，RENDERING 历史兼容） |
| 第三层（N1/N2） | PASS | 非功能更新：客户端本地渲染时限语义、50MB 上限、QUEUED 悬挂清理策略 |

## API文档完整性（api-delivery v1.3）

| 检查项 | 状态 | 证据 |
|--------|------|------|
| CH1-002/003 边界做/不做 | PASS | §1.2 更新（服务端不渲染，渲染=客户端基础设施） |
| CH1-004 设计决策含理由 | PASS | §1.3 D1 重写（ADR-015 理由链） |
| CH3-015 错误码 | PASS | +BIZ_EXPORT_UPLOAD_INVALID（{BIZ}_{OBJECT}_{ERROR} 合规） |
| CH4-023/024 状态定义/流转 | PASS | §4.2 状态机 v2 |
| CH4-028/029 子流程 IO 契约 | PASS | §4.3 内部编排改产物接收（upload/fail 幂等条件更新） |
| GL-001a 文档头日期≥日志最新 | PASS | 2026-10-20 = v1.3 行 |
| GL-009 三级路径 | PASS | 全部 {domain}/{resource}/{action}（初稿 artifact/upload 四级已纠为 export/upload） |
| GL-010/011 方法与响应 | PASS | upload 为 multipart POST + Result；download GET 例外沿用 |
| GL-012 写接口权限校验 | PASS | upload/fail 详情规则含属主+QUEUED 前置 |

## 前后端契约一致性

| 编号 | 检查项 | 状态 | 证据 |
|------|--------|------|------|
| CT-001/004 | Action 路径对齐 | PASS | PageSpec 9 路径与 API 接口清单一一命中（grep 机械比对） |
| CT-003 | 枚举一致 | PASS | ExportStatus 两侧均保留 RENDERING 并标注历史兼容 |
| CT-002 | 字段对应 | PASS | submit VO（exportId/exportStatus/needConfirm）不变；upload/fail AO 契约新增两侧同步 |

## 变更文档检查

| 检查项 | 状态 | 证据 |
|--------|------|------|
| BA/AA/FL 零变更声明 | PASS | 渲染位置=技术实现重定向（api-delivery §1.2 自始声明渲染引擎为基础设施）；D0 报告 §3.3 备案 |
| 版本引用链 | PASS | PageSpec 输入=api-delivery v1.3；INDEX d3/d4 阶段注记同步 |
| 交叉引用闭环 | PASS | D0 报告 ↔ api-delivery v1.3 ↔ ADR-015 ↔ INDEX 四处互链一致 |

## WARN（不阻塞，供确认）

1. 客户端 `deliver.shared.ts` 代码注释引用 "delivery.md §7"（下载失败重试）——PageSpec 章节顺延后现为 §8，实施轮（/pipeline）随代码改造一并修正。
2. 新契约端点（upload/fail）尚无代码实现——本 Gate 只覆盖设计完备性；实现与回归属 /pipeline 代码阶段。

## 总结

**判定**：PASS（范围=设计增量；66+2 端点契约其余部分冻结未触碰）
