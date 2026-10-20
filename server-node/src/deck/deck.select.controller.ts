import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Result, SelectOption } from '../common/result';
import { DeckSelectListAO } from './deck.dto';
import { DeckManageService } from './deck.manage-service';

/**
 * deck 域 Select 选择池接口（deck.select.deckList → POST /deck/select/deck-list，
 * api-deck §5.1 / 接口清单 10；v1 DeckSelectController 对齐）。有会话上下文，
 * user_id 隔离条件由 Service 注入（20-api-conventions §4.1 Select 口径）。
 */
@Controller('deck/select')
export class DeckSelectController {
  constructor(private readonly deckManageService: DeckManageService) {}

  @Post('deck-list')
  @HttpCode(HttpStatus.OK)
  async deckList(
    @Body() ao: DeckSelectListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<SelectOption[]>> {
    return Result.success(await this.deckManageService.deckOptions(ao, userId));
  }
}
