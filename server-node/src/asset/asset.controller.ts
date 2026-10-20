/**
 * asset 域接口层 —— 20 端点逐字对齐 api-assets.md §4.4 / domain-manifest §6
 * （v1 controller/asset 五控制器平移；路径/方法/AO/VO 契约冻结）。
 *
 * - 全部 POST + 会话属主（@CurrentUser 注入 userId，NR-05；无 @Public 端点，§0）
 * - Controller 零业务逻辑（NR-10）；Result 统一包装
 * - 上传端点：FileInterceptor('file') + Multer limits.fileSize=10MB（INV-19 第一道
 *   拦截），类型/大小语义校验在 Service（第二道）
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ASSET_MAX_FILE_SIZE_BYTES } from './asset.constant';
import {
  AssetDictBatchAO,
  AssetFileUrlAO,
  AssetFileUrlVO,
  AssetIdAO,
  AssetListAO,
  AssetListVO,
  AssetSaveAO,
  AssetSaveVO,
  AssetSelectListAO,
  AssetSelectVO,
  AssetUploadAO,
  AssetUploadVO,
  BrandKitIdAO,
  BrandKitListAO,
  BrandKitListVO,
  BrandKitProviderGetAO,
  BrandKitProviderGetVO,
  BrandKitSaveAO,
  BrandKitSaveVO,
  BrandKitSelectListAO,
  BrandKitSelectVO,
  PromptTemplateIdAO,
  PromptTemplateListAO,
  PromptTemplateListVO,
  PromptTemplateSaveAO,
  PromptTemplateSaveVO,
  PromptTemplateSelectListAO,
  PromptTemplateSelectVO,
} from './asset.dto';
import { PageResult, Result, SelectOption } from '../common/result';
import {
  AssetDictService,
  AssetService,
  BrandKitService,
  PromptTemplateService,
  UploadedFilePayload,
} from './asset.service';

/** 素材管理接口 — /asset/asset/*（#1-6、#19） */
@Controller('asset/asset')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  /** #1 素材分页（keyword/category/assetType/assetStatus） */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: AssetListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<AssetListVO>>> {
    return Result.success(await this.assetService.listPage(ao, userId));
  }

  /** #2 素材上传（multipart；INV-19 类型/大小、INV-20 hash 查重） */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ASSET_MAX_FILE_SIZE_BYTES, files: 1 } }),
  )
  async upload(
    @UploadedFile() file: UploadedFilePayload | undefined,
    @Body() ao: AssetUploadAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AssetUploadVO>> {
    return Result.success(await this.assetService.upload(file, ao, userId));
  }

  /** #3 素材编辑（名称/分类） */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(
    @Body() ao: AssetSaveAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AssetSaveVO>> {
    return Result.success(await this.assetService.save(ao, userId));
  }

  /** #4 素材停用（被引用素材仅可停用，ADR-004） */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(
    @Body() ao: AssetIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.assetService.disable(ao, userId);
    return Result.success();
  }

  /** #5 素材启用 */
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  async enable(
    @Body() ao: AssetIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.assetService.enable(ao, userId);
    return Result.success();
  }

  /** #6 素材删除（仅 refCount=0，INV-18） */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Body() ao: AssetIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.assetService.delete(ao, userId);
    return Result.success();
  }

  /** #19 OHS：素材文件限时 URL 批量签发（生成/导出/演示消费） */
  @Post('file-url')
  @HttpCode(HttpStatus.OK)
  async fileUrl(
    @Body() ao: AssetFileUrlAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AssetFileUrlVO[]>> {
    return Result.success(await this.assetService.fileUrls(ao, userId));
  }
}

/** 品牌规范管理接口 — /asset/brandkit/*（#8-11、#20） */
@Controller('asset/brandkit')
export class BrandKitController {
  constructor(private readonly brandKitService: BrandKitService) {}

  /** #8 规范分页（keyword like） */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: BrandKitListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<BrandKitListVO>>> {
    return Result.success(await this.brandKitService.listPage(ao, userId));
  }

  /** #9 规范保存（brandKitId 空=新建；logoAssetId 启用态校验 INV-16） */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(
    @Body() ao: BrandKitSaveAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<BrandKitSaveVO>> {
    return Result.success(await this.brandKitService.save(ao, userId));
  }

  /** #10 规范删除（非默认且未被 deck 引用） */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Body() ao: BrandKitIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.brandKitService.delete(ao, userId);
    return Result.success();
  }

  /** #11 设默认（INV-17 事务切换） */
  @Post('set-default')
  @HttpCode(HttpStatus.OK)
  async setDefault(
    @Body() ao: BrandKitIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.brandKitService.setDefault(ao, userId);
    return Result.success();
  }

  /** #20 OHS：品牌规范读取（会话属主；未命中 data=null） */
  @Post('provider-get')
  @HttpCode(HttpStatus.OK)
  async providerGet(
    @Body() ao: BrandKitProviderGetAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<BrandKitProviderGetVO | null>> {
    return Result.success(await this.brandKitService.providerGet(ao, userId));
  }
}

/** 话术模板管理接口 — /asset/prompt/*（#13-15、#17） */
@Controller('asset/prompt')
export class PromptTemplateController {
  constructor(private readonly promptTemplateService: PromptTemplateService) {}

  /** #13 话术分页 */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: PromptTemplateListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<PromptTemplateListVO>>> {
    return Result.success(await this.promptTemplateService.listPage(ao, userId));
  }

  /** #14 话术保存（占位符校验 INV-21） */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(
    @Body() ao: PromptTemplateSaveAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PromptTemplateSaveVO>> {
    return Result.success(await this.promptTemplateService.save(ao, userId));
  }

  /** #15 话术删除 */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Body() ao: PromptTemplateIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.promptTemplateService.delete(ao, userId);
    return Result.success();
  }

  /** #17 话术使用计数 +1（指令引用后调用） */
  @Post('touch')
  @HttpCode(HttpStatus.OK)
  async touch(
    @Body() ao: PromptTemplateIdAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.promptTemplateService.touch(ao, userId);
    return Result.success();
  }
}

/** asset 域 Select 选择器接口 — /asset/select/*（#7/#12/#16，选择池契约） */
@Controller('asset/select')
export class AssetSelectController {
  constructor(
    private readonly assetService: AssetService,
    private readonly brandKitService: BrandKitService,
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  /** #7 素材选择器（仅 ACTIVE；assetType eq / keyword like） */
  @Post('asset-list')
  @HttpCode(HttpStatus.OK)
  async assetList(
    @Body() ao: AssetSelectListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AssetSelectVO[]>> {
    return Result.success(await this.assetService.selectList(ao, userId));
  }

  /** #12 品牌规范选择器（keyword like；默认规范置顶） */
  @Post('brandkit-list')
  @HttpCode(HttpStatus.OK)
  async brandkitList(
    @Body() ao: BrandKitSelectListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<BrandKitSelectVO[]>> {
    return Result.success(await this.brandKitService.selectList(ao, userId));
  }

  /** #16 话术选择器（templateScene eq / keyword like；useCount 降序） */
  @Post('prompt-list')
  @HttpCode(HttpStatus.OK)
  async promptList(
    @Body() ao: PromptTemplateSelectListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PromptTemplateSelectVO[]>> {
    return Result.success(await this.promptTemplateService.selectList(ao, userId));
  }
}

/** asset 域枚举字典接口 — /asset/dict/batch（#18：assetType/assetStatus/templateScene） */
@Controller('asset/dict')
export class AssetDictController {
  constructor(private readonly assetDictService: AssetDictService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() ao: AssetDictBatchAO): Result<Map<string, SelectOption[]>> {
    return Result.success(this.assetDictService.batch(ao.keys));
  }
}
