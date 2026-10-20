import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { GenerationDictBatchAO, GenerationDictBatchVO } from './generation.dto';
import { GenerationDictService } from './generation.dict-service';

/**
 * generation 域枚举字典接口（POST /gen/dict/batch；TaskType/TaskStatus，
 * api-generation §4.4 接口清单 9；v1 GenerationDictController 对齐）。会话内接口，无需权限注解。
 */
@Controller('gen/dict')
export class GenerationDictController {
  constructor(private readonly dictService: GenerationDictService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() ao: GenerationDictBatchAO): Result<GenerationDictBatchVO> {
    return Result.success(this.dictService.batch(ao.keys));
  }
}
