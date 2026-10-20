/**
 * asset 域 action（来源：PageSpec assets.md §2 Action 定义 +
 * api-assets.md §4.4 接口清单 / §5.1 OHS 清单）。
 *
 * - S-01 素材与品牌资产管理：asset/brandkit 两组 CRUD + 启停 + 设默认；
 * - S-02 迭代话术库：prompt CRUD + touch 计数；
 * - 素材文件访问 OHS（POST /asset/asset/file-url）：卡片大图预览经此
 *   签发限时 URL（api-assets.md §5.1，消费方含生成/导出/演示，本页同用）；
 * - 选择池（POST /asset/select/asset-list）：品牌规范表单 logo 选择
 *   modalSelect（PageSpec §5，限 LOGO 类型启用态由服务端 AO 过滤）；
 * - 字典 `asset.dictBatch` 已在 dict.ts 集中注册（§4.7），此处不重复；
 * - 跨域先例（gen.assetSelectList / adjust.promptTouch / adjust.assetFileUrl）
 *   均以调用方前缀注册，与本地 asset.* 键名不冲突。
 */
import { defineModule } from '@/engine/actionExecutor'

export const assetModule = defineModule('asset', {
  // —— 素材（S-01；PageSpec assets.md §2）——
  assetList: { method: 'POST', path: '/asset/asset/list', type: 'list' },
  // multipart 上传：经引擎 postForm 通道发送 FormData（request.ts）
  assetUpload: { method: 'POST', path: '/asset/asset/upload', type: 'upload' },
  assetSave: { method: 'POST', path: '/asset/asset/save', type: 'save' },
  assetDisable: { method: 'POST', path: '/asset/asset/disable', type: 'other' },
  assetEnable: { method: 'POST', path: '/asset/asset/enable', type: 'other' },
  assetDelete: { method: 'POST', path: '/asset/asset/delete', type: 'delete' },
  // OHS：素材文件限时 URL 签发（api-assets.md §5.1）
  assetFileUrl: { method: 'POST', path: '/asset/asset/file-url', type: 'other' },

  // —— 品牌规范（S-01；PageSpec assets.md §2/§5）——
  brandkitList: { method: 'POST', path: '/asset/brandkit/list', type: 'list' },
  brandkitSave: { method: 'POST', path: '/asset/brandkit/save', type: 'save' },
  brandkitDelete: { method: 'POST', path: '/asset/brandkit/delete', type: 'delete' },
  brandkitSetDefault: { method: 'POST', path: '/asset/brandkit/set-default', type: 'other' },

  // —— 话术库（S-02；PageSpec assets.md §2/§6）——
  promptList: { method: 'POST', path: '/asset/prompt/list', type: 'list' },
  promptSave: { method: 'POST', path: '/asset/prompt/save', type: 'save' },
  promptDelete: { method: 'POST', path: '/asset/prompt/delete', type: 'delete' },
  // 使用计数 +1：工作台选用模板提交后调用（PageSpec §6 联动）
  promptTouch: { method: 'POST', path: '/asset/prompt/touch', type: 'other' },

  // —— 选择池（api-assets.md §4.4 /asset/select/asset-list）——
  selectAssetList: { method: 'POST', path: '/asset/select/asset-list', type: 'list' },
})
