/**
 * asset 域 DTO —— v1 ao/asset + vo/asset 契约逐字平移（api-assets.md §4.4，冻结禁改）。
 *
 * - AO：class-validator 注解（v1 Jakarta 注解语义对齐；id 入参按 NR-04 增补
 *   [A-Za-z0-9_-]{1,32} 格式校验，枚举入参 @IsIn 值域校验）
 * - VO：_id 不进 VO（NR-08）；枚举 label 由 Service 组装（getXxxLabel）
 * - 上传 AO 的 file 字段经 multipart part 传递（@UploadedFile 装饰器注入），
 *   本类仅承载表单字段（assetName/category/assetType），wire 契约与 v1 一致
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AssetStatus, AssetType, TemplateScene } from '../common/enums';
import { OperItem, PageQuery, SelectOption } from '../common/result';
import { ID_PATTERN, ID_PATTERN_MESSAGE } from './asset.constant';

/* ===================================================================== */
/* 通用入参（v1 PageQuery 对齐：默认 pageNum=1/pageSize=20） */
/* ===================================================================== */

/** id 格式注解简写（NR-04） */
const IdFormat = (): PropertyDecorator =>
  Matches(ID_PATTERN, { message: ID_PATTERN_MESSAGE });

/* ===================================================================== */
/* Asset AO（素材） */
/* ===================================================================== */

export class AssetListAO extends PageQuery {
  /** 分页（AO 键→查询键映射见 AssetRepository.findPage 白名单） */
  @IsOptional()
  @IsInt()
  @Min(1)
  override pageNum: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  override pageSize: number = 20;

  /** 关键词（assetName like，≤128） */
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '关键词不能超过128个字符' })
  keyword?: string;

  /** 分类（eq，≤64） */
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '分类不能超过64个字符' })
  category?: string;

  /** 素材类型（eq，值域 IMAGE/LOGO） */
  @IsOptional()
  @IsIn([AssetType.IMAGE, AssetType.LOGO], { message: '素材类型必须为 IMAGE/LOGO' })
  assetType?: string;

  /** 素材状态（eq，值域 ACTIVE/DISABLED） */
  @IsOptional()
  @IsIn([AssetStatus.ACTIVE, AssetStatus.DISABLED], {
    message: '素材状态必须为 ACTIVE/DISABLED',
  })
  assetStatus?: string;
}

/**
 * 素材上传 AO（multipart 表单字段；file 部件经 @UploadedFile 注入，
 * 大小/类型 INV-19 前置校验在 Service——FileInterceptor limits 双重拦截）。
 */
export class AssetUploadAO {
  /** 素材名称（≤128，缺省取文件名） */
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '素材名称不能超过128个字符' })
  assetName?: string;

  /** 分类（≤64） */
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '分类不能超过64个字符' })
  category?: string;

  /** 素材类型（值域 IMAGE/LOGO，缺省 IMAGE） */
  @IsOptional()
  @IsIn([AssetType.IMAGE, AssetType.LOGO], { message: '素材类型必须为 IMAGE/LOGO' })
  assetType?: string;
}

export class AssetSaveAO {
  @IsNotEmpty({ message: '素材ID不能为空' })
  @IdFormat()
  assetId!: string;

  @IsNotEmpty({ message: '素材名称不能为空' })
  @IsString()
  @MaxLength(128, { message: '素材名称不能超过128个字符' })
  assetName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '分类不能超过64个字符' })
  category?: string;
}

export class AssetIdAO {
  @IsNotEmpty({ message: '素材ID不能为空' })
  @IdFormat()
  assetId!: string;
}

export class AssetFileUrlAO {
  @IsArray()
  @ArrayNotEmpty({ message: '素材ID列表不能为空' })
  @ArrayMaxSize(50, { message: '单次最多签发50个素材文件URL' })
  @Matches(ID_PATTERN, { each: true, message: ID_PATTERN_MESSAGE })
  assetIds!: string[];
}

export class AssetSelectListAO {
  @IsOptional()
  @IsIn([AssetType.IMAGE, AssetType.LOGO], { message: '素材类型必须为 IMAGE/LOGO' })
  assetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '关键词不能超过128个字符' })
  keyword?: string;
}

/* ===================================================================== */
/* BrandKit AO（品牌规范） */
/* ===================================================================== */

export class BrandKitColorsAO {
  @IsNotEmpty({ message: '主色不能为空' })
  @IsString()
  @MaxLength(32, { message: '主色不能超过32个字符' })
  primary!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16, { message: '辅色最多16个' })
  @IsString({ each: true })
  @MaxLength(32, { each: true, message: '辅色值不能超过32个字符' })
  assistants?: string[];
}

export class BrandKitFontsAO {
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '标题字体不能超过64个字符' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '正文字体不能超过64个字符' })
  body?: string;
}

export class BrandKitSaveAO {
  /** brandKitId 空=新建 */
  @IsOptional()
  @IdFormat()
  brandKitId?: string;

  @IsNotEmpty({ message: '规范名称不能为空' })
  @IsString()
  @MaxLength(50, { message: '规范名称不能超过50个字符' })
  kitName!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => BrandKitColorsAO)
  colors!: BrandKitColorsAO;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BrandKitFontsAO)
  fonts?: BrandKitFontsAO | null;

  /** logo 素材引用（启用态校验 INV-16） */
  @IsOptional()
  @IdFormat()
  logoAssetId?: string | null;
}

export class BrandKitIdAO {
  @IsNotEmpty({ message: '品牌规范ID不能为空' })
  @IdFormat()
  brandKitId!: string;
}

export class BrandKitListAO extends PageQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  override pageNum: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  override pageSize: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '关键词不能超过50个字符' })
  keyword?: string;
}

export class BrandKitProviderGetAO {
  @IsNotEmpty({ message: '品牌规范ID不能为空' })
  @IdFormat()
  brandKitId!: string;

  /**
   * v1 OHS 跨域调用显式属主字段（契约冻结保留）；HTTP 端点强制会话属主
   * （api-assets §3.3「全部查询强制 user_id」+ NR-05），本字段仅进程内
   * AssetDomainService.getBrandKit(brandKitId, userId) 显式传参路径使用。
   */
  @IsOptional()
  @IdFormat()
  userId?: string;
}

export class BrandKitSelectListAO {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '关键词不能超过50个字符' })
  keyword?: string;
}

/* ===================================================================== */
/* PromptTemplate AO（话术模板） */
/* ===================================================================== */

export class PromptTemplateListAO extends PageQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  override pageNum: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  override pageSize: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '关键词不能超过128个字符' })
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '分类不能超过64个字符' })
  category?: string;

  @IsOptional()
  @IsIn([TemplateScene.WHOLE, TemplateScene.TARGETED], {
    message: '话术场景必须为 WHOLE/TARGETED',
  })
  templateScene?: string;
}

export class PromptTemplateSaveAO {
  /** templateId 空=新建 */
  @IsOptional()
  @IdFormat()
  templateId?: string;

  @IsNotEmpty({ message: '话术标题不能为空' })
  @IsString()
  @MaxLength(50, { message: '话术标题不能超过50个字符' })
  title!: string;

  /** 话术正文（含 {占位符}；INV-21 校验在 Service） */
  @IsNotEmpty({ message: '话术正文不能为空' })
  @IsString()
  @MaxLength(2000, { message: '话术正文不能超过2000个字符' })
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '分类不能超过64个字符' })
  category?: string;

  @IsNotEmpty({ message: '话术场景不能为空' })
  @IsIn([TemplateScene.WHOLE, TemplateScene.TARGETED], {
    message: '话术场景必须为 WHOLE/TARGETED',
  })
  templateScene!: string;
}

export class PromptTemplateIdAO {
  @IsNotEmpty({ message: '话术模板ID不能为空' })
  @IdFormat()
  templateId!: string;
}

export class PromptTemplateSelectListAO {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '关键词不能超过50个字符' })
  keyword?: string;

  @IsOptional()
  @IsIn([TemplateScene.WHOLE, TemplateScene.TARGETED], {
    message: '话术场景必须为 WHOLE/TARGETED',
  })
  templateScene?: string;
}

/* ===================================================================== */
/* 字典 AO */
/* ===================================================================== */

export class AssetDictBatchAO {
  @IsArray()
  @ArrayNotEmpty({ message: '字典key列表不能为空' })
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  keys!: string[];
}

/* ===================================================================== */
/* Asset VO（素材，v1 vo/asset 平移；_id 不进 VO） */
/* ===================================================================== */

export class AssetListVO {
  assetId!: string;
  assetName!: string;
  /** 限时签名缩略图 URL（Service 组装） */
  thumbnailUrl!: string | null;
  category!: string | null;
  assetType!: string;
  assetTypeLabel!: string;
  assetStatus!: string;
  assetStatusLabel!: string;
  refCount!: number;
  fileSize!: number;
  updatedTime!: Date | null;
  createdBy!: string | null;
  operList!: OperItem[];
}

export class AssetUploadVO {
  assetId!: string;
  /** 限时访问 URL（上传即时返回） */
  assetUrl!: string;
  thumbnailUrl!: string;
  width!: number | null;
  height!: number | null;
  fileHash!: string;
  /** hash 命中复用既有素材时 true（INV-20，不新建） */
  duplicated!: boolean;
}

export class AssetSaveVO {
  assetId!: string;
}

export class AssetFileUrlVO {
  assetId!: string;
  /** 限时签名 URL；素材不存在/已删除时 null */
  fileUrl!: string | null;
  /** 有效期（秒） */
  expiresIn!: number;
}

export class AssetSelectVO extends SelectOption {
  assetType!: string;
  assetTypeLabel!: string;
  thumbnailUrl!: string | null;

  constructor(value: string, label: string) {
    super(value, label);
  }
}

/* ===================================================================== */
/* BrandKit VO（品牌规范） */
/* ===================================================================== */

export class BrandKitColorsVO {
  primary!: string;
  assistants!: string[];
}

export class BrandKitFontsVO {
  title!: string | null;
  body!: string | null;
}

export class BrandKitListVO {
  brandKitId!: string;
  kitName!: string;
  colors!: BrandKitColorsVO | null;
  fonts!: BrandKitFontsVO | null;
  logoAssetId!: string | null;
  /** 1-是 / 0-否（YesNo INT(1) 语义，前端按布尔渲染） */
  isDefault!: number;
  updatedTime!: Date | null;
  createdBy!: string | null;
  operList!: OperItem[];
}

export class BrandKitSaveVO {
  brandKitId!: string;
}

export class BrandKitSelectVO extends SelectOption {
  isDefault!: number;

  constructor(value: string, label: string) {
    super(value, label);
  }
}

export class BrandKitProviderGetVO {
  brandKitId!: string;
  kitName!: string;
  colors!: BrandKitColorsVO | null;
  fonts!: BrandKitFontsVO | null;
  logoAssetId!: string | null;
  /** logo 限时 URL；logo 已停用/删除时不签发（INV-16 读侧弱化） */
  logoUrl!: string | null;
  isDefault!: number;
}

/* ===================================================================== */
/* PromptTemplate VO（话术模板） */
/* ===================================================================== */

export class PromptTemplateListVO {
  templateId!: string;
  title!: string;
  content!: string;
  category!: string | null;
  templateScene!: string;
  templateSceneLabel!: string;
  useCount!: number;
  updatedTime!: Date | null;
  createdBy!: string | null;
  operList!: OperItem[];
}

export class PromptTemplateSaveVO {
  templateId!: string;
}

export class PromptTemplateSelectVO extends SelectOption {
  templateScene!: string;
  templateSceneLabel!: string;
  useCount!: number;

  constructor(value: string, label: string) {
    super(value, label);
  }
}

/* ===================================================================== */
/* OHS 跨域返回（manifest §10：signFileUrls { assetId, url, expiresAt }[]） */
/* ===================================================================== */

export class SignedFileUrl {
  assetId!: string;
  url!: string;
  /** 过期时刻（epoch 毫秒） */
  expiresAt!: number;
}
