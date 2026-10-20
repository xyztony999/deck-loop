# D0 — 导出交付渲染架构重定向（客户端渲染）

| 属性 | 值 |
|------|-----|
| 日期 | 2026-10-20 |
| 触发 | 功能核查修复轮（commit 74d4412）接入云端真实渲染器后，1GB 服务器资源错配显性化；用户裁决"推倒重来" |
| 定性 | 修正型架构重定向（D1 变更管理入口：API/PRD/PageSpec 层；BA/AA/FL 零变更） |
| 决策方式 | 用户选择题三项定案（本文 §2） |

## 1. 问题与根因

### 1.1 直接问题

服务器 1GB 内存：宝塔+MongoDB+Node 后端常驻已 600-800MB，Chromium 无头渲染瞬时峰值 150-250MB/实例（渲染网关 2 并发）——叠加即 OOM。该服务器在 v1 时代即因 Java+MySQL 内存峰值死亡过一次。

### 1.2 根因

v1 设计由引擎 SCM 企业模板生成，「云端渲染、产物留存」是企业文档交付的默认姿势；v3 冻结契约时原样继承。三个前提在个人单用户产品+小内存 VPS 的现实下全部不成立：

1. 「服务器内存充裕」→ 实际 1GB 挤占；
2. 「多客户端需统一输出」→ 实际单创作者；
3. 「客户端瘦、渲染服务化」→ 实际客户端（Tauri WebView）本就是 Chromium，用户电脑内存充裕。

反向支撑：演示放映（S-03）已是客户端渲染——「放映看到的」和「导出拿到的」本可同源（所见即所得），云端渲染反而引入两套排版的漂移风险。

## 2. 决策（用户定案，2026-10-20）

| # | 决策点 | 选择 | 理由与后果 |
|---|--------|------|-----------|
| D1' | 导出台账归宿 | **云端台账 + 产物回传** | 导出记录与产物留云端，换设备可回看下载（多端价值保留，与 v3 保留多端同步同口径）；服务端只存储不渲染，零渲染内存。代价：新增客户端→服务端产物上传端点（multipart） |
| D2' | 客户端渲染技术路径 | **Tauri 插件原生渲染** | 复用 WebView 原生能力（Windows WebView2 PrintToPdf/截图）：质量最好、与演示放映同源所见即所得。渲染源统一为演示渲染组件的多页模式。PPTX 走 pptxgenjs 纯前端（可编辑文本 + DOM 测量字号）。代价：需开发 Tauri Rust 插件（export-renderer：render_pdf/capture_page 两命令）；macOS/Linux 平台矩阵后置 |
| D3' | 服务端渲染器去留 | **彻底移除** | 删 ContentExportRenderer + playwright/jszip/pdf-lib 依赖与渲染网关线程池，服务端回归纯轻量；部署侧 chromium/字体/swap 要求全部撤销。不做 env 开关双路径（双实现双测试与减重初衷相悖） |

## 3. 目标架构

### 3.1 导出链路（v2）

```
客户端                                    服务端（1GB 解套）
──────                                    ─────────────────
[导出弹窗] ──submit──────────▶ 创建导出意图（QUEUED，INV-14 锚定定稿版）
    │
隐藏窗口装载演示渲染组件（多页模式）
  ├─ PDF：插件 render_pdf（WebView2 PrintToPdf，页尺寸=幻灯片尺寸）
  ├─ PNG：插件 capture_page 逐页截图 → 前端 ZIP 打包
  └─ PPTX：pptxgenjs（DOM 测量字号，可编辑文本）
    │
──artifact/upload（multipart）──▶ 魔数/大小/属主/QUEUED 校验 → 落盘 → SUCCEEDED（INV-15）
    │ 失败                                 │
    └─fail（errorMsg）──────────▶ FAILED（≤512 截断）
                                           download/ticket/list 不变（多端可下载）
```

- 渲染数据源：`POST /deliver/present/data`（复用）+ 素材限时 URL（图片在隐藏窗口内加载，公开签名 URL 客户端直取）。
- 状态机 v2：`QUEUED→SUCCEEDED(上传)/FAILED(上报)/CANCELLED`；`RENDERING` 保留枚举值兼容历史行，新链路不再流转。
- 渲染进度/取消：本地渲染进度由客户端 UI 直接反馈；取消=本地中止渲染（任务仍在 QUEUED，可 cancel 或超时不管）；无服务端渲染超时监控。

### 3.2 契约影响（api-delivery v1.3）

| 变更 | 类型 |
|------|------|
| submit 语义：创建导出意图（QUEUED），渲染由客户端执行（needConfirm 流不变） | interface_changed |
| 新增 `POST /deliver/export/upload`（multipart：exportId+file；校验属主/QUEUED 前置/格式魔数/扩展名一致/大小上限 EXPORT_ARTIFACT_MAX_MB 默认 50MB） | interface_added |
| 新增 `POST /deliver/export/fail`（exportId+errorMsg，QUEUED→FAILED） | interface_added |
| cancel 触发条件 QUEUED/RENDERING→QUEUED（RENDERING 兼容历史） | state_changed |
| 错误码新增 BIZ_EXPORT_UPLOAD_INVALID；BIZ_EXPORT_PPTX_UNSUPPORTED_TEMP 保留（契约错误码不复用） | enum_added |
| present/data 兼作客户端导出渲染数据源 | rule_added |

不变：download/download-ticket/list/INV-14/INV-15/事件 deliver_export_finished（终态发布时机=上传/上报生效后）。

### 3.3 BA/AA/FL 零变更声明

渲染位置是技术实现重定向（api-delivery §1.2 自始声明渲染引擎为基础设施）；导出交付的业务活动、菜单、功能点、用户类型均不变。FL operList 语义微调（cancel 条件）随 PageSpec v1.1 备案。

### 3.4 安全

上传端点：会话属主 + QUEUED 条件更新（幂等键同既有终态推进）；multer 大小上限独立 env；魔数白名单（PDF=%PDF-、ZIP 系=PK\x03\x04）+ 扩展名与 export_format 一致性；产物落盘走 ExportArtifactStorageService 既有白名单 key 规则。服务端零新增出站请求（SSRF 面不扩大）。

## 4. 实施清单（交 /pipeline）

1. 服务端：删 ContentExportRenderer/mock 残留引用与 playwright/jszip/pdf-lib 依赖；渲染网关简化为产物接收（upload/fail 控制器+服务）；e2e 改造（上传链路替代渲染等待）；README-node 撤销 chromium/字体/swap 段。
2. 客户端：export-renderer Tauri 插件（render_pdf/capture_page，Windows WebView2 先行）；演示渲染组件抽多页模式；导出编排（隐藏窗口/进度/失败重试/上传）；deliver.shared 流程改造。
3. 回归：后端全量测试 + 客户端三绿 + 桌面端手工验收（三种格式导出真实文件）。
