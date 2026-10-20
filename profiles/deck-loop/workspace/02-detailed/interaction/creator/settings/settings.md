# PageSpec — 设置中心（渠道偏好 · 用量 · 账户与同步）

| 属性 | 值 |
|------|-----|
| 模块编码 | D-01（channel）+ P-02（auth）用户可见入口 |
| 用户类型 | creator |
| 业务类型 | master_data |
| 页面类型 | config（三 Tab） |
| 路由 | /settings（Tab: 通用/生成偏好/用量统计/账户） |
| 版本 | v1.5（2026-10-09） |
| 输入 | api-channel.md / api-platform.md v1.2 |

## 1. 模块元信息

- App：主窗口右上角设置入口；ScmCardPage（layout: 'tab'）。

## 2. Action 定义

| action key | 方法 | 路径 | 说明 |
|-----------|------|------|------|
| preference_detail | POST | /channel/preference/detail | 偏好 |
| preference_save | POST | /channel/preference/save | 保存 |
| model_options | POST | /channel/select/model-options | 渠道/模型选择 |
| usage_summary | POST | /channel/usage/summary | 用量聚合 |
| account_profile | POST | /auth/account/profile | 资料 |
| sync_pull | POST | /auth/sync/pull | 手动同步 |
| logout | POST | /auth/account/logout | 退出 |

## 3. 字典 Key 清单

| key | 枚举 | 渲染 |
|-----|------|------|
| channel（能力标签） | — | model_options 扩展 capabilityTags tag |
| gen.TaskType | TaskType | 档位分组标签（OUTLINE/整稿/调整） |

## 4. Tab1 生成偏好（config 表单）

| 字段 | 组件 | 校验 |
|------|------|------|
| defaultChannelCode/defaultModelCode | select 级联（model_options，仅 enabled） | 必填（有可用渠道时） |
| preferenceMap.OUTLINE | select | 可空=回落默认 |
| preferenceMap.FULL_GENERATE | select | 同上（标注「质量档建议」） |
| preferenceMap.FULL_ADJUST | select | 同上 |
| preferenceMap.TARGETED_ADJUST | select | 同上（标注「快速档建议」） |
| fallbackChannel | 只读展示 | 平台兜底（detail 返回） |

不可用渠道容错：detail 返回 available=false 的存量选择 → 红色标注「已下线，请改选」；保存时强制改选。
按钮：保存/重置。

## 5. Tab2 用量统计（config 列表）

查询区：dimension(radio CHANNEL/DECK/TASK_TYPE) · timeRange(必填 ≤12 个月)。
表格列：dimName · taskCount · promptTokens · completionTokens · lastUsedAt。分页（DECK 维度）。
无导出按钮（只读台账）。

## 6. Tab3 账户（config 详情卡）

| 区块 | 内容 | 操作 |
|------|------|------|
| 账户信息 | email/昵称 | 昵称编辑 |
| 多端同步 | 当前游标/最近同步时间 | [立即同步]（sync_pull，结果 toast：更新 n 项） |
| 会话 | 登录态到期 | [退出登录]（confirm→回登录页） |

## 7. 路由定义

| 路由 | 页面 | 入口 |
|------|------|------|
| /settings | 设置中心 | 主窗口右上设置图标 |

## 8. Tab0 通用（客户端本地设置）

| 字段 | 组件 | 校验/默认 |
|------|------|----------|
| 主题模式（外观） | radio 三态：跟随系统/亮色/暗色 | 默认跟随系统；localStorage 持久化 |

客户端本地能力（AA 附录B 口径，不入 Action/字典）；实现 stores/appearance.ts + `data-dl-theme` CSS 变量 + ConfigProvider 主题派生。v1.3 的顶栏外观按钮已移除（入口收敛至本 Tab）。

**UI 设计铁律（ADR-014，2026-10-09 领导评审定案；约束全站页面/组件，本页为落点）**：

1. **暗色三层色板同源**：页面底 `#141414` → 内容表面 `#1f1f1f` → 浮层 `#262626`；AntdV token（colorBgLayout/colorBgContainer/colorBgElevated/colorBorderSecondary）必须与 global.less `--dl-*` 变量板锚定同值——禁止组件默认容器色（darkAlgorithm 缺省 #141414）在亮表面显出"更黑的洞"。
2. **禁卡中卡**：同一页面仅一层表面（`.dl-page-card`）；分组用无底色分区（`.dl-tab-section`）+ `.dl-card-title`（蓝色小竖条+底边线）标题，分区间距 16px。
3. **蓝只作 accent**：主色 `#6b8ab5` 仅用于选中态/主按钮/标题小竖条等小面积强调，禁止大面积底色（侧栏不得使用藏青主题底）。

## 9. 全局一致性

- 偏好保存成功后任务路由即时生效（在途任务不受影响，提示文案说明）。
- 退出登录前若有进行中任务 → 阻断提示。

## 10. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-07 | 初始生成 |
| v1.1 | 2026-10-08 | v3 重定向：删除多端同步区块（ADR-013，/auth/sync/pull 接口移除）；其余不变 |
| v1.2 | 2026-10-08 | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：恢复标题「账户与同步」、Action 表 sync_pull、账户 Tab「多端同步」区块（当前游标/最近同步时间/[立即同步] toast 更新 n 项）；其余不变 |
| v1.3 | 2026-10-09 | 增量：主窗口顶栏新增「外观切换」（亮/暗/跟随系统，客户端本地能力，AA 附录B 口径——不涉及业务接口与本文档 Action/字典；实现 stores/appearance.ts + CSS 变量主题） |
| v1.4 | 2026-10-09 | 增量：新增「通用」Tab（外观三态：跟随系统/亮/暗，默认跟随系统；客户端本地能力口径）；修复用量统计 timeRange 载荷（拆分 timeRangeStart/End 上送） |
| v1.5 | 2026-10-09 | 增量：正文补「通用」Tab 需求描述（§8，v1.4 仅版本记）；记录顶栏外观按钮移除（入口收敛至通用 Tab）；写入 UI 设计铁律（ADR-014：暗色三层色板同源/禁卡中卡/蓝只作 accent） |
