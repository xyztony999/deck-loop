/**
 * asset 域错误码 —— 契约来源：api-assets.md §3.4（v1 冻结，禁增删改值）。
 * 三前缀（对应 v1 AssetErrorCodeConstants）：BIZ_ASSET_* / BIZ_BRANDKIT_* / BIZ_PROMPT_*。
 * 用法：throw new BizException(ASSET_IN_USE, ASSET_IN_USE_MSG)。
 */

/* ---------- BIZ_ASSET_*（素材） ---------- */

/** BIZ_ASSET_IN_USE：素材被引用中（refCount>0，INV-18），不可删除 */
export const ASSET_IN_USE = 'BIZ_ASSET_IN_USE';
export const ASSET_IN_USE_MSG = '素材被引用中，不可删除';

/** BIZ_ASSET_TYPE_INVALID：上传类型/大小不符（INV-19：jpg/png/svg/webp、≤10MB） */
export const ASSET_TYPE_INVALID = 'BIZ_ASSET_TYPE_INVALID';
export const ASSET_TYPE_INVALID_MSG = '素材类型或格式不支持';

/* ---------- BIZ_BRANDKIT_*（品牌规范） ---------- */

/** BIZ_BRANDKIT_IS_DEFAULT：默认规范不可删除（先切换默认） */
export const BRANDKIT_IS_DEFAULT = 'BIZ_BRANDKIT_IS_DEFAULT';
export const BRANDKIT_IS_DEFAULT_MSG = '默认品牌规范不可删除';

/** BIZ_BRANDKIT_LOGO_INVALID：Logo 素材无效或未启用（INV-16） */
export const BRANDKIT_LOGO_INVALID = 'BIZ_BRANDKIT_LOGO_INVALID';
export const BRANDKIT_LOGO_INVALID_MSG = '品牌 Logo 素材无效或未启用';

/* ---------- BIZ_PROMPT_*（话术模板） ---------- */

/** BIZ_PROMPT_PLACEHOLDER_SYNTAX：占位符语法错误（{名称}，≤10 处，INV-21） */
export const PROMPT_PLACEHOLDER_SYNTAX = 'BIZ_PROMPT_PLACEHOLDER_SYNTAX';
export const PROMPT_PLACEHOLDER_SYNTAX_MSG = '话术占位符语法错误';
