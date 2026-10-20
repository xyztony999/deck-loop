# PRD — AI 生成网关 · 账号与设备同步（P-01 / P-02）

| 属性 | 值 |
|------|-----|
| 模块 | P-01 AI 生成网关、P-02 账号与设备同步（AA v1.1，平台支撑域；v2.1 复议恢复多端同步，ADR-013） |
| 功能类型 | 平台支撑（通用能力，薄业务建模） |
| 版本 | v2.1 |
| 日期 | 2026-10-08 |

## 1. 业务目标（G1）

P-01：统一收口外部大模型调用——OpenAI 兼容协议适配、密钥服务端托管、按偏好路由、重试降级、异步任务调度、SSE 进度流、用量计量；业务域不感知厂商差异。P-02：账号体系与多端同步，服务端为唯一主数据源。

## 2. 功能范围（G2）

**做（P-01）**：渠道/模型清单下发（含能力标签/状态）、生成任务接收与调度（队列/执行/状态/取消/重试）、provider 适配器框架（首期 OpenAI 兼容协议适配器 + Mock 渠道）、密钥托管（仅服务端 env/config）、SSE 任务进度流、用量计量与统计明细、任务回调通知业务侧。

**做（P-02）**：注册/登录/登出/资料（昵称读写）、X-Auth-Token 会话、防爆破锁定、多端增量同步（变更游标）、离线缓存一致性说明。

**不做**：渠道运营后台（首期配置文件/数据库直配）；自训练模型；第三方登录（首期邮箱+密码）；协作冲突解决（单用户无冲突）；文件级双向同步（素材单向上传）。

## 3. 角色（G3）

创作者：间接受益（透明）；无直接运营角色。

## 4. 领域对象与关系（G4/G5）

P-01：GenerationTask（调度实体，业务侧共享）、UsageRecord（日志型实体）、ChannelModel（渠道/模型注册数据）。P-02：Account（聚合根，从简）。见 domain-model.md §3。

## 5. 业务字段（T1）

**ChannelModel**：channelCode、channelName、modelCode、modelName、capabilityTags、enabled、priority。
**UsageRecord**：userId、channelCode/modelCode、taskId、taskType、promptTokens/completionTokens、occurredAt。
**Account**：email、passwordHash、nickname、accountStatus（ACTIVE/LOCKED）、lastLoginAt。

## 6. 被引用关系（T1a）

渠道清单被 D-01 消费；任务被 C-02/C-03 创建与查询；SSE 进度流被任务跟踪面板消费；账号被全域作 user 上下文。

## 7. 状态流转（T2）

任务状态机见 domain-model.md §4.2（TaskStatus：QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELLED，网关负责推进与回调）。

## 8. 业务规则

1. 密钥仅服务端持有（env/config 注入，仅网关域可读）；任何接口/日志不得回显（ADR-010）。
2. provider 适配：外部渠道统一走 OpenAI 兼容协议适配器；Mock 渠道返回本地构造结果（不发起外部调用），用于无密钥环境的演练与联调。
3. 路由顺序：任务级显式指定 > 用户偏好档位 > 默认渠道 > 平台兜底渠道。
4. provider 调用失败自动重试 1 次（幂等键=taskId）；重试仍失败→FAILED + 错误摘要。
5. 任务执行幂等：回调重复投递以 taskId+状态终态守卫。
6. SSE 进度流推送 task-progress / task-finished 事件；SSE 为增强通道，任务状态查询接口为兜底。
7. 登录连续失败 5 次锁定 10 分钟（accountStatus=LOCKED）；会话 token 30 天滑动过期，登出即失效。
8. 同步协议：客户端带 lastSyncCursor 拉增量；服务端变更游标单调递增（v3 Mongo 实现：游标=Date 毫秒+(聚合内业务 id) 复合推进，消除秒精度截断重投，ADR-013）。

## 9. 非功能与异常（N1/N2）

- 并发任务：单用户 ≤3 并发执行，超出排队。
- 网关到 provider 超时按档位（大纲 60s/整稿 300s）。
- SSE 断连自动重连，任务状态查询兜底。
- 登录会话 30 天滑动过期；同步冲突不可能（单用户写串行化）。

## 10. 历史与审计（N4）

UsageRecord 只追加；登录记录留存。

## 11. 更新记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.1 | 2026-10-08 | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：P-02 复名「账号与设备同步」，恢复 §1/§2 多端增量同步（变更游标）与离线缓存一致性、业务规则 8 lastSyncCursor 同步协议、N1 同步冲突不可能表述；技术口径维持 v3（Node/NestJS+MongoDB、OpenAI 兼容协议适配器+Mock、密钥仅服务端 env/config、SSE、防爆破锁定）。 |
| v2.0 | 2026-10-08 | v3 技术栈重定向（D0-v3）：P-02 收缩为账号与访问，多端同步（游标拉取/增量通知/离线缓存）整体移除（ADR-013）；AI 网关明确 OpenAI 兼容协议适配器 + Mock 渠道、密钥仅服务端 env/config（ADR-010 v3 口径）；路由四层链、任务状态机、SSE 进度流、用量计量、防爆破锁定均保留。无业务功能新增。 |
| v1.0 | 2026-10-07 | 初版（P-01 AI 生成网关 + P-02 账号与设备同步）。 |
