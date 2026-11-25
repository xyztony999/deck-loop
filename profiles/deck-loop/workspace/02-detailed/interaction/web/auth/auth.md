# PageSpec — 登录/注册（Web 入口）

| 属性 | 值 |
|------|-----|
| 模块编码 | P-02（auth 用户可见入口） |
| 用户类型 | creator |
| 业务类型 | 平台入口（无业务单据） |
| 页面类型 | code（独立全屏轻页，bare） |
| 路由 | /auth（登录/注册切换） |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-platform.md v1.2（账号契约冻结）/ api-web-agent.md v1.0 |

## 1. 模块元信息

- App：web/ 未登录态唯一可达页；登录成功 → /deck（或 ?redirect=）。
- 恢复自 client/src/views/auth/index.vue，剥 Tauri 安全存储改 localStorage（现状口径）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| login | POST | /auth/account/login | 登录（@Public） |
| register | POST | /auth/account/register | 注册（@Public） |

## 3. 页面结构（code 轻表单）

| 模式 | 字段 | 校验 |
|------|------|------|
| 登录 | email · password | 格式校验；失败计数提示（5 次锁 10 分钟，BIZ_AUTH_CREDENTIALS 文案透传） |
| 注册 | email · password(≥8) · nickname | email 唯一（BIZ_AUTH_EMAIL_EXISTS 定位字段错误） |

按钮：登录/注册（切换链接）。成功：token 持久化（localStorage）→ 跳 /deck。
**v1.0 注**：登录成功**不触发 sync_pull**（网站直读 PG 单源，无本地副本；同步仅 MCP 本地离线模式消费，ADR-018 §4.1）。

## 4. 路由定义

| 路由 | 页面 | 守卫 |
|------|------|------|
| /auth | 登录/注册 | 未登录；已登录访问→重定向 /deck |

## 5. 全局一致性

- 裸页背景 #141414（页面底层），表单坐浮层 #262626（07 §2）；主色仅 accent。
- 全局路由守卫与 401 拦截见 web/index.md §3。

## 6. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（恢复 creator/auth v1.2 改纯 Web；去 sync_pull 触发——网站单源直读） |