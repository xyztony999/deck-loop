import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { DeliverDictBatchAO, DeliverDictBatchVO } from './deliver.dto';
import { DeliverDictService } from './deliver.dict-service';

/**
 * deliver 域枚举字典接口（POST /deliver/dict/batch；ExportFormat/ExportStatus，
 * api-delivery §4.4 接口清单 7；v1 DeliverDictController 对齐）。会话内接口，无需权限注解。
 */
@Controller('deliver/dict')
export class DeliverDictController {
  constructor(private readonly deliverDictService: DeliverDictService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() ao: DeliverDictBatchAO): Result<DeliverDictBatchVO> {
    return Result.success(this.deliverDictService.batch(ao.keys));
  }
}
