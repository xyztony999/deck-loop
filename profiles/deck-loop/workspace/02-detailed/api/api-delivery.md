# API 设计 — 导出交付与演示放映（C-06 / S-03）

| 属性 | 值 |
|------|-----|
| 模块编码 | C-06 导出交付、S-03 演示放映 |
| 接口域 | deliver |
| 功能类型 | 业务流程类（导出任务子流程）+ 只读放映数据 |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.3 |
| 日期 | 2026-10-20 |
| 输入 | prd-delivery.md v1.2 / domain-model.md v1.2 / D0-export-render-redirect-2026-10-20 |

## 1. 模块设计概述

### 1.1 业务背景及目标

定稿版本的成品交付：**客户端渲染**导出（PDF/图片为主路径，PPTX beta；产物回传云端台账）、记录与下载；客户端全屏演示数据供给（兼作导出渲染数据源）。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 导出发起/记录/下载/取消、产物回传接收（upload/fail）、演示数据读取 | 渲染引擎实现（基础设施——v1.3 起渲染位于客户端 Tauri 插件 + 前端 pptxgenjs，服务端不渲染，ADR-015）、打印/视频/分享、导出模板定制 |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 导出为子流程任务（dl_export_task），**客户端渲染、产物回传云端台账**（多端可下载） | 1GB 服务器资源错配 + 个人单用户 + 所见即所得（渲染源复用演示渲染组件）——ADR-015；云端只存储不渲染 |
| D2 | 仅 FINALIZED 可导出/演示（守卫）；版本锚定 finalVersionId | 定稿语义 |
| D3 | 下载走限时凭证 GET 接口（栈规约：文件下载 GET） | 凭证 30min |
| D4 | 首期不做产物缓存复用（每次新任务） | 简化；素材停用不删文件保证可渲染 |
| D5 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 导出任务 ExportTask | 子流程（独立聚合，本模块建模） | dl_export_task；SUCCEEDED 终态即「导出记录」 |
| 演示数据 | 过程数据（派生读取） | 定稿版本快照 + 备注组装 |

### 1.5 上下文映射

| 对方 | 关系 | 模式 |
|------|------|------|
| 版本管理（本域） | 读定稿版本快照 | 域内直调 |
| 素材品牌域 | 渲染取素材文件 | ACL+OHS |
| 创作物模块 | 定稿守卫 | 域内直调 |

## 2. 跨聚合根设计

不适用（单聚合根模块；读取侧跨聚合无不变量）。

## 3. 应用/基础设施层设计

### 3.1 接口规范

业务 POST；下载 GET（/deliver/export/download，限时效价）；Result\<T\>/PageResult\<T\>；导出记录列表返回 operList。

### 3.2 依赖与约束

- 守卫：Deck.deckStatus=FINALIZED（BIZ_DECK_STATUS_FORBIDDEN）。
- 渲染以 finalVersionId 快照为准（版本内容 + instruction_snapshot 内素材引用）。

### 3.3 权限模型

会话+属主；下载接口校验凭证签名 + 属主。

### 3.4 公共规范

错误码：BIZ_EXPORT_{ERROR}（BIZ_EXPORT_NOT_FINALIZED / BIZ_EXPORT_NOT_DOWNLOADABLE / BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP / **BIZ_EXPORT_UPLOAD_INVALID**（v1.3：上传前置状态/魔数/扩展名/大小不合法））；枚举 ExportFormat/ExportStatus（枚举池）。

## 4. 聚合根详细设计 — 导出任务 ExportTask（子流程）

### 4.1 领域模型

| 表 | 类型 | 说明 |
|----|------|------|
| dl_export_task | 主表（子流程聚合） | 导出任务/记录 |

**主表字段（dl_export_task）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| export_id | VARCHAR(32) | PK | 雪花 |
| export_code | VARCHAR(64) | ✅ | EX+yyMMdd+4 位 |
| deck_id | VARCHAR(32) | ✅ | 归属 |
| version_id | VARCHAR(32) | ✅ | 来源（=finalVersionId） |
| export_format | VARCHAR(32) | ✅ | ExportFormat |
| export_status | VARCHAR(32) | ✅ | ExportStatus |
| file_key | VARCHAR(255) | — | 产物对象存储 key（SUCCEEDED 必有） |
| file_size | BIGINT | — | 字节 |
| error_msg | VARCHAR(512) | — | 失败摘要 |
| user_id | VARCHAR(32) | ✅ | 属主 |
| data_version / 审计字段 | — | ✅ | 同规约（无 delete_sign 需求，保留统一模板） |

不变量：INV-14 version_id 必须为该 deck 的 finalVersionId；INV-15 SUCCEEDED ⇔ file_key 非空。

### 4.2 状态模型

ExportStatus（v1.3 客户端渲染）：QUEUED→SUCCEEDED（客户端上传产物）/FAILED（客户端上报）/CANCELLED（创作者取消，QUEUED 前置）。`RENDERING` 枚举值保留兼容历史行，新链路不再流转。触发：创作者发起/取消，**客户端渲染器**上报推进。无审批。

### 4.3 子流程设计

| 子流程 | 触发 | 输入 | 输出 | 输出写入 |
|--------|------|------|------|---------|
| ExportTask | POST /deliver/export/submit（创建意图，QUEUED） | deckId、exportFormat | 客户端渲染产物（回传） | dl_export_task 终态字段 |

内部编排（v1.3）：渲染在客户端（Tauri 插件 + pptxgenjs，D0-export-render §3.1）；服务端经 **export/upload**（终态推进 SUCCEEDED + file_key 落盘）与 **fail**（FAILED + error_msg）接收结果，均为幂等条件更新（幂等键=exportId+前置状态 QUEUED）。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 发起导出 | POST /deliver/export/submit | 创建意图（QUEUED），渲染由客户端执行 |
| 导出记录列表 | POST /deliver/export/list | 分页/按 deck/格式/状态 |
| 产物上传 | POST /deliver/export/upload | multipart；QUEUED→SUCCEEDED |
| 渲染失败上报 | POST /deliver/export/fail | QUEUED→FAILED |
| 导出取消 | POST /deliver/export/cancel | QUEUED（RENDERING 兼容历史） |
| 下载凭证换取 | POST /deliver/export/download-ticket | 换取限时下载 url+expiresIn |
| 产物下载 | GET /deliver/export/download | 限时效价，返回文件流 |
| 演示数据 | POST /deliver/present/data | 定稿版本放映数据 |
| 枚举字典 | POST /deliver/dict/batch | ExportFormat/ExportStatus |

#### 接口详情（关键接口）

**POST /deliver/export/submit** — AO：deckId✅、exportFormat✅。
规则：FINALIZED 守卫（BIZ_EXPORT_NOT_FINALIZED）；PPTX 格式响应 needConfirm=true（beta 提示，confirm 才受理）。**v1.3：创建导出意图（QUEUED）即返回，渲染由客户端执行**（隐藏窗口渲染→上传→终态）。VO：exportId、exportStatus。

**POST /deliver/export/upload** — multipart/form-data：exportId✅（表单字段）、file✅（二进制产物）。
规则：属主 + QUEUED 前置（幂等条件更新；非 QUEUED 拒绝 BIZ_EXPORT_UPLOAD_INVALID）；**格式魔数白名单**（PDF=`%PDF-`；PPTX/IMAGES(ZIP)=`PK`）且扩展名与 export_format 一致（pdf/pptx/zip）；大小上限 EXPORT_ARTIFACT_MAX_MB（env，默认 50MB，multer limits）；落盘走产物存储白名单 key（{userId}/{exportId}.{ext}）。成功→SUCCEEDED（file_key/file_size 落库，INV-15）+ deliver_export_finished。

**POST /deliver/export/fail** — AO：exportId✅、errorMsg—（≤512 截断）。
规则：属主 + QUEUED 前置（幂等条件更新）→ FAILED + error_msg；客户端本地渲染失败/用户放弃重试时上报。

**POST /deliver/export/list** — AO：pageNum/pageSize、deckId(eq)、exportFormat(eq)、exportStatus(eq)、timeRange。
行 VO：exportId、exportCode、deckId/deckName 冗余、versionSeq 冗余、exportFormat、exportStatus、fileSize、createdTime、operList[]（download=SUCCEEDED；cancel=QUEUED（RENDERING 兼容历史）；retry=FAILED——客户端本地重新渲染提交）。

**GET /deliver/export/download** — Query：exportId、token。
规则：exportId 属主 + SUCCEEDED（BIZ_EXPORT_NOT_DOWNLOADABLE）；token=HMAC(exportId,userId,exp 30min)，先经 POST /deliver/export/download-ticket 换取（返回 url+expiresIn）。响应：文件流（Content-Disposition 附件名 DL-{deck_code}-v{seq}.{ext}）。

**POST /deliver/present/data** — AO：deckId。
VO：deckName、finalVersionSeq、pages[{pageId,index,title,note,blocks[...]}]（渲染就绪结构，演示模式全屏消费）。
规则：FINALIZED 守卫；组装自 finalVersionId.content + 演讲者备注。**v1.3：兼作客户端导出渲染数据源**（渲染源=演示渲染组件多页模式，所见即所得，ADR-015）；图片经素材限时 URL 客户端直取。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 导出终态 | deliver_export_finished | exportId/deckId/exportStatus | 多端同步、客户端通知 |

仓储契约：ExportTaskRepository（提交 insertOne/终态幂等 updateOne/分页 find）。

## 5. 模块清单汇总

### 5.1 对外服务清单

无。

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 导出提交 | dl_export_task | insertOne |
| 产物接收终态更新 | dl_export_task | updateOne（filter 含前置状态 QUEUED，幂等；upload→SUCCEEDED / fail→FAILED / cancel→CANCELLED） |
| 导出记录分页 | dl_export_task | find（AO→查询字段白名单映射；skip/limit） |

### 5.3 MongoDB collection 设计（dl_export_task）

| 项目 | 值 |
|------|-----|
| collection | dl_export_task（子流程聚合=document；SUCCEEDED 终态即「导出记录」） |
| 主键 | _id=ObjectId（仅存储，不进 VO）；export_id=业务主键（string，唯一索引，对外契约不变） |
| 嵌入 | 无结构化嵌入（终态字段均为标量） |
| 引用（仅存业务 id） | deck_id / version_id（跨聚合引用，string；INV-14 应用层守卫）；file_key 指向对象存储（外部引用） |
| 更新语义 | 终态 updateOne 幂等（filter 含前置状态）；INV-15 SUCCEEDED⇔file_key 非空契约保留 |

**字段清单（=v1 列平移，类型改 Mongo 文档类型）**

| 字段 | Mongo 类型 | 必填 | 说明 |
|------|-----------|------|------|
| export_id | string | ✅ | 业务主键（雪花串，唯一索引） |
| export_code | string | ✅ | EX+yyMMdd+4 位 |
| deck_id | string | ✅ | 归属（跨聚合引用） |
| version_id | string | ✅ | 来源（=finalVersionId；跨聚合引用） |
| export_format | string | ✅ | ExportFormat |
| export_status | string | ✅ | ExportStatus |
| file_key | string | — | 产物对象存储 key（SUCCEEDED 必有） |
| file_size | number | — | 字节 |
| error_msg | string | — | 失败摘要 |
| user_id | string | ✅ | 属主 |
| data_version / delete_sign | number | ✅ | 同规约（子流程级无 delete_sign 需求，保留统一模板） |
| created_by/name、updated_by/name | string | ✅ | 审计 |
| created_time / updated_time | date | ✅ | 审计 |

**索引（schema 声明式创建，06 §3.5）**

| 索引 | 字段 | 约束 |
|------|------|------|
| uk_export_id | export_id | unique |
| idx_deck | deck_id, export_status | — |
| idx_user_created | user_id, created_time | — |

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成（含演示数据接口） |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→dl_export_task collection 设计（跨聚合引用仅存 id/索引）；§4.5 MQ→进程内事件（businessType 不变）。接口契约（含 GET 下载与 download-ticket）冻结不变 |
| v1.2 | 2026-10-08 | restored | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：§4.5 deliver_export_finished 订阅方恢复「多端同步、客户端通知」v1 原订阅方。契约与 collection 设计不变 |
| v1.3 | 2026-10-20 | interface_added×2/state_changed/rule_changed | **渲染架构重定向：云端渲染→客户端渲染**（D0-export-render-redirect-2026-10-20，ADR-015）：①submit 语义改「创建意图，客户端渲染」；②新增 export/upload（multipart，QUEUED→SUCCEEDED，魔数/大小/属主校验）与 fail（QUEUED→FAILED）；③状态机去 RENDERING 流转（枚举保留兼容）；④cancel 前置收窄 QUEUED；⑤错误码 +BIZ_EXPORT_UPLOAD_INVALID；⑥present/data 兼作导出渲染数据源。download/list/INV-14/INV-15/事件不变；collection 设计不变 |
