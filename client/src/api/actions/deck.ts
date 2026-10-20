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
})

/**
 * 品牌规范选择池（服务标识 asset.select.brandkitList，PageSpec deck.md §5
 * 步骤②；api-assets.md §4.4 规范选择器 POST /asset/select/brandkit-list）。
 *
 * 刻意不入全局注册表：该服务归 asset 域（assets 模块批次归口注册同名 key），
 * registerModule 对重复 key 直接抛错，并行批次同时注册会炸应用装配——此处
 * 以内联 ActionDef 经执行器调用（actionExecutor 原生支持），URL 仍严格来自
 * PageSpec，不编造。
 */
export const brandkitSelectAction: ActionDef = {
  key: 'asset.select.brandkitList',
  method: 'POST',
  path: '/asset/select/brandkit-list',
  type: 'list',
}
