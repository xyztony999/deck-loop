/**
 * deliver 模块页面 config（PageSpec delivery.md §4 导出记录列表；
 * 引擎 DlListPage config 驱动）。
 *
 * - 查询区/列/操作列全部来自 §4.1/§4.3；行操作可见性由后端行 operList
 *   驱动（§4.4：download=SUCCEEDED / cancel=QUEUED,RENDERING /
 *   retry=FAILED），rowActions 仅为后端未返回 operList 时的过渡兜底
 *   （强制规则 6，前端不做可见性判断）；
 * - deckId（§4.1 modalSelect，deck.select.deckList 选择池）引擎查询字段
 *   无该类型，由 index.vue 页面工具条承载远程搜索选择并写入引擎查询对象
 *   （deck 列表页 archivedScope switch 同先例）；
 * - versionSeqText / fileSizeText / exportFormatName 为呈现层派生列
 *   （index.vue 载入行 VO 后派生：v{seq}、KB/MB、字典 label + PPTX beta 标）；
 * - timeRangeArr 遵循 §4.8：发送前自动拆分为 timeRangeStart/timeRangeEnd
 *   （ListAO timeRange，createdTime between，api-delivery.md §4.4）；
 * - exportCode 链接列点击 → 下载（仅 SUCCEEDED，index.vue link-click 处理）。
 */
import type { DlListPageConfig } from '@/engine'

import { DELIVER_DICT_FORMAT, DELIVER_DICT_STATUS } from './deliver.shared'

export const exportListConfig: DlListPageConfig = {
  title: '导出记录',
  listAction: 'deliver.exportList',
  domain: 'deliver',
  rowKey: 'exportId',
  defaultRowCount: 2,
  // deckId 筛选由页面工具条承载（modalSelect 引擎不支持，见文件头注释）
  queryFields: [
    { field: 'exportFormat', label: '导出格式', type: 'select', dictKey: DELIVER_DICT_FORMAT },
    { field: 'exportStatus', label: '导出状态', type: 'select', dictKey: DELIVER_DICT_STATUS },
    { field: 'timeRangeArr', label: '创建时间', type: 'dateRange' },
  ],
  columns: [
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center' },
    // §4.3：exportCode 文本（EX 编码）；deckName 链接 → /deck/:deckId
    { dataIndex: 'exportCode', title: '导出编码', width: 180, ellipsis: true },
    { dataIndex: 'deckName', title: '创作物名称', type: 'link', width: 200, ellipsis: true },
    { dataIndex: 'versionSeqText', title: '版本', width: 100, align: 'center' },
    { dataIndex: 'exportFormat', title: '导出格式', type: 'dict', dictKey: DELIVER_DICT_FORMAT, colorTag: true, width: 110, align: 'center' },
    { dataIndex: 'exportStatus', title: '导出状态', type: 'dict', dictKey: DELIVER_DICT_STATUS, colorTag: true, width: 110, align: 'center' },
    { dataIndex: 'fileSizeText', title: '文件大小', width: 100, align: 'right' },
    { dataIndex: 'createdTime', title: '创建时间', type: 'datetime', width: 170 },
    { dataIndex: '__action__', title: '操作', type: 'action', width: 120 },
  ],
  // ADR-018：网站无导出发起入口（无 primary 发起按钮）；新导出经 MCP export_deck
  // 过渡兜底仅 download（cancel/retry 网站隐藏，后端 operList 若返回亦在 index.vue 过滤）
  rowActions: [{ key: 'download', label: '下载' }],
}
