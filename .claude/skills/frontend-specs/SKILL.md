---
name: frontend-specs
description: Vue3引擎栈前端代码规格 - 编码规则、UI/UX规范、代码生成模板统一技能（随栈 profile 激活挂载）
---

# Vue3 引擎栈 — 前端代码规格（frontend-specs）

> **层级**：L2 技术栈 profile（vue3-engine）。📎 参考示例（scm）：组件名（ScmListPage/ScmCardPage 等，框架事实保留原样）、模块示例（srm./scheme. 等标识）来自 scm 参考实现；项目级标识按 manifest 槽位替换。D4 组件推断表（引擎 design skill 引用）以本规格为准。

详细内容已拆分为以下专题文档：

| 文档 | 内容 |
|------|------|
| [01-architecture.md](01-architecture.md) | 前端架构概览：技术栈、Vue语法、TypeScript、组件导入、文件组织、路由、PageContext |
| [02-mandatory-rules.md](02-mandatory-rules.md) | 10条强制规则：请求一致性、禁止编造、引擎不混用、UI强约束、禁止硬编码等 |
| [03-code-templates.md](03-code-templates.md) | 代码生成模板：8种引擎Schema结构 + 8种场景模板 + actions.ts + 路由 + Mock + 业务类型适配 |
| [04-coding-constraints.md](04-coding-constraints.md) | 编码约束：引擎强制使用、Config驱动、actions规范、事件处理、两级卡片模型、字典注册、请求响应规范、禁止规则 |
| [05-ui-ux-specs.md](05-ui-ux-specs.md) | UI/UX规范：全局样式、查询区、金额/字典渲染、列规范、操作列、表单/详情/审批页、弹窗/抽屉、锚点导航、附件上传、导入导出 |

## 快速定位

- 生成列表页 → [03-code-templates.md](03-code-templates.md) § 3.8
- 生成表单页 → [03-code-templates.md](03-code-templates.md) § 3.10
- 生成审批页 → [03-code-templates.md](03-code-templates.md) § 3.11
- 引擎事件怎么绑 → [04-coding-constraints.md](04-coding-constraints.md) § 4.4
- 列宽/对齐/截断 → [05-ui-ux-specs.md](05-ui-ux-specs.md) § 5.5
- dict 字段绑 code 不绑 name → [05-ui-ux-specs.md](05-ui-ux-specs.md) § 5.4
- 金额格式化 → [05-ui-ux-specs.md](05-ui-ux-specs.md) § 5.3
- 操作列用 __action__ 还是 hasRowAction → [04-coding-constraints.md](04-coding-constraints.md) § 4.9
