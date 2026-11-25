/**
 * platform 域事件契约（api-platform §4.5，v1 businessType 冻结）。
 * EventEmitter2 进程内发布；**必须数据库写入成功（提交）之后发布**（NR-07）。
 * 原 v1 MQ Producer/Consumer → 事件发布/@OnEvent 订阅（06 §5）。
 *
 * ADR-018（web-mgmt-20261125）：gw_task_advanced / gw_usage_recorded 随 AI 网关
 * 退役（无发布方，api-web-agent §5.4 配套退役清单）；本域不再定义网关事件。
 * 保留事件见各域 events.ts（ver_version_created / deck_deck_status-changed /
 * asset_{resource}_changed / deliver_export_finished）。
 */