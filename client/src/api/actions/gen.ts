/**
 * gen 域 action（来源：PageSpec generation.md §2 Action 定义 +
 * api-generation.md §4.4 接口清单）。
 *
 * - 纯 gen 域接口按 PageSpec 落键（outline/task 全量）。
 * - 本页跨域引用的两类接口（deck 详情 / asset 选择池）以 gen 前缀注册、
 *   URL 原样：deck/auth/assets 模块由并行批次各自注册同名 action
 *   （deck.deckDetail 等），registerModule 对重复 key 直接抛错，因此
 *   这里不得占用它们的键名（防并行批注册冲突）。
 * - 字典 `gen.dictBatch` 已在 dict.ts 集中注册（§4.7），此处不重复。
 */
import { defineModule } from '@/engine/actionExecutor'

export const genModule = defineModule('gen', {
  // —— 大纲 / 整稿（PageSpec generation.md §2）——
  'outlineGenerate': { method: 'POST', path: '/gen/outline/generate', type: 'other' },
  'outlineSave': { method: 'POST', path: '/gen/outline/save', type: 'save' },
  'fullGenerate': { method: 'POST', path: '/gen/full/generate', type: 'other' },

  // —— 任务跟踪（api-generation.md §4.4：list/detail/progress/cancel/retry）——
  'taskList': { method: 'POST', path: '/gen/task/list', type: 'list' },
  'taskDetail': { method: 'POST', path: '/gen/task/detail', type: 'detail' },
  'taskProgress': { method: 'POST', path: '/gen/task/progress', type: 'detail' },
  'taskCancel': { method: 'POST', path: '/gen/task/cancel', type: 'other' },
  'taskRetry': { method: 'POST', path: '/gen/task/retry', type: 'other' },

  // —— 跨域引用（PageSpec generation.md §2 deck_detail / asset_select / brandkit_select）——
  'deckDetail': { method: 'POST', path: '/deck/deck/detail', type: 'detail' },
  'assetSelectList': { method: 'POST', path: '/asset/select/asset-list', type: 'list' },
  'brandkitSelectList': { method: 'POST', path: '/asset/select/brandkit-list', type: 'list' },
})
