/**
 * adjust 模块页面 config（PageSpec adjustment.md §4 Tab3 任务记录 +
 * §3 字典渲染颜色）。
 *
 * - 任务记录 = DlListPage（gen.taskList，deckId 过滤；行操作 operList 驱动
 *   cancel/retry，规则 6，前端不做可见性判断）；
 * - ver.VersionSourceType 节点 tag 颜色为呈现层映射（PageSpec §3 渲染列
 *   「版本节点 tag」；label/value 仍全部来自后端字典 ver.dictBatch）。
 */
import type { DlListPageConfig } from '@/engine'
import { registerDictColorMap } from '@/engine'

/**
 * ver.VersionSourceType 呈现层 Tag 颜色。PageSpec §3 未给逐值配色，
 * 按来源语义着色（初稿蓝 / 整稿调整紫 / 定向调整青）；
 * registerDictColorMap 幂等合并，重复调用安全。
 */
export function registerAdjustDictColors(): void {
  registerDictColorMap('ver', {
    versionSourceType: {
      FULL_GENERATE: 'blue',
      FULL_ADJUST: 'purple',
      TARGETED_ADJUST: 'cyan',
    },
  })
}

// ---------------------------------------------------------------
// 任务记录（DlListPage，Tab3；调整类任务跟踪，deckId 过滤）
// ---------------------------------------------------------------

export const adjustTaskListConfig: DlListPageConfig = {
  listAction: 'gen.taskList',
  domain: 'gen',
  rowKey: 'taskId',
  queryFields: [
    { field: 'taskType', label: '任务类型', type: 'select', dictKey: 'taskType' },
    { field: 'taskStatus', label: '任务状态', type: 'select', dictKey: 'taskStatus' },
  ],
  columns: [
    // 序号列 dataIndex 固定 '__seq__'（DlListPage bodyCell 约定，同 __action__）
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center' },
    { dataIndex: 'taskCode', title: '任务编码', width: 150, ellipsis: true },
    {
      dataIndex: 'taskType',
      title: '任务类型',
      type: 'dict',
      dictKey: 'taskType',
      width: 100,
      align: 'center',
    },
    {
      dataIndex: 'taskStatus',
      title: '任务状态',
      type: 'dict',
      dictKey: 'taskStatus',
      colorTag: true,
      width: 100,
      align: 'center',
    },
    { dataIndex: 'instructionBrief', title: '任务摘要', ellipsis: { rows: 2 } },
    { dataIndex: 'resultVersionSeq', title: '产物版本', width: 100, align: 'center' },
    { dataIndex: 'createdTime', title: '创建时间', type: 'datetime', width: 160 },
    {
      dataIndex: '__action__',
      title: '操作',
      type: 'action',
      width: 140,
      fixed: 'right',
    },
  ],
  // 行操作由后端 operList 驱动（cancel: QUEUED/RUNNING；retry: FAILED），
  // 前端不做可见性判断（规则 6）；rowActions 留空作为纯 operList 形态。
  rowActions: [],
}
