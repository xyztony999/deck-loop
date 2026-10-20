import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { DeckDictBatchAO, DeckDictBatchVO } from './deck.dto';
import { DeckDictService } from './deck.dict-service';

/**
 * deck 域枚举字典接口（POST /deck/dict/batch；DeckType/DeckStatus，
 * api-deck §4.4 接口清单 9；v1 DeckDictController 对齐）。会话内接口，无需权限注解。
 */
@Controller('deck/dict')
export class DeckDictController {
  constructor(private readonly deckDictService: DeckDictService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() ao: DeckDictBatchAO): Result<DeckDictBatchVO> {
    return Result.success(this.deckDictService.batch(ao.keys));
  }
}
