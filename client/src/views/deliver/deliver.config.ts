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
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center', fixed: 'left' },
    // 业务单据编码链接列（§4.3 exportCode link → 下载 SUCCEEDED）
    { dataIndex: 'exportCode', title: '导出编码', type: 'link', width: 180, fixed: 'left', ellipsis: true },
    { dataIndex: 'deckName', title: '创作物名称', width: 200, ellipsis: true },
    // 派生列：v{seq}（versionSeq 冗余，§4.3）
    { dataIndex: 'versionSeqText', title: '定稿版本', width: 100, align: 'center' },
    // 字典列绑编码字段 + colorTag（§3 tag 渲染；PPTX beta 标经派生 Name 列）
    { dataIndex: 'exportFormat', title: '导出格式', type: 'dict', dictKey: DELIVER_DICT_FORMAT, colorTag: true, width: 110, align: 'center' },
    { dataIndex: 'exportStatus', title: '导出状态', type: 'dict', dictKey: DELIVER_DICT_STATUS, colorTag: true, width: 110, align: 'center' },
    // 派生列：KB/MB 格式化（§4.3 fileSize）
    { dataIndex: 'fileSizeText', title: '文件大小', width: 100, align: 'right' },
    { dataIndex: 'createdTime', title: '创建时间', type: 'datetime', width: 170 },
    { dataIndex: '__action__', title: '操作', type: 'action', width: 160, fixed: 'right' },
  ],
  toolbar: [{ key: 'create', label: '新建导出' }],
  // 过渡兜底（后端行 operList 优先；key 与 operList[].code 对齐 §4.4）。
  // 确认弹窗统一在 index.vue 的行处理内做，不写在 rowActions.confirm，避免
  // 兜底/operList 两条路径出现双重确认（deck 列表同先例）。
  rowActions: [
    { key: 'download', label: '下载' },
    { key: 'cancel', label: '取消', danger: true },
    { key: 'retry', label: '重试' },
  ],
}
