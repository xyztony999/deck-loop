---
name: deck-loop
metadata:
  author: deck-loop
  version: "0.1"
description: "Use this skill when the user wants to create, iterate, preview, or export a slide deck / presentation (幻灯片, 演示文稿, PPT, 汇报/路演材料) via the deck-loop MCP tools. Covers: deck lifecycle (create/outline/finalize), agent-authored content JSON (pages→blocks contract), immutable version tree (rollback/fork/compare), targeted adjustments with byte-level invariance, local HTML preview, and headless PDF/PNG/PPTX export. Trigger on '做一套幻灯片', '生成演示文稿', 'build a deck', '导出 PPT/PDF', or any deck-loop tool usage. Do NOT use for editing existing .pptx files directly (use the pptx skill instead)."
license: AGPL-3.0-only
---

# deck-loop · agent 驱动幻灯片创作

**架构（ADR-017/018/019）**：你（coding agent）出推理，消耗用户的 coding plan；deck-loop MCP server 出确定性状态机（版本树 / 不变性校验 / 渲染导出），**零 API key、零 LLM 调用**。不要尝试调用任何 LLM API——内容 JSON 由你直接产出，经 `version_create` 写入。

## 连接模式（先确认再创作）

- **本地模式（默认）**：开箱即用，sql.js 本地库（`~/.deck-loop/`），零服务端。适合个人/离线。
- **远程模式**：登录用户自己的 deck-loop 系统，与网站同库实时。用 `remote_connect`
  **只传 apiUrl（推荐，浏览器授权）**：插件自动打开网站授权页，用户以自己账号确认
  （passkey 可用），token 自动回传——**凭据不进对话**；最长等 120s，超时把返回的
  `loginUrl` 发给用户手动完成。备选：email+password 直连（密码仅内存不落盘）。
  或让用户用 `/deck-connect` 命令发起。`connection_status` 查当前模式；`remote_disconnect` 回本地。
- 开场先 `connection_status`；用户提到「我的系统/网站/账号」→ 引导 remote_connect；否则本地直接创作。

## 工作流

1. **`deck_create`**（deckName, topic, requirement?）→ 拿 `deckId`（DRAFT 态）。
2. **`outline_save`**（deckId, nodes）→ 大纲节点 1~50，title ≤50 字，points 要点，pageHint 建议页数。仅 DRAFT 态可写，首版后只读。
3. **`version_create`**（deckId, content, instruction）→ 整稿内容 JSON（契约见下）。首版自动 FULL_GENERATE + DRAFT→ITERATING；有基线后自动 FULL_ADJUST。
4. **迭代**：读 `version_get` 拿当前 content → 修改 → 再 `version_create`。
   - **定向调整**传 `scope: {pageId, blockId?}` → TARGETED_ADJUST，**非目标页/块必须逐字节不变**（canonical JSON 相等），否则工具拒绝、不产版本。最稳妥做法：深拷贝基线 content，只改目标块/页。
   - 页数不可增删（定向调整）；pageId/blockId 全保留。
5. **`preview_deck`**（deckId, open?）→ 独立 HTML 放映（←→/空格翻页，F 全屏），给用户看效果。不要求定稿。
6. **`deck_finalize`**（deckId）→ FINALIZED，锚定当前版本。**导出前置**。
7. **`export_deck`**（deckId, exportFormat: PDF|IMAGES|PPTX）→ 返回本地产物路径。PPTX 为 beta（可编辑文本层，字号 fit:shrink）。
8. 解锁迭代用 `deck_unfinalize`；历史回退 `version_rollback`（移指针，历史不动）；分叉 `version_fork`（新命名分支）；对比 `version_compare`。

素材：`asset_add`（filePath 本地图片，jpg/png/svg/webp ≤10MB）→ `assetId` → content 的 IMAGE 块引用。引用计数自动维护。

## content 契约（api-version §4.1）

```json
{
  "pages": [
    {
      "pageId": "p1",
      "layout": "TITLE_BODY",
      "title": "页面标题（自动渲染在顶部 42px 粗体）",
      "note": "演讲者备注（进 PPTX notes / 预览不显示）",
      "style": { "backgroundColor": "FFFFFF" },
      "blocks": [
        { "blockId": "p1-b1", "blockType": "TEXT", "text": "要点一\n要点二" },
        { "blockId": "p1-b2", "blockType": "IMAGE", "assetId": "<asset_add 返回的 id>" }
      ]
    }
  ]
}
```

- **画布 1280×720 px**。pageId/blockId 稳定唯一（惯例 p1..pN / pN-bM）——定向调整与对比按 id 匹配。
- blockType：`TEXT`（text 必填，`\n` 换行）/ `IMAGE`（assetId 必填）/ `PLACEHOLDER`。
- **缺省自动排版**：不写 style 时标题固定顶部（64,36,1152×76），正文块自 y=132 起按块数均分 520px 高、左右留 64px。多数页面用缺省即可。
- style 可选覆盖：`x, y, width(w), height(h), fontSize(10~100, 默认28), fontFamily, color(6位hex), textAlign(left|center|right)`；页级 `style.backgroundColor`。
- 中文确定性渲染：字体栈含 Microsoft YaHei / Noto Sans CJK SC 回退，无需特殊处理。

## 内容质量准则

- 每页一个论点；TEXT 块用精炼要点（每行 ≤30 字为宜），不堆段落。
- 标题 ≤20 字；演讲者备注写展开讲解（note 字段）。
- 页数随主题：5~12 页常见；outline 的 pageHint 是建议，整稿可按要点密度拆页。
- 改稿先 `version_get` 读基线，**保留所有 id**，最小变更。

## 工具速查

| 工具 | 用途 |
|---|---|
| deck_create / deck_list / deck_get / deck_update | 创作物 CRUD（状态 DRAFT/ITERATING/FINALIZED/ARCHIVED） |
| outline_save | 大纲（仅 DRAFT） |
| version_create | **唯一内容写入口**（agent 直写，自动 sourceType） |
| version_tree / version_get / version_compare | 谱系树 / 完整快照 / 逐页逐块 diff |
| version_rollback / version_fork | 移指针回退 / 新分支分叉 |
| deck_finalize / deck_unfinalize | 定稿 / 解锁 |
| deck_archive / deck_restore / deck_delete | 归档 / 恢复 / 软删（仅 ARCHIVED；**删除须用户明确授权**） |
| remote_connect / remote_disconnect / connection_status | 登录远程系统 / 回本地 / 查连接状态 |
| manage_open | 打开图形管理站：local=内嵌本地网站（同库），remote=用户的 deck-loop 网站 |
| asset_add / asset_list | 素材上传（本地路径）/ 列表 |
| preview_deck | HTML 放映预览（不要求定稿） |
| export_deck / export_list | 三格式导出（须 FINALIZED）/ 导出记录 |

数据目录 `~/.deck-loop/`（env `DECK_LOOP_HOME` 可覆盖）：deck-loop.db / assets / artifacts / previews。

## 错误处理

工具失败返回 `{code, message}`（isError）。常见守卫：`BIZ_DECK_STATUS_FORBIDDEN`（状态机拒绝，如 FINALIZED 写版本→先 unfinalize）、`BIZ_DECK_NOT_FOUND`、定向越界（message 含「越界」→检查非目标页/块是否被误改）。不要绕过守卫——它们是产品不变量。