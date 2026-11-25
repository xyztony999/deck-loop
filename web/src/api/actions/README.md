# src/api/actions/ — action 注册表

所有后端接口调用必须先在本目录注册 action，页面经 `executeAction(key, payload)` 调用。
**URL 一律来自 PageSpec / api-*.md，禁止编造**（frontend-specs 02-mandatory 规则 1/2）。

## 注册格式（F2-F4 按模块追加 `{domain}.ts`）

```typescript
// src/api/actions/deck.ts —— 来源 api-deck.md §4.4 接口清单
import { defineModule } from '@/engine/actionExecutor'

export const deckModule = defineModule('deck', {
  // 键名会自动补 `deck.` 前缀，因此写短名即可
  'deckList':  { method: 'POST', path: '/deck/deck/list',     type: 'list' },
  'deckSave':  { method: 'POST', path: '/deck/deck/save',     type: 'save' },
  'deckDetail':{ method: 'POST', path: '/deck/deck/detail',   type: 'detail' },
  'deckFinalize': { method: 'POST', path: '/deck/deck/finalize', type: 'other' },
})
```

规则（frontend-specs §4.3）：

- 键名格式 `{module}.{resource}{Action}`（defineModule 会自动加模块前缀）
- 必填 `type`：`list` / `detail` / `save` / `delete` / `dict` / `export` / `upload` / `other`
- 路径 `/{domain}/{resource}/{action}`，**不含 `/api` 前缀**（规则 8）
- 统一 `POST`（文件下载 GET）
- URL 支持 `{变量}` 占位符：`executeAction('ver.rollback', ao, { pathParams: { deckId } })`

## 汇总注册

新模块在 `index.ts` 的 `registerAllActions()` 数组中追加 `registerModule(xxxModule)`。

## 已注册（F1 脚手架）

| 模块 | 文件 | action |
|------|------|--------|
| dict | dict.ts | `{deck,gen,adjust,ver,deliver,asset}.dictBatch` → `POST /{domain}/dict/batch`（api-*-*.md 枚举字典） |
| auth | auth.ts | `auth.login/register/logout/profile` → `POST /auth/account/*`（auth.md §2 / api-platform.md）；`auth.syncPull` → `POST /auth/sync/pull`（auth.md §3 首次同步 / api-platform.md §4.4） |

字典 action 固定集中在 dict.ts（§4.7），**禁止**放进业务模块。
