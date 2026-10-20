# Deck-Loop — AI 内容创作语言迭代客户端

「说一句话改一版」：自然语言驱动 AI 生成与调整演示文稿类内容，版本树管理每次迭代。桌面客户端（Vue3+AntdV+Tauri）+ 云端单服务（NestJS 10 `deck-loop-core` + MongoDB，66 端点契约冻结）。v3 已交付（Gate 2 PASS，测试环境验收）；设计文档见 `profiles/deck-loop/workspace/`。

本仓由 [ai-project-engine](../ai-project-engine) 孵化并驱动，profile 依赖引擎随发技术栈。

## Profile 绑定

当前激活：**deck-loop**（business，depends: node-nestjs-mongo, vue3-engine）

@profiles/deck-loop/CLAUDE.md

> 引擎各阶段执行前，按 skills 内「Profile 绑定」节完成槽位替换（manifest：profiles/deck-loop/profile.yaml）。
> 切换/摘除：/profile use <name> / /profile off
