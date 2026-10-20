# Deck-Loop 功能实现核查（2026-10-20）

核查基线：Git `73bb651`；业务 profile `deck-loop`；NestJS/MongoDB 后端及 Vue3/Tauri 客户端。

**结论：主要业务模块和接口已实现，但尚未完整实现设计承诺的可用功能。本轮功能验收判定 FAIL。** 历史 Gate 2 PASS 是 2026-10-09 的验收记录，不代表本轮发现的缺口已经解决；本报告不撤销当时的用户确认，也不代替完整安全审计。

## 已有实现与验证

- 创作物创建、编辑、检索、归档/恢复、定稿/解锁：有前后端实现及后端集成测试。
- 大纲编辑、生成任务调度、取消/重试、进度查询：有实现；真实渠道有 OpenAI 兼容 HTTP 适配器，并非全部为 Mock。
- 版本留档、版本树、对比、回退、分叉：有实现与后端测试。默认生成数据的结构问题会影响实际预览和定向调整，见 F03。
- 素材、品牌规范、话术模板、渠道偏好、用量统计、账号登录/注册/资料：有页面、接口和后端测试。品牌的 AI 注入仍有缺口，见 F04。
- 演示模式有全屏、翻页、备注等代码；未在本轮进行真实桌面交互验收。
- 机械对账：后端 66 个路由（65 HTTP + 1 SSE）；前端 Action 文件有 70 个注册项、64 个唯一 URL，全部命中后端。其余为 `/asset/brandkit/provider-get` 和 `/gw/task/stream`。URL 对齐不能证明请求/响应语义完全一致，见 F05。

本轮执行结果：

- `server-node: npm run build`：通过。
- `client: npm run typecheck`：通过。
- `client: npm run build`：通过。
- `server-node: npm test -- --watchman=false --coverage --coverageReporters=text-summary`：10 suites / 70 tests 全部通过，无跳过，约 44 秒。
- 覆盖率：Statements 84.42%，Branches 54.98%，Functions 82.08%，Lines 84.03%。这是 Jest 本次汇总口径，未显式设置 collectCoverageFrom，不能据此声称所有源码、每个 Service 或 Controller 均达到门槛。
- 首次测试因本机 Watchman 服务启动失败而未执行用例；禁用 Watchman 后完成上述验证。测试中出现了应用关闭时在途回调报连接关闭的日志，用例仍通过；不能将其当作无异常运行的证明。

## 功能缺口（按优先级）

### F01 / P1：真实导出尚未接入

`server-node/src/deliver/deliver.module.ts:68` 仅注册 MockExportRenderer，无生产渲染器。`mock-export.renderer.ts:80` 生成的 PDF 只有一页占位说明；`:109` 图片包每页使用同一张 1×1 PNG；`:129` PPTX 只有最小容器，没有内容幻灯片。

本轮调用编译后的实际渲染器，传入唯一正文 `UNIQUE_REAL_TEXT`，结果为 `hasRealText=false, hasPlaceholder=true`。任务提交、状态、下载票据、文件下载链路已实现，但下载成功不能认定为成品导出完成。即使渲染引擎实现归外部基础设施负责，当前仓库也没有接通该依赖。

修复验收：接入真实渲染器，验证多页正文、中文、图片、字体及页数；PPTX 至少实际包含可打开的内容幻灯片。

### F02 / P1：语言调整缺少原稿上下文，局部不变性未校验

`server-node/src/adjustment/adjustment.service.ts:261` 的 baseSnapshot 只写主题、需求、指令、baseVersionId、分支名，未写基线版本 content。`generation.domain-service.ts:132` 将此快照序列化后提交网关；`platform/gateway/openai-compatible.adapter.ts:70` 只把该字符串发给模型。网关执行链没有再加载原稿。模型拿到版本 ID，无法读取服务端数据库中的原稿。

此外 PRD `prd-adjustment.md:52` 要求定向调整的非目标页面逐字节保持，否则 FAILED。`generation.callback.service.ts:105` 成功路径直接将返回内容归档；`version.content-support.ts:134` 仅验证 pages 为数组，没有比较非目标页面。请求端的 scope 校验不能替代产出校验。

修复验收：提供完整基线或足够的结构化上下文，采用受限补丁合并或明确作用域输出校验；用多页数据证明修改一个块时其余内容保持不变，并拒绝越界产物。

### F03 / P1：默认 Mock 生成结果无法完成定向调整

`server-node/src/platform/gateway/mock-ai-provider.adapter.ts:35` 和 `:43` 的产物没有 pageId、blockId。`client/src/views/adjust/composables/useVersionContent.ts:45` 会跳过缺 blockId 的块，并仅在客户端补 page-N；后端 `adjustment.service.ts:227` 仍只查实际 pageId。

本轮执行实际 Mock provider 并调用后端作用域解析，生成结果 `pageId=null, blockId=null`，选择前端补出的 `page-1` 得到 `BIZ_ADJUST_SCOPE_INVALID: 目标页不存在：page-1`。这使无真实渠道配置时的默认体验不能完成核心局部调整，预览正文也会被过滤。

修复验收：生成与调整输出统一满足内容契约，页/块 ID 稳定且唯一；以真正生成的首版继续预览、选页、选文本块、定向提交，避免仅用人工夹具测试。

### F04 / P1：品牌与素材引用尚未转成模型可用上下文

PRD `prd-adjustment.md:54` 要求注入色板、字体和 logo 约束文本。`adjustment.service.ts:335` 虽读取品牌规范作有效性校验，最终只保留 brandKitId；`generation.service.ts:87`、`:139` 也只把品牌和素材 ID 写入快照。真实 HTTP 适配器只发送快照字符串，未补充规范值、素材内容或可访问 URL。

因此资产库和品牌 CRUD 已实现，但模型无法仅凭内部 ID 应用品牌规范或理解引用图片。修复验收：捕获模型请求，确认实际品牌值和素材上下文存在，再验生成/调整产物。

### F05 / P1：PPTX 的前后端确认语义不一致，UI 无法正常提交

`client/src/views/deliver/deliver.shared.ts:116` 首次提交不带 confirm，等待成功响应中的 needConfirm 后才弹窗重提。后端 `server-node/src/deliver/export.service.ts:96` 对该请求直接抛 `BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP`；客户端 `engine/request.ts` 将业务失败转为 rejected Promise，无法继续执行确认分支。

后端测试是直接调用 confirm=true 的第二次请求，未覆盖 UI 中的确认闭环。修复验收：统一契约，用户从导出弹窗选 PPTX 后可确认并提交；取消确认时不创建任务。即便修好该问题，仍需解决 F01 的真实渲染。

### F06 / P2：客户端同步只拉取计数，未消费变更

`client/src/stores/auth.ts:71` 的 initialSync 丢弃响应；`views/settings/components/AccountTab.vue:100` 的 syncNow 只累计 changes 数量、推进内存游标并显示成功，没有应用 payload、刷新相关页面、更新实体缓存或保存持久游标。服务端同步接口已实现，但不能把“更新 n 项”理解为客户端已更新 n 项数据。

当前页面重新请求云端接口仍可读取最新数据；这不能替代设计中的增量同步/离线缓存闭环。修复验收：设备 A 修改后设备 B 执行同步，相关内容实际刷新；重启后游标和缓存一致。

### F07 / P2：同一毫秒超过 200 条变更会漏同步

`server-node/src/platform/sync/sync-pull.service.ts:70` 截断分页；`:133` 在整页同毫秒时保留前 200 条；`:78` 仍推进 newCursor 到该毫秒。仓储 `platform/generation-task-core.repository.ts:79` 下次使用严格 `$gt`，未下发的同毫秒记录不会再返回。

用实际 SyncPullService 加确定性内存扫描器复现：201 条同毫秒记录，首次返回 200 条、hasMore=true，按 newCursor 续拉返回 0 条，总计仅 200 条。该隔离复现不使用数据库，验证的是现有服务的截断与游标推进逻辑。历史报告称其“at-least-once 退化”，实际存在漏记录风险。

修复验收：可续传的复合游标或等效可靠方案，覆盖单聚合与跨聚合的同毫秒分页，确保全部记录可达。

### F08 / P2：超过 50 个图片引用时签发不分批

`server-node/src/asset/asset.dto.ts:128` 限制单次签发最多 50 个素材 ID；`client/src/views/adjust/composables/useVersionContent.ts:88` 一次发送全部 ID，且 catch 后返回空映射。版本预览、版本对比及演示复用该函数。51 个不同图片引用会触发参数校验失败，相关图片整体降为占位。

修复验收：按每批最多 50 个 ID 签发并合并结果；验证 51 个以上不同图片的版本和双版本对比。

### F09 / P2：顶栏退出绕过进行中任务守卫

设置 PageSpec `settings.md:87` 要求退出前若有进行中任务则阻断。`client/src/App.vue:49` 的顶栏退出直接调用 auth.logout；仅账户页 AccountTab.vue 的退出入口执行任务检查和确认。同一操作因入口不同而行为不一致。

修复验收：统一退出编排，顶栏和账户页均覆盖 QUEUED/RUNNING 任务阻断与确认。

### F10 / P3：版本对比的直达路由缺失

调整 PageSpec `adjustment.md:108` 声明 `/deck/:deckId/compare?left=&right=`。`client/src/router/index.ts` 未注册该路由，直接访问落入 catchall 并回到列表。已有页内对比抽屉，缺的是设计承诺的直达入口。

修复验收：访问带两版本参数的地址能打开相应对比；或经过设计变更正式撤销该入口并同步文档。

## 引擎状态与核查边界

- `.claude/settings.json` 和挂载记录激活 `node-nestjs-mongo,vue3-engine`，但本项目 `profiles/node-nestjs-mongo/profile.yaml` 不存在，当前 0.4.0 插件 payload/profiles 中也无此栈。已有 .claude 挂载规则/技能/agent 可读并已用于本轮检查；重新激活或同步 profile 存在来源缺失问题。本轮没有擅自 use/sync 或修改绑定。
- 根 CLAUDE.md 仍描述 Spring Boot、待代码生成，部分知识索引仍记 MySQL；实际后端是 NestJS/MongoDB。这属于文档漂移。
- 本轮未修改业务代码，未调用真实收费模型、未读取密钥值、未对外部署，也未执行桌面安装包、SSE 长连接或离线场景的交互验收。
- 历史报告中“版本插入/指针/引用计数两段事务”的注释不宜直接照搬为现状：当前 version.archive-service.ts 的 insertAndAdvance 已把三者放入同一事务。任务终态回填仍在版本事务之外，取消竞态仍是历史已接受限制。

## 建议实施顺序

先补齐内容契约和调整上下文/作用域校验（F02–F04），接通真实导出并修复 PPTX 确认（F01/F05），再补齐同步消费和可靠游标（F06/F07）、图片分批（F08）及退出/路由一致性（F09/F10）。补测应覆盖这些可观察业务结果，而不只判断任务 SUCCEEDED 或文件魔数。修复后重新核查相应功能；本次不自动进入设计或代码生成。
