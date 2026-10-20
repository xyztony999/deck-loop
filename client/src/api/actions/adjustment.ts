/**
 * adjust / ver 域 action（来源：PageSpec adjustment.md §2 Action 定义 +
 * api-adjustment.md §4.4 接口清单 + api-version.md §4.4 接口清单）。
 *
 * - adjust 域：whole/targeted 提交、scope 校验；
 * - ver 域：version detail/tree/compare/rollback/fork——迭代工作台内嵌
 *   版本树与对比，version 域动作按任务归口在本模块注册（键名 ver.* 前缀，
 *   与 gen.ts 的 gen.* / deck.ts 的 deck.* 前缀隔离先例一致）；
 * - 跨域引用（asset 话术/规范选择池、OHS file-url 签发）以 adjust 前缀
 *   注册、URL 原样：asset 域模块由资产批次归口注册 asset.* 键名，
 *   registerModule 对重复 key 直接抛错，故此处不得占用 asset.* 键名；
 * - 任务跟踪复用 gen.taskList/taskDetail/taskProgress/taskCancel/taskRetry
 *   （gen.ts 已注册，此处不重复注册）；
 * - 字典 adjust.dictBatch / ver.dictBatch 已在 dict.ts 集中注册（§4.7）。
 */
import { defineModule } from '@/engine/actionExecutor'

export const adjustModule = defineModule('adjust', {
  // —— 调整指令（api-adjustment.md §4.4）——
  wholeSubmit: { method: 'POST', path: '/adjust/whole/submit', type: 'other' },
  targetedSubmit: { method: 'POST', path: '/adjust/targeted/submit', type: 'other' },
  scopeValidate: { method: 'POST', path: '/adjust/scope/validate', type: 'detail' },

  // —— 跨域引用（asset 选择池 / OHS；键名带 adjust 前缀防并行批次冲突）——
  promptSelect: { method: 'POST', path: '/asset/select/prompt-list', type: 'list' },
  promptTouch: { method: 'POST', path: '/asset/prompt/touch', type: 'other' },
  brandkitSelect: { method: 'POST', path: '/asset/select/brandkit-list', type: 'list' },
  assetFileUrl: { method: 'POST', path: '/asset/asset/file-url', type: 'other' },
})

export const verModule = defineModule('ver', {
  // —— 版本域（api-version.md §4.4）——
  versionTree: { method: 'POST', path: '/ver/version/tree', type: 'detail' },
  versionDetail: { method: 'POST', path: '/ver/version/detail', type: 'detail' },
  versionCompare: { method: 'POST', path: '/ver/version/compare', type: 'detail' },
  versionRollback: { method: 'POST', path: '/ver/version/rollback', type: 'other' },
  versionFork: { method: 'POST', path: '/ver/version/fork', type: 'other' },
})
