/**
 * 字典 action 模块（frontend-specs §4.7：字典动作固定为 `{domain}.dictBatch`，
 * 集中放入 dict 模块，禁止散入业务模块）。
 *
 * URL 来源：api-{deck,version,delivery,assets}.md「枚举字典 POST /{domain}/dict/batch」。
 * ADR-018：generation/adjustment/channel 域退役，gen/adjust dict/batch 随之移除。
 */
import { defineModule } from '@/engine/actionExecutor'

export const dictModule = defineModule('dict', {
  'deck.dictBatch': { method: 'POST', path: '/deck/dict/batch', type: 'dict' },
  'ver.dictBatch': { method: 'POST', path: '/ver/dict/batch', type: 'dict' },
  'deliver.dictBatch': { method: 'POST', path: '/deliver/dict/batch', type: 'dict' },
  'asset.dictBatch': { method: 'POST', path: '/asset/dict/batch', type: 'dict' },
})
