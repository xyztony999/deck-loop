/**
 * deck 域 action（来源：PageSpec deck.md §2 / api-deck.md §4.4 接口清单）。
 */
import { defineModule } from '@/engine/actionExecutor'
import type { ActionDef } from '@/engine/actionExecutor'

export const deckModule = defineModule('deck', {
  // 键名自动补 `deck.` 前缀
  deckList: { method: 'POST', path: '/deck/deck/list', type: 'list' },
  deckSave: { method: 'POST', path: '/deck/deck/save', type: 'save' },
  deckDetail: { method: 'POST', path: '/deck/deck/detail', type: 'detail' },
  deckArchive: { method: 'POST', path: '/deck/deck/archive', type: 'other' },
  deckRestore: { method: 'POST', path: '/deck/deck/restore', type: 'other' },
  deckDelete: { method: 'POST', path: '/deck/deck/delete', type: 'delete' },
  deckFinalize: { method: 'POST', path: '/deck/deck/finalize', type: 'other' },
  deckUnfinalize: { method: 'POST', path: '/deck/deck/unfinalize', type: 'other' },
  // ADR-018 §4.3：大纲保存自 /gen/outline/save 迁入 deck 域（DRAFT 态；AO/VO 不变）
  outlineSave: { method: 'POST', path: '/deck/deck/outline-save', type: 'save' },
})

/**
 * 品牌规范选择池（服务标识 asset.select.brandkitList，PageSpec deck.md §5
 * 步骤②；api-assets.md §4.4 规范选择器 POST /asset/select/brandkit-list）。
 *
 * 刻意不入全局注册表：该服务归 asset 域，deck 模块不得越域注册 asset.* 键
 * （registerModule 按模块归口，重复 key 直接抛错）——此处以内联 ActionDef
 * 经执行器调用（actionExecutor 原生支持），URL 仍严格来自 PageSpec，不编造。
 */
export const brandkitSelectAction: ActionDef = {
  key: 'asset.select.brandkitList',
  method: 'POST',
  path: '/asset/select/brandkit-list',
  type: 'list',
}
