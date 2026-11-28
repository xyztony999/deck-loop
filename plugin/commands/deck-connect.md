---
description: 连接远程 deck-loop 系统（浏览器授权，凭据不进对话）
---

按 deck-loop skill 的连接模式为用户连接远程系统。向用户询问 deck-loop 的 API 基址
（如 `https://api.<域名>/api`）——不要猜测。

拿到地址后调用 `remote_connect` 只传 `apiUrl`（缺省 password）：插件会自动打开浏览器
授权页（用户在自己系统上登录/确认，passkey 可用，凭据不进对话），最长等待 120s。
若返回 `connected:false`，把返回的 `loginUrl` 链接发给用户手动完成，或重新发起。

连接成功（返回 mode:remote）后告知：之后所有创作与网站同库实时；`manage_open` 打开的
将是用户的网站；想回本地模式用 `remote_disconnect`。