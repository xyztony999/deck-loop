/**
 * asset 域常量 —— 契约来源：api-assets.md §4.4/§4.5 + Java v1 AssetMqConstants/AssetServiceImpl
 * （businessType 与 op 值冻结，禁私改；06-node-api-conventions §5 进程内事件）。
 */

/* ---------- 领域事件（businessType = asset_{resource}_changed，载荷 {resource}Id/op） ---------- */

/** 素材变更（v1 AssetMqConstants.ASSET_ASSET_CHANGED） */
export const ASSET_ASSET_CHANGED = 'asset_asset_changed';

/** 品牌规范变更（v1 AssetMqConstants.ASSET_BRANDKIT_CHANGED） */
export const ASSET_BRANDKIT_CHANGED = 'asset_brandkit_changed';

/** 话术模板变更（v1 AssetMqConstants.ASSET_PROMPT_CHANGED） */
export const ASSET_PROMPT_CHANGED = 'asset_prompt_changed';

/* ---------- 事件 op（v1 AssetMqConstants.OP_*） ---------- */

export const OP_CREATED = 'created';
export const OP_UPDATED = 'updated';
export const OP_DELETED = 'deleted';
export const OP_DISABLED = 'disabled';
export const OP_ENABLED = 'enabled';
export const OP_TOUCHED = 'touched';

/* ---------- 上传约束（INV-19，v1 AssetServiceImpl 对齐） ---------- */

/** 允许的扩展名（jpg/jpeg/png/svg/webp，jpeg 宽容同 jpg） */
export const ASSET_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'svg',
  'webp',
]);

/** 单文件上限：10MB（INV-19；FileInterceptor limits.fileSize 与 service 双重校验） */
export const ASSET_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/* ---------- 话术占位符约束（INV-21，v1 PLACEHOLDER_PATTERN 对齐） ---------- */

/** 合法占位符：{非空、不含花括号与空白、≤64 字符的名称} */
export const PROMPT_PLACEHOLDER_PATTERN = /\{[^{}\s]{1,64}}/g;

/** 占位符数量上限（INV-21） */
export const PROMPT_MAX_PLACEHOLDER_COUNT = 10;

/* ---------- Select 选择池单页上限（选择器场景，非分页列表） ---------- */

export const ASSET_SELECT_LIMIT = 200;

/* ---------- 字典 key（v1 AssetDictRegistry，驼峰字段名规则） ---------- */

export const DICT_KEY_ASSET_TYPE = 'assetType';
export const DICT_KEY_ASSET_STATUS = 'assetStatus';
export const DICT_KEY_TEMPLATE_SCENE = 'templateScene';

/* ---------- 业务 id 格式（NR-04：id 入参长度≤32、[A-Za-z0-9_-]） ---------- */

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
export const ID_PATTERN_MESSAGE = 'ID格式不正确（≤32位字母/数字/下划线/中划线）';

/* ---------- 存储/签名 env（默认值对齐 v1 AssetStorageProperties） ---------- */

/** 本地存储根目录（内容寻址文件落盘位置） */
export const ENV_ASSET_STORAGE_DIR = 'ASSET_STORAGE_DIR';
export const DEFAULT_ASSET_STORAGE_DIR = './data/assets';

/** 限时 URL 公共前缀（生产指向对象存储/CDN；本地默认指向服务自身静态路径） */
export const ENV_ASSET_URL_PUBLIC_BASE_URL = 'ASSET_URL_PUBLIC_BASE_URL';
export const DEFAULT_ASSET_URL_PUBLIC_BASE_URL = 'http://localhost:8080/files';

/** HMAC 签名密钥（生产环境必须覆盖；NR-06：仅 env，禁入库/禁进 VO/禁日志） */
export const ENV_ASSET_URL_SECRET = 'ASSET_URL_SECRET';
export const DEFAULT_ASSET_URL_SECRET = 'deck-loop-asset-dev-sign-key';

/** 签发 URL 有效期（秒） */
export const ENV_ASSET_URL_TTL_SECONDS = 'ASSET_URL_TTL_SECONDS';
export const DEFAULT_ASSET_URL_TTL_SECONDS = 1800;
