---
description: 用 deck-loop 创作一套新幻灯片（agent 直写，零 API key）
---

按 deck-loop skill 的工作流为用户创作幻灯片。`$ARGUMENTS` 是主题/需求描述；为空则先询问用户主题与受众。

步骤：deck_create → outline_save（先给用户看大纲征求确认）→ version_create 整稿 → preview_deck 给用户预览 → 按反馈迭代（定向调整传 scope，非目标页/块逐字节不动）→ 用户满意后 deck_finalize → 询问导出格式（PDF/IMAGES/PPTX）并 export_deck，返回产物路径。

全程用 deck-loop MCP 工具，不调用任何 LLM API；内容 JSON 由你直接产出。每步检查工具回执，守卫拒绝（isError）时按 message 修正而非绕过。