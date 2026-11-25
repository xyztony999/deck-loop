/**
 * deliver 域 action（来源：PageSpec delivery.md §2 + api-delivery.md §4.4）。
 *
 * ADR-018：网站仅下载已导出产物——新导出由 MCP export_deck 触发（本地 headless
 * 渲染→upload 回传），网站无 submit/cancel/retry/upload/fail 入口，故不注册这些
 * 键（端点服务端保留，消费方为 MCP）。present/data 保留兼容但网站不消费（预览
 * 统一 ver/version/detail，浏览器侧渲染），亦不注册。
 *
 * - exportDownload 为文件流 GET（栈规约：文件下载 GET）。实际取流经
 *   rawAxios(responseType: blob) 直连（业务信封解包不适用于二进制），
 *   此 action 的 path 同时作为 download-ticket 未回 url 时的自拼兜底；
 * - 跨域引用（deck 选择池 POST /deck/select/deck-list）以 deliver 前缀注册、
 *   URL 原样（deck.* 键名由 deck 模块归口，registerModule 重复 key 抛错）；
 * - 字典 deliver.dictBatch 已在 dict.ts 集中注册，此处不重复。
 */
import { defineModule } from '@/engine/actionExecutor'

export const deliverModule = defineModule('deliver', {
  exportList: { method: 'POST', path: '/deliver/export/list', type: 'list' },
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
  // 跨域引用（deck 选择池，api-deck.md §5.1「选择池登记（导出筛选等）」）
  deckSelect: { method: 'POST', path: '/deck/select/deck-list', type: 'list' },
})
