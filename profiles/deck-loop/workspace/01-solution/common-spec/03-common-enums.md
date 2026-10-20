# 通用枚举（deck-loop）

> 系统级/技术公共枚举。D3 v1.0 首次填充（2026-10-07）。
> 2026-10-08（v3 技术栈重定向）：值域冻结不变。
> 2026-10-08（v3 复议修订，D0-v3 §5）：多端同步恢复，SyncChangeOp 撤销废弃标注、恢复活跃（ADR-013 修订，POST /auth/sync/pull 复议恢复）。

| 枚举标识 | 值 | 中文 | 说明 |
|---------|-----|------|------|
| YesNo | 1 / 0 | 是/否 | INT(1) 标志位 |
| DeleteSign | 0 / 1 | 未删除/已删除 | 逻辑删除 |
| SortDirection | ASC / DESC | 升序/降序 | 列表排序参数 |
| SyncChangeOp | UPSERT / DELETE | upsert/删除 | 多端同步变更类型（P-02）——v3 复议恢复活跃（ADR-013 修订） |
| PlaceholderStatus | OK / MISSING | 已替换/未替换 | 话术占位符校验结果（P2 过程数据） |
