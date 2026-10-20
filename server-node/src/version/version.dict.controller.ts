import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { VersionDictBatchAO, VersionDictBatchVO } from './version.dto';
import { VersionDictService } from './version.dict-service';

/**
 * version 域枚举字典接口（POST /ver/dict/batch；VersionSourceType，
 * api-version §4.4 接口清单 6；v1 VersionDictController 对齐）。会话内接口，无需权限注解。
 */
@Controller('ver/dict')
export class VersionDictController {
  constructor(private readonly versionDictService: VersionDictService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() ao: VersionDictBatchAO): Result<VersionDictBatchVO> {
    return Result.success(this.versionDictService.batch(ao.keys));
  }
}
