# 前端架构概览

## 1.1 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Vue | 3.4+ | 组合式 API，`<script setup>` 风格 |
| TypeScript | 5.0+ | 全量类型约束 |
| Ant Design Vue | 4.x | 统一组件库 |
| Vite | 5.x | 构建工具 |
| Pinia | 最新 | 状态管理 |
| pnpm workspace | — | Monorepo 包管理 |

## 1.2 Vue 语法

- **强制** `<script setup>` + 组合式 API
- **禁止** Options API（`export default { data(), methods: {} }`）
- **禁止**在 `<template>` 中编写复杂表达式，须抽取为 `computed` 或方法

## 1.3 TypeScript

- 所有 `.ts` / `.vue` 文件须通过 `vue-tsc` 类型检查
- 页面 Schema 配置**必须**使用 `@scm/framework` 提供的类型定义
- **禁止** `any` 类型，除非标注 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 并附理由

## 1.4 组件导入

- 框架组件（引擎、卡片、字段、工具函数）统一从 `@scm/framework` 导入
- **禁止**将框架组件复制到页面目录
- **禁止**从 `ant-design-vue` 直接导入组件（应通过框架字段类型间接使用），以下例外：
  - 图标（`@ant-design/icons-vue`）
  - `message` / `Modal.confirm`（用于 Toast 和确认弹窗）

## 1.5 组件不感知页面

框架组件（引擎、卡片、字段）只关心自身行为，**不关心数据来源于哪个页面**：

- 数据通过 `props` 或 `pageContext` **传入**
- 事件通过 `emit` **上报**
- **禁止**在框架组件中引入 `useRoute` / `useRouter` 或访问路由参数、页面 path
- **禁止**在组件中硬编码页面特定的 data key、路由地址、业务上下文

## 1.6 文件与路由组织

每个业务模块按以下结构组织文件：

```
src/views/{domain}/{resource}/
  index.vue                  # 页面入口（引入 Schema，传入引擎，处理页面级事件）
  actions.ts                 # 接口调用配置（defineModule 定义）
  {Module}List.config.ts     # 列表页 Schema 配置（ScmListPage / ScmCardPage）
  {Module}Dialog.config.ts   # 弹窗表单 Schema（如有）
  {Module}Detail.config.ts   # 抽屉详情 Schema（如有）
```

- **禁止**跨模块引用 config 文件

路由组织：

```
src/router/
  index.ts              # 路由入口，汇总所有模块路由
  modules/
    {module}.ts         # 各业务模块路由
```

- **路由**：前端静态配置，控制页面访问
- **菜单**：后端动态返回，控制显示项（菜单 `path` 对应路由 `path`）
- 两者分离，**禁止**前端根据菜单动态生成路由
- 面包屑由框架根据路由 `meta.title` **自动生成**，**禁止**页面自行实现面包屑逻辑

## 1.7 页面入口（index.vue）

`index.vue` **只能**包含：

1. 引入 Schema 配置（`XxxList.config.ts` / `XxxPage.config.ts`）
2. 引入 `actions.ts`
3. 传入引擎组件（`<ScmListPage>` / `<ScmCardPage>`）
4. 处理页面级事件（弹窗打开、抽屉打开、路由跳转等）

**禁止**在 `index.vue` 中：直接调用接口、手写页面结构、写业务逻辑
