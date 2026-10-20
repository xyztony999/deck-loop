/**
 * 创作物详情页区块配置（PageSpec deck.md §6；引擎 DlDetailPage）。
 *
 * - currentVersionText / statsVersionCount / statsAdjustCount /
 *   latestTaskText 为 detail.vue 载入 DetailVO 后的呈现层扁平字段
 *   （stats/latestTask 为嵌套对象，DlDetailField 只支持平铺 field）
 * - latestTaskText 经 #field-latestTaskText 插槽渲染状态 tag
 *   （gen 域 task.TaskStatus 字典）
 * - 「操作日志」区块（§6：操作人/动作/时间，数据源=平台日志接口）：
 *   TODO 请确认 —— 平台日志 action 未在 api-deck.md / PageSpec 中定义
 *   key 与 URL，按强制规则 2 不编造，待接口明确后补第三区块
 */
import type { DlDetailPageConfig } from '@/engine'

import { DECK_DICT_STATUS, DECK_DICT_TYPE } from './deck.shared'

export const deckDetailConfig: DlDetailPageConfig = {
  title: '创作物详情',
  blocks: [
    {
      key: 'basic',
      title: '基本信息',
      fields: [
        { field: 'deckName', label: '名称' },
        { field: 'deckType', label: '类型', type: 'dict', dictKey: DECK_DICT_TYPE },
        { field: 'deckStatus', label: '状态', type: 'dict', dictKey: DECK_DICT_STATUS },
        { field: 'topic', label: '主题' },
        { field: 'requirement', label: '需求描述' },
        { field: 'brandKitName', label: '默认品牌规范' },
        { field: 'createdTime', label: '创建时间', type: 'datetime' },
      ],
    },
    {
      key: 'iteration',
      title: '迭代状态',
      fields: [
        { field: 'currentVersionText', label: '当前版本' },
        { field: 'activeBranch', label: '活动分支' },
        { field: 'statsVersionCount', label: '版本数' },
        { field: 'statsAdjustCount', label: '调整次数' },
        { field: 'latestTaskText', label: '最近任务' },
      ],
    },
  ],
}
