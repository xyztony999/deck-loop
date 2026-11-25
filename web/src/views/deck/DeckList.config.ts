/**
 * 创作物列表页配置（PageSpec deck.md §4；引擎 DlListPage config 驱动）。
 *
 * - 查询区/列/操作列全部来自 §4.1/§4.3；行操作可见性由后端行 operList 驱动
 *   （§4.4），rowActions 仅为后端未返回 operList 时的过渡兜底（强制规则 6）。
 * - archivedScope（§4.1 switch，开=查看归档区）由 index.vue 页面工具条承载
 *   （引擎查询字段类型无 switch），切换时写入引擎查询对象。
 * - currentVersionText / versionAdjustText 为呈现层派生列（index.vue 载入
 *   行 VO 后派生：当前版本 v{seq}、版本数/调整次数）。
 * - timeRangeArr 遵循 §4.8：发送前自动拆分为 timeRangeStart/timeRangeEnd
 *   （ListAO timeRange，createdTime between，api-deck.md §4.4）。
 */
import type { DlListPageConfig } from '@/engine'

import { DECK_DICT_STATUS, DECK_DICT_TYPE } from './deck.shared'

export const deckListConfig: DlListPageConfig = {
  title: '创作物',
  listAction: 'deck.deckList',
  domain: 'deck',
  rowKey: 'deckId',
  viewMode: 'both',
  defaultRowCount: 2,
  queryFields: [
    { field: 'keyword', label: '名称', type: 'input', placeholder: '请输入创作物名称' },
    { field: 'deckType', label: '类型', type: 'select', dictKey: DECK_DICT_TYPE },
    { field: 'deckStatus', label: '状态', type: 'select', dictKey: DECK_DICT_STATUS },
    { field: 'timeRangeArr', label: '创建时间', type: 'dateRange' },
  ],
  columns: [
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center', fixed: 'left' },
    // 名称链接列（§4.3 deckName link → 详情 /deck/:deckId）
    { dataIndex: 'deckName', title: '名称', type: 'link', width: 200, fixed: 'left', ellipsis: true },
    // 字典列绑编码字段；colorTag 无注册色时渲染默认 Tag（§3 deckType 渲染 = tag）
    { dataIndex: 'deckType', title: '类型', type: 'dict', dictKey: DECK_DICT_TYPE, colorTag: true, width: 120, align: 'center' },
    { dataIndex: 'topic', title: '主题', width: 240, ellipsis: { rows: 2 } },
    { dataIndex: 'deckStatus', title: '状态', type: 'dict', dictKey: DECK_DICT_STATUS, colorTag: true, width: 110, align: 'center' },
    { dataIndex: 'currentVersionText', title: '当前版本', width: 100, align: 'center' },
    { dataIndex: 'versionAdjustText', title: '版本/调整', width: 120, align: 'center' },
    { dataIndex: 'updatedTime', title: '更新时间', type: 'datetime', width: 170 },
    { dataIndex: '__action__', title: '操作', type: 'action', width: 180, fixed: 'right' },
  ],
  toolbar: [{ key: 'create', label: '新建创作物' }],
  // 过渡兜底（后端行 operList 优先；key 与 operList[].code 对齐 §4.4）。
  // 确认弹窗统一在 index.vue 的行处理内做，不写在 rowActions.confirm，避免
  // 兜底/operList 两条路径出现双重确认。
  rowActions: [
    { key: 'edit', label: '编辑' },
    { key: 'finalize', label: '定稿' },
    { key: 'unfinalize', label: '解锁' },
    { key: 'archive', label: '归档' },
    { key: 'restore', label: '恢复' },
    { key: 'delete', label: '删除', danger: true },
  ],
  rowSelection: true,
}
