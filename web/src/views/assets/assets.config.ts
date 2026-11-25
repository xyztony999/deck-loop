/**
 * 资产中心三 Tab 列表配置（PageSpec assets.md §4/§5/§6；DlListPage
 * config 驱动）。
 *
 * - 素材 Tab 为网格卡片视图（viewMode 'card'，#card 插槽渲染；columns
 *   保留 §4.3 列语义映射，供卡片字段与视图切换兜底）；
 * - 行操作可见性由后端行 operList 驱动（§4.4/§5/§6），rowActions 仅为
 *   后端未返回 operList 时的过渡兜底；确认弹窗统一在各 Tab 的行处理内做
 *   （deck 先例：避免兜底/operList 双重确认）；
 * - 品牌规范/话术 Tab 的呈现列（colorsText/fontsText/logoText/
 *   isDefaultText）为呈现层派生字段，由各 Tab 载入行 VO 后填充
 *   （deck 先例 currentVersionText）。
 */
import type { DlListPageConfig } from '@/engine'

import {
  ASSET_DICT_SCENE,
  ASSET_DICT_STATUS,
  ASSET_DICT_TYPE,
} from './assets.shared'

/** Tab1 素材库（PageSpec assets.md §4） */
export const assetListConfig: DlListPageConfig = {
  title: '素材库',
  listAction: 'asset.assetList',
  domain: 'asset',
  rowKey: 'assetId',
  viewMode: 'card',
  defaultRowCount: 2,
  queryFields: [
    { field: 'keyword', label: '名称', type: 'input', placeholder: '请输入素材名称' },
    { field: 'category', label: '分类', type: 'input', placeholder: '请输入分类（精确匹配）' },
    { field: 'assetType', label: '类型', type: 'select', dictKey: ASSET_DICT_TYPE },
    { field: 'assetStatus', label: '状态', type: 'select', dictKey: ASSET_DICT_STATUS },
  ],
  columns: [
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center', fixed: 'left' },
    { dataIndex: 'assetName', title: '素材名称', type: 'link', width: 200, fixed: 'left', ellipsis: true },
    { dataIndex: 'category', title: '分类', width: 120, ellipsis: true },
    { dataIndex: 'assetType', title: '类型', type: 'dict', dictKey: ASSET_DICT_TYPE, colorTag: true, width: 100, align: 'center' },
    { dataIndex: 'assetStatus', title: '状态', type: 'dict', dictKey: ASSET_DICT_STATUS, colorTag: true, width: 100, align: 'center' },
    { dataIndex: 'refCount', title: '引用', width: 80, align: 'center' },
    { dataIndex: 'fileSize', title: '文件大小', width: 100, align: 'right' },
    { dataIndex: 'updatedTime', title: '更新时间', type: 'datetime', width: 170 },
    { dataIndex: '__action__', title: '操作', type: 'action', width: 180, fixed: 'right' },
  ],
  toolbar: [
    { key: 'upload', label: '上传素材' },
    { key: 'batchDisable', label: '批量停用' },
  ],
  // 过渡兜底（卡片视图实际由 AssetTab.cardOpers 派生，见 shared 注释）
  rowActions: [
    { key: 'edit', label: '编辑' },
    { key: 'disable', label: '停用' },
    { key: 'enable', label: '启用' },
    { key: 'delete', label: '删除', danger: true },
  ],
}

/** Tab2 品牌规范（PageSpec assets.md §5；标准表格） */
export const brandkitListConfig: DlListPageConfig = {
  title: '品牌规范',
  listAction: 'asset.brandkitList',
  domain: 'asset',
  rowKey: 'brandKitId',
  columns: [
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center', fixed: 'left' },
    { dataIndex: 'kitName', title: '规范名称', type: 'link', width: 200, fixed: 'left', ellipsis: true },
    // 色板/字体/logo/默认 为呈现层派生文本列（载入后填充，见文件头注释）
    { dataIndex: 'colorsText', title: '色板（主色/辅色）', width: 170, ellipsis: true },
    { dataIndex: 'fontsText', title: '字体（标题/正文）', width: 170, ellipsis: true },
    { dataIndex: 'logoText', title: 'Logo', width: 150, ellipsis: true },
    { dataIndex: 'isDefaultText', title: '默认', width: 80, align: 'center' },
    { dataIndex: 'updatedTime', title: '更新时间', type: 'datetime', width: 170 },
    { dataIndex: '__action__', title: '操作', type: 'action', width: 160, fixed: 'right' },
  ],
  toolbar: [{ key: 'create', label: '新建规范' }],
  // 过渡兜底（后端行 operList 优先；set_default/delete 守卫在行处理内）
  rowActions: [
    { key: 'edit', label: '编辑' },
    { key: 'set_default', label: '设为默认' },
    { key: 'delete', label: '删除', danger: true },
  ],
}

/** Tab3 话术库（PageSpec assets.md §6；标准表格） */
export const promptListConfig: DlListPageConfig = {
  title: '话术库',
  listAction: 'asset.promptList',
  domain: 'asset',
  rowKey: 'templateId',
  columns: [
    { dataIndex: '__seq__', title: '序号', type: 'seq', width: 60, align: 'center', fixed: 'left' },
    { dataIndex: 'title', title: '话术标题', type: 'link', width: 180, fixed: 'left', ellipsis: true },
    { dataIndex: 'content', title: '话术内容', width: 320, ellipsis: { rows: 2 } },
    { dataIndex: 'category', title: '分类', width: 110, ellipsis: true },
    { dataIndex: 'templateScene', title: '适用场景', type: 'dict', dictKey: ASSET_DICT_SCENE, colorTag: true, width: 110, align: 'center' },
    { dataIndex: 'useCount', title: '使用次数', width: 100, align: 'center' },
    { dataIndex: 'updatedTime', title: '更新时间', type: 'datetime', width: 170 },
    { dataIndex: '__action__', title: '操作', type: 'action', width: 120, fixed: 'right' },
  ],
  toolbar: [{ key: 'create', label: '新建话术' }],
  // 过渡兜底（后端行 operList 优先；delete 二次确认在行处理内）
  rowActions: [
    { key: 'edit', label: '编辑' },
    { key: 'delete', label: '删除', danger: true },
  ],
}
