/**
 * ver 域 action（来源：PageSpec version.md §2 + api-version.md §4.4 接口清单）。
 *
 * ADR-018：adjustment 域整体退役，版本域（tree/detail/compare/rollback/fork）
 * 保留为网站唯一版本操作面（仅指针类：回退/分叉；内容产出在 agent 侧）。
 * agent-create（/ver/version/agent-create）仅 MCP 个人 token 消费，网站不注册。
 * 字典 ver.dictBatch 已在 dict.ts 集中注册。
 */
import { defineModule } from '@/engine/actionExecutor'

export const verModule = defineModule('ver', {
  versionTree: { method: 'POST', path: '/ver/version/tree', type: 'detail' },
  versionDetail: { method: 'POST', path: '/ver/version/detail', type: 'detail' },
  versionCompare: { method: 'POST', path: '/ver/version/compare', type: 'detail' },
  versionRollback: { method: 'POST', path: '/ver/version/rollback', type: 'other' },
  versionFork: { method: 'POST', path: '/ver/version/fork', type: 'other' },
})