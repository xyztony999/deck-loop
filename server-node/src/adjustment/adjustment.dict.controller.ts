import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { AdjustDictBatchAO, AdjustDictBatchVO } from './adjustment.dto';
import { AdjustmentDictService } from './adjustment.dict-service';

/**
 * adjustment 域枚举字典接口（POST /adjust/dict/batch；TargetKind，
 * api-adjustment §4.4 接口清单 4；v1 AdjustDictController 对齐）。会话内接口，无需权限注解。
 */
@Controller('adjust/dict')
export class AdjustmentDictController {
  constructor(private readonly adjustmentDictService: AdjustmentDictService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() ao: AdjustDictBatchAO): Result<AdjustDictBatchVO> {
    return Result.success(this.adjustmentDictService.batch(ao.keys));
  }
}
