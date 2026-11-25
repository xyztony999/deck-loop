# PageSpec — 设置中心（账户/API token/外观）

| 属性 | 值 |
|------|-----|
| 模块编码 | P-02（auth/token 用户可见入口） |
| 用户类型 | creator |
| 业务类型 | 平台设置（无业务单据） |
| 页面类型 | hybrid（三 Tab，DlCardPage layout: 'tab'） |
| 路由 | /settings（?tab=account\|token\|appearance） |
| 版本 | v1.0（2026-11-25） |
| 输入 | api-platform.md v1.2（profile）/ api-web-agent.md v1.0 §4.1（token 三端点）/ ADR-014 / 07 v2.0 |

## 1. 模块元信息

- App：web/ 顶栏用户菜单「设置」；恢复 client/src/views/settings/，**移除 Tab：生成偏好/用量统计/模型渠道**（随网关退役，ADR-018）。
- Tab 坐表面顶部下划线式（07 §3.4）；Tab 内小节流（分隔线+小节标题，禁卡中卡）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| profile | POST | /auth/account/profile | 读/改昵称（refreshedToken 静默续期） |
| logout | POST | /auth/account/logout | 退出 |
| token_issue | POST | /auth/token/issue | 签发（明文仅此次） |
| token_revoke | POST | /auth/token/revoke | 吊销（幂等） |
| token_list | POST | /auth/token/list | 分页 |

## 3. 账户 Tab（?tab=account，默认）

小节：账号资料（email 只读 · nickname 编辑保存）· 会话（退出登录按钮，danger ghost → 清态回 /auth）。
**无同步状态展示**（网站直读 PG 单源，无本地副本；同步仅 MCP 本地离线模式，ADR-018 §4.1）。

## 4. API token Tab（?tab=token，新增）

说明文案（小节标题下 12px 次要色）：「个人 API token 供 coding agent 的 deck-loop MCP 远程模式鉴权（环境变量 DECK_LOOP_API_TOKEN）。token 等价你的账号权限，泄露请立即吊销。」

### 4.1 列表

页头操作：签发 token（primary）。
表格列：tokenName · tokenPrefix（等宽字体 `dlpat_xxxxxx…`）· status tag（ACTIVE green/EXPIRED gray/REVOKED gray）· createdTime · expiresAt（永久显示「长期」）· lastUsedAt（从未使用显示「—」）· __action__。
operList：revoke（status≠REVOKED；强确认「吊销后使用该 token 的 MCP 立即失效，不可恢复」）。

### 4.2 签发弹层（浮层 480px）

字段：tokenName✅≤50（placeholder「如：ZCode 桌面」）· 有效期 radio（90 天默认/自定义 1~365 天 InputNumber/永久）。
成功态（**关键交互**）：弹层切换为明文展示——token 全文（等宽字体，只读输入框）+ 复制按钮 + 警示文案「token 仅显示这一次，关闭后无法再次查看。请配置到 MCP 环境变量 DECK_LOOP_API_TOKEN。」；关闭按钮（无「再次查看」路径，INV-28）。
失败透传 BIZ_* 文案。

## 5. 外观 Tab（?tab=appearance）

恢复 creator/settings v1.5 外观小节：主题三态（跟随系统/亮/暗，默认跟随系统）；暗色锚定 ADR-014 三层色板（theme.ts/global.less --dl-* 同值）；**预览画布文档表面永远白纸不受主题影响**（07 §1）。

## 6. 路由定义

| 路由 | 页面 | 菜单入口 |
|------|------|---------|
| /settings | 三 Tab 设置 | 顶栏用户菜单 |

## 7. 全局一致性

- token 明文不进日志/不回显（列表仅 prefix）；复制成功 toast 直白文案。
- 吊销即时生效说明（服务端每次查库，无延迟）。

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-11-25 | 初版（恢复 creator/settings v1.5 改纯 Web：移除生成偏好/用量/模型渠道三 Tab；新增 API token Tab（签发一次性明文/吊销/列表）；去同步状态） |