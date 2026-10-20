/**
 * gen 模块页面 config（PageSpec generation.md §4 三步向导 + 任务记录）。
 *
 * - 向导 = DlCardPage steps 容器；步骤②大纲编辑与步骤①③的任务卡经
 *   #card-{key} / #field-{field} 插槽以 code 组件实现（页面类型 hybrid）。
 * - beforeNext 钩子依赖页面运行态（任务进度/大纲保存），经工厂注入（DI）。
 * - 任务记录 = DlListPage（operList 驱动 cancel/retry，规则 6）。
 */
import { message } from 'ant-design-vue'

import type { DlCardPageConfig, DlListPageConfig } from '@/engine'
import { registerDictColorMap } from '@/engine'
import { EXTRA_REQUIREMENT_MAX } from './types'

// ---------------------------------------------------------------
// 字典 Tag 颜色（呈现层映射，选项/文案仍全部来自后端字典；
// 色值约定与 adjustment.md §3 task.TaskStatus 一致：
// QUEUED gray / RUNNING blue / SUCCEEDED green / FAILED red / CANCELLED gray）
// ---------------------------------------------------------------

registerDictColorMap('gen', {
  'task.TaskStatus': {
    QUEUED: 'default',
    RUNNING: 'processing',
    SUCCEEDED: 'success',
    FAILED: 'error',
    CANCELLED: 'default',
  },
})

// ---------------------------------------------------------------
// 三步向导（DlCardPage）
// ---------------------------------------------------------------

/** 向导步骤流转依赖的页面运行态（工厂注入，避免 config 反向依赖页面） */
export interface GenWizardDeps {
  /** 步骤①→② 门槛：大纲已生成（draftOutline 就绪） */
  isOutlineReady: () => boolean
  /** 步骤②→③ 前置：校验并落盘大纲编辑（含 flush 自动保存）；false 阻止 */
  flushOutline: () => Promise<boolean>
}

export function buildGenWizardConfig(deps: GenWizardDeps): DlCardPageConfig {
  return {
    title: '生成向导',
    domain: 'gen',
    // deck 详情（draftOutline/状态/默认规范）经 loadAction 自动加载（F-18）
    loadAction: 'gen.deckDetail',
    detailIdKey: 'deckId',
    steps: [
      {
        key: 'requirement',
        title: '需求补充与引用',
        description: '补充要求，引用素材与品牌规范',
        cards: [
          {
            key: 'deckBrief',
            title: '创作物信息',
            type: 'detail',
            fields: [
              { field: 'deckName', label: '名称' },
              { field: 'topic', label: '主题' },
              { field: 'requirement', label: '需求描述' },
              { field: 'brandKitName', label: '默认品牌规范' },
            ],
          },
          {
            key: 'reqForm',
            title: '需求补充与引用',
            type: 'form',
            fields: [
              {
                field: 'extraRequirement',
                label: '补充要求',
                type: 'textarea',
                span: 'full',
                placeholder: `补充生成要求（≤${EXTRA_REQUIREMENT_MAX} 字，可空）`,
                props: { maxlength: EXTRA_REQUIREMENT_MAX, showCount: true, rows: 3 },
              },
              // 素材多选（≤10）与品牌规范单选经 #field-* 插槽（服务端搜索选择池）
              { field: 'assetIds', label: '引用素材', span: 'full' },
              { field: 'brandKitId', label: '品牌规范', span: 1 },
            ],
          },
          {
            // [生成大纲] + 任务进度条（插槽渲染）
            key: 'outlineTask',
            title: '大纲生成',
            type: 'flow',
          },
        ],
        // 流转规则：大纲未生成禁止进入步骤②
        beforeNext: () => {
          if (!deps.isOutlineReady()) {
            message.warning('请先生成大纲并等待完成')
            return false
          }
          return true
        },
      },
      {
        key: 'outline',
        title: '大纲确认与编辑',
        description: '节点 1~50，标题 ≤50 字；2 秒自动保存',
        cards: [
          {
            key: 'outlineEditor',
            title: '大纲编辑',
            type: 'flow',
          },
        ],
        // 流转规则：无 draftOutline 禁止下一步 + flush 编辑并校验落盘
        beforeNext: async () => deps.flushOutline(),
      },
      {
        key: 'fullgen',
        title: '整稿生成',
        description: '确认篇幅与汇总后发起',
        cards: [
          {
            key: 'fullOptions',
            title: '生成选项',
            type: 'form',
            fields: [
              // SHORT/MEDIUM/LONG 契约枚举（非字典，见 types.ts LENGTH_OPTIONS）
              { field: 'lengthOption', label: '篇幅', span: 'full' },
            ],
          },
          {
            key: 'fullSummary',
            title: '汇总预览',
            type: 'detail',
            fields: [
              { field: 'outlineNodeCount', label: '大纲节点数' },
              { field: 'assetCount', label: '引用素材数' },
              // 注意与 deckBrief.brandKitName（deck 默认规范）区分：此处为当前选择
              { field: 'selectedBrandKitName', label: '品牌规范' },
            ],
          },
          {
            // [发起整稿生成] + 任务卡（进度/取消/失败重试）
            key: 'fullTask',
            title: '整稿任务',
            type: 'flow',
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------
// 任务记录（DlListPage，任务跟踪 · 历史任务列表）
// ---------------------------------------------------------------

export const genTaskListConfig: DlListPageConfig = {
  listAction: 'gen.taskList',
  domain: 'gen',
  rowKey: 'taskId',
  queryFields: [
    { field: 'taskType', label: '任务类型', type: 'select', dictKey: 'task.TaskType' },
    { field: 'taskStatus', label: '任务状态', type: 'select', dictKey: 'task.TaskStatus' },
  ],
  columns: [
    // 序号列 dataIndex 固定 '__seq__'（DlListPage bodyCell 约定，同 __action__）
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center' },
    { dataIndex: 'taskCode', title: '任务编码', width: 150, ellipsis: true },
    {
      dataIndex: 'taskType',
      title: '任务类型',
      type: 'dict',
      dictKey: 'task.TaskType',
      width: 100,
      align: 'center',
    },
    {
      dataIndex: 'taskStatus',
      title: '任务状态',
      type: 'dict',
      dictKey: 'task.TaskStatus',
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
