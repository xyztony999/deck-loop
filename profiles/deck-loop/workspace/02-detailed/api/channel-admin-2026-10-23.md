# 渠道/模型管理端 — 设计与实施规约（2026-10-23）

| 属性 | 值 |
|------|-----|
| 类型 | 新增（渠道配置聚合根 dl_channel + 设置页管理 Tab） |
| 决策 | 用户拍板：全量管理端；能力全选（启停/连通测试/优先级/env 首次导入） |
| 关联 | api-channel.md（增量指针）、gateway-config.ts、07-ui-design-language v2.0 |

## 1. 现状与问题
渠道/模型定义唯一来源 = env `GATEWAY_CHANNELS`（进程启动快照），改配置需 SSH 改 .env + 重启；
MongoDB 仅有偏好（dl_channel_preference）与用量（dl_channel_usage_record）。

## 2. 领域裁决（DDD）
- 新聚合根 **ChannelConfig**（`dl_channel`，channel 域支撑位）：channel_code（唯一业务键）、
  channel_name、api_base_url、api_key_cipher（AES-256-GCM 密文）、api_key_env（可选 env 变量名，展示用）、
  priority、enabled、builtin（内置只读）、models[]（内嵌值对象：model_code/model_name/capability_tags[]/enabled）、
  source（builtin/env-import/admin）、标准审计字段。
- 不变量：channel_code 唯一；启用渠道须含 ≥1 启用模型；apiBaseUrl 过 url-guard（http/https、拒内网保留段）；
  builtin 只读不可改删；**不做物理删除**（用量记录引用，仅启停）。
- 密钥安全（INV-26 延续）：明文仅存在于 save/test 请求瞬间，AES-256-GCM 加密落库（主密钥 env
  `CONFIG_ENC_KEY`，32 字节：64 位 hex / 24 位 base64 / 任意口令 sha256 派生），解密仅在
  platform/gateway 凭证解析内存发生；VO 只回 `apiKeyMasked`（尾 4 位掩码）+ hasKey。
  crypto 工具放 `common/crypto/api-key-cipher.util.ts`（零业务语义纯工具，channel/gateway 共用；
  INV-26 实质红线=密钥不出 gateway 对外投影/不进日志，不受影响）。
- env 首次导入：启动时 `dl_channel` 为空且 GATEWAY_CHANNELS 可解析 → 全量导入（apiKeyEnv 解析
  env 值加密落库）+ seed 内置 MOCK（builtin）。此后以库为准，env 变更不再自动同步（文档注明）。
- 热生效：admin 保存/启停后 reload 运行时快照，**无需重启**。

## 3. 改造点（关键缝）
- `GATEWAY_RUNTIME_CONFIG` 静态 provider → **GatewayRuntimeStore**（可 reload 服务，持快照）；
  四个消费方（channel-registry / provider-adapter.registry / provider-credentials.resolver /
  gateway-task.service）改注 store（`store.get()`）。
- platform.module 装配：启动时执行「空库导入 env + seed MOCK」→ 加载快照进 store。
- channel 域新增 ChannelAdminService/Repository/Controller 段；偏好校验、选择池、路由解析、
  用量 CHANNEL 维度自动跟随新数据源（都走 listEnabled()）。

## 4. API 契约（POST，会话内；channel.controller 增 5 端点）
| 端点 | 入参 | 出参/行为 |
|------|------|----------|
| /channel/admin/list | {} | records[]（channelCode/channelName/apiBaseUrl/priority/enabled/builtin/source/apiKeyMasked/models[]）+ total |
| /channel/admin/detail | {channelCode} | 单渠道回显（无明文 key） |
| /channel/admin/save | {channelCode*, creating?（true=新建语义，须不存在；缺省=编辑，须已存在）, channelName*, apiBaseUrl*, apiKey?（空=保留）, apiKeyEnv?, priority, enabled, models*[≥1 且含编码/名称]} | 校验+落库+reload；新建时 apiKey 与 apiKeyEnv 二选一 |
| /channel/admin/set-enabled | {channelCode, enabled} | 启用校验 ≥1 启用模型；落库+reload |
| /channel/admin/test | {channelCode?} 或 {apiBaseUrl, apiKey, modelCode} | 真实最小 chat 请求（max_tokens=1，10s 超时）→ {ok, latencyMs, errorMsg?} |
错误码新增：BIZ_CHANNEL_CODE_EXISTS / BIZ_CHANNEL_NOT_FOUND / BIZ_CHANNEL_BUILTIN_READONLY /
BIZ_CHANNEL_NEEDS_ENABLED_MODEL / BIZ_CHANNEL_KEY_MISSING。

## 5. 交互（设置页第 5 Tab「模型渠道」）
- 列表表：渠道名/编码/baseUrl/优先级/模型数/密钥（掩码）/状态 tag/来源/操作[编辑|启停|测试]；
  工具栏「新建渠道」primary。builtin 行操作禁用（仅启停）。
- 编辑/新建弹层（Teleport，640px，07 v2.0 表面/浮层语言）：渠道名*/编码*（编辑只读）/baseUrl*/
  apiKey（placeholder=掩码，留空保留；新建必填或改填 env 引用）/apiKeyEnv（选填）/优先级/启用 switch/
  模型清单行编辑器（编码*/名称*/能力四 checkbox/启停/删行 + 添加模型；≥1 启用）+「测试连接」
  （内联回显成功含时延/失败含原因）。
- 保存成功：刷新列表 +「已保存并生效，无需重启」。

## 6. 验收
server jest（admin CRUD/加密往返/env 导入/启停校验/test mock）+ client typecheck/build +
真机：新建 GLM 渠道→测试连接→发起大纲生成走真实渠道；停用后回落。
