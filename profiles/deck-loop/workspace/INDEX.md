---
# deck-loop 工作区索引（schema 见 engine/design/engine-abstract/07 §2.5）
pipeline:
  - { id: functional-audit-20261020, title: 功能实现核查, path: 05-reports/functional-audit-2026-10-20.md, status: complete, note: 功能验收 FAIL：真实导出/调整上下文与作用域/默认产物ID/品牌注入/PPTX确认/同步闭环与游标/图片分批存在缺口；构建与70测试通过；保留历史Gate确认记录 }
  - { id: export-render-impl-20261020, title: 增量：ADR-015 实施完成（渲染下沉客户端）, status: complete, note: 服务端删 ContentExportRenderer/渲染网关/playwright 依赖，新增 export/upload（multipart 魔数/50MB/属主/QUEUED）+ export/fail，状态机去 RENDERING 流转；客户端 export-render 隐藏渲染窗（服务端模板平移）+ Tauri 原生命令（Windows WebView2 PrintToPdf/CapturePreview）+ pptxgenjs 三格式 + 进度/失败上报链；后端 13 套件 89 用例 + 客户端三绿 + cargo check 0 错；桌面端三格式手工冒烟待用户执行 }
  - { id: export-render-redirect-20261020, title: D0 重定向：导出渲染下沉客户端（ADR-015）, path: 05-reports/D0-export-render-redirect-2026-10-20.md, status: complete, note: 云端渲染→客户端渲染（Tauri 插件+pptxgenjs，所见即所得）；云端台账+产物回传；服务端渲染器彻底移除。契约变更 api-delivery v1.3（+export/upload +fail，状态机去 RENDERING）+ prd v1.2 + delivery PageSpec v1.1；BA/AA/FL 零变更。实施待 /pipeline }
  - { id: audit-fix-20261020, title: 增量：功能核查修复（F01-F10）, status: complete, note: F02-F04 调整/生成快照携带基线内容+品牌值+素材上下文、Mock 产物 pageId/blockId 契约、TARGETED 非目标不变性校验；F05 PPTX needConfirm 提示态（契约对齐）；F01 真实渲染器接入（Playwright/Chromium 单排版引擎 PDF/PNG/PPTX，素材进程内直读）；F07 复合游标 lastPosition/newPosition（同毫秒续传）；F06/F08-F10 客户端消费/分批/退出守卫/compare 路由；后端 14 套件 93 用例 + 客户端三绿；契约增量：sync/pull +2 可选字段 }
  - { id: d0-clarify, title: 需求澄清报告, path: 05-reports/D0-需求澄清报告.md, status: complete, note: 两轮澄清 9 项决策（2026-10-07） }
  - { id: d1-architecture, title: 架构设计（BA/AA/FL）, path: 00-architecture/, status: complete, note: BA v1.0 零变更 / AA·FL v1.1（v3 重定向更新，2026-10-08） }
  - { id: d2-prd, title: PRD + 领域模型, path: 02-detailed/prd/, status: complete, note: domain-model v1.1 + 8 PRD（platform v2.0，其余 v1.1） }
  - { id: d3-api, title: API/契约设计, path: 02-detailed/api/, status: complete, note: delivery v1.3（ADR-015 客户端渲染）+ 其余 7 文档 v1.2 + index v1.2 + 06 规约（Node/Mongo，66+2 端点——含 sync/pull 复议恢复与 export/upload、fail） }
  - { id: d4-interaction, title: 交互设计, path: 02-detailed/interaction/creator/, status: complete, note: 7 PageSpec（settings v1.5 / delivery v1.1（本地渲染编排）/ auth v1.2，其余 v1.0 冻结沿用） }
  - { id: b-node, title: v3 后端代码生成（Node/NestJS）, path: ../../server-node/, status: complete, note: 八域+70 用例+NR 合规（2026-10-09） }
  - { id: gate2-v3, title: Gate 2 验证报告（v3）, path: 05-reports/gate2-v3-2026-10-09.md, status: complete, note: PASS（2026-10-09 用户确认+测试环境验收） }
  - { id: incr-20261009, title: 增量：dark mode + 品牌 logo, path: ../../assets/brand/BRAND.md, status: complete, note: 外观三态切换（客户端本地能力）+ logoloom 品牌套件/Tauri 图标/favicon；typecheck/build/cargo 三绿（2026-10-09） }
  - { id: incr-20261009b, title: 增量：外观设置迁移/暗色适配修复/logo 重设计/用量 bug, status: complete, note: 外观迁设置页默认跟随系统；组件暗色清理 90 处+现代化；logo 新方向（双气泡循环）+任务栏 ico 修复；timeRangeStart/End 载荷修复；三绿（2026-10-09） }
  - { id: incr-20261009c, title: 增量：UI 设计铁律入档（ADR-014）, status: complete, note: 领导评审三轮定案写入设计资产：①knowledge/design-decisions ADR-014；②settings PageSpec v1.5（通用 Tab 需求描述 + 铁律约束 + 顶栏按钮移除记录）；文档级增强，无契约/接口变更（2026-10-09） }
  - { id: v3-redirect, title: v3 技术栈重定向（含复议）, path: 05-reports/D0-v3-技术栈重定向.md, status: complete, note: Node/TS/NestJS + MongoDB（宝塔 Node 项目部署+既有实例，ADR-011）；多端同步复议保留（ADR-013）；66 端点契约全量冻结 }
  - { id: gate1-v3, title: Gate 1 验证报告（v3）, path: 05-reports/gate1-v3-2026-10-08.md, status: complete, note: 8 项检查 + 小修复闭环（2026-10-08） }
reference:
  - { title: 枚举池, path: 01-solution/common-spec/04-business-enum.md }
  - { title: 公共枚举, path: 01-solution/common-spec/03-common-enums.md }
  - { title: 选择服务池, path: 01-solution/common-spec/05-select-service-pool.md }
  - { title: Node/Mongo 规约（v3）, path: 01-solution/common-spec/06-node-api-conventions.md }
modules:
  - name: deck-loop-full
    domain: core
    stages:
      requirement:  { status: complete, note: v3 设计集就绪（AA/FL/PRD/domain-model v3 口径，BA 零变更） }
      api:          { status: complete, note: 8 份 v1.2（Node/Mongo）+ index；66 端点契约全量冻结 }
      interaction:  { status: complete, note: 7 PageSpec（settings/auth v1.1） }
      backend:      { status: complete, note: v3 B 阶段完成（2026-10-09）：server-node/ 八域 66 端点契约冻结实现；npm test 70/70 零跳过；NR 全达标 }
      frontend:     { status: complete, note: v3 F 阶段完成（2026-10-09）：v1 资产全量复用，仅 9 处类型修正零功能改动；typecheck/build 双绿 }
      validation:   { status: complete, note: Gate 2 v3 PASS（2026-10-09 用户确认，测试环境实测）；报告 05-reports/gate2-v3-2026-10-09.md }
    gates:
      gate1: { status: pass, note: v3 重验 2026-10-08 PASS，复议增量复核通过（报告 gate1-v3-2026-10-08.md） }
      gate2: { status: pass, note: 2026-10-09 WARN→用户确认→PASS；测试环境实测验收 }
---
