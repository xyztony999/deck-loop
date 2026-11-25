/**
 * 新建/编辑创作物向导配置（PageSpec deck.md §5 两步向导；引擎 DlCardPage steps）。
 *
 * 步骤（严格按 §5，ADR-018）：①基本信息（deckName✅≤100 / deckType（DECK 可选，
 * DOC/POSTER 置灰「即将支持」，new.vue 字段插槽承载）/ topic✅≤200 /
 * requirement textarea）→ ②品牌规范（asset.select.brandkitList 选择池，可跳过）。
 * 保存成功 → 详情工作台（生成在 agent 侧，去创建确认步与生成跳转）。
 *
 * 编辑态：/deck/new?deckId=xxx，loadAction=deck.deckDetail 回填
 * （detailIdKey 非 id，显式声明）；提交统一 deck.deckSave（deckId 空=新建）。
 */
import type { DlCardPageConfig } from '@/engine'

import { DECK_DICT_TYPE } from './deck.shared'

export const deckWizardConfig: DlCardPageConfig = {
  title: '新建创作物',
  domain: 'deck',
  loadAction: 'deck.deckDetail',
  detailIdKey: 'deckId',
  submitAction: 'deck.deckSave',
  steps: [
    {
      key: 'basic',
      title: '基本信息',
      description: '命名创作物并录入主题需求',
      cards: [
        {
          key: 'basicForm',
          title: '基本信息',
          type: 'form',
          fields: [
            {
              field: 'deckName',
              label: '名称',
              type: 'input',
              required: true,
              placeholder: '请输入创作物名称（≤100 字）',
              span: 2,
              props: { maxlength: 100, showCount: true },
            },
            {
              field: 'deckType',
              label: '类型',
              type: 'radio',
              dictKey: DECK_DICT_TYPE,
              required: true,
            },
            {
              field: 'topic',
              label: '主题',
              type: 'input',
              required: true,
              placeholder: '请输入主题（≤200 字）',
              span: 2,
              props: { maxlength: 200, showCount: true },
            },
            {
              field: 'requirement',
              label: '需求描述',
              type: 'textarea',
              placeholder: '补充风格、受众、结构等要求（可选）',
            },
          ],
        },
      ],
    },
    {
      key: 'brandkit',
      title: '品牌规范',
      description: '选择默认品牌规范，可跳过',
      cards: [
        {
          key: 'brandkitForm',
          title: '品牌规范',
          type: 'form',
          fields: [
            {
              field: 'defaultBrandKitId',
              label: '默认品牌规范',
              type: 'select',
              placeholder: '请选择品牌规范（可跳过）',
            },
          ],
        },
      ],
    },
  ],
}
