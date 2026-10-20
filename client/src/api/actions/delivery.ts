/**
 * deliver 域 action（来源：PageSpec delivery.md §2 Action 定义 +
 * api-delivery.md §4.4 接口清单）。
 *
 * - 纯 deliver 域接口按 PageSpec 落键（export 子流程 + present 只读数据）；
 * - 跨域引用（deck 选择池 POST /deck/select/deck-list）以 deliver 前缀
 *   注册、URL 原样（gen.ts / adjustment.ts 的跨域前缀隔离先例）：deck 域
 *   模块由 deck 批次归口注册 deck.* 键名，registerModule 对重复 key 直接
 *   抛错，故此处不得占用 deck.* 键名；
 * - exportDownload 为文件流 GET（栈规约：文件下载 GET）。实际取流经
 *   rawAxios(responseType: blob) 直连（业务信封解包不适用于二进制），
 *   此 action 的 path 同时作为 download-ticket 未回 url 时的自拼兜底；
 * - 字典 `deliver.dictBatch` 已在 dict.ts 集中注册（§4.7），此处不重复。
 */
import { defineModule } from '@/engine/actionExecutor'

export const deliverModule = defineModule('deliver', {
  // —— 导出子流程（api-delivery.md §4.4）——
  exportSubmit: { method: 'POST', path: '/deliver/export/submit', type: 'save' },
  exportList: { method: 'POST', path: '/deliver/export/list', type: 'list' },
  exportCancel: { method: 'POST', path: '/deliver/export/cancel', type: 'other' },
  // 产物回传（multipart；实际传输经 rawAxios FormData 直连，此键供路径登记/查询）
  exportUpload: { method: 'POST', path: '/deliver/export/upload', type: 'other' },
  // 渲染失败上报（api-delivery v1.3，ADR-015 客户端渲染）
  exportFail: { method: 'POST', path: '/deliver/export/fail', type: 'other' },
  downloadTicket: {
    method: 'POST',
    path: '/deliver/export/download-ticket',
    type: 'other',
  },
  // 文件流 GET（exportId + token query 由 download-ticket 换取）
  exportDownload: {
    method: 'GET',
    path: '/deliver/export/download',
    type: 'export',
  },

  // —— 演示放映（api-delivery.md §4.4 present/data）——
  presentData: { method: 'POST', path: '/deliver/present/data', type: 'detail' },

  // —— 跨域引用（deck 选择池，api-deck.md §5.1「选择池登记（导出筛选等）」）——
  deckSelect: { method: 'POST', path: '/deck/select/deck-list', type: 'list' },
})
