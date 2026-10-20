/**
 * deck-loop 前端引擎层出口（Scm* framework 的轻量等价）。
 *
 * F2-F4 页面生成统一从 '@/engine' 导入，禁止直接 import ant-design-vue
 * 组件（图标 / message / Modal.confirm 例外，见 frontend-specs 01 §1.4）。
 */
export * from './types'
export * from './pageSchemas'
export {
  setAuthBridge,
  post,
  postForm,
  get,
  rawAxios,
  CODE_SESSION_EXPIRED,
  type AuthBridge,
} from './request'
export {
  defineModule,
  registerModule,
  registerAction,
  hasAction,
  getAction,
  listActionKeys,
  executeAction,
  actionExecutor,
  getActionExecutor,
  type ActionModule,
  type ActionDefInput,
  type ActionRegistry,
} from './actionExecutor'
export {
  dictBatch,
  useDict,
  clearDictCache,
  registerDictColorMap,
  getDictColor,
  toSelectOptions,
  computedOptions,
  type UseDictReturn,
} from './dict'
export {
  useListPage,
  splitRangeFields,
  DEFAULT_PAGE_NUM,
  DEFAULT_PAGE_SIZE,
  type PageQuery,
  type PageResult,
  type UseListPageOptions,
  type UseListPageReturn,
} from './pagination'
export {
  formatAmount,
  formatUnitPrice,
  formatDatetime,
  displayValue,
} from './format'

export { default as DlListPage } from './components/DlListPage.vue'
export { default as DlCardPage } from './components/DlCardPage.vue'
export { default as DlDetailPage } from './components/DlDetailPage.vue'
