import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Result } from '../common/result';
import { PresentDataAO, PresentDataVO } from './deliver.dto';
import { PresentService } from './deliver.present-service';

/**
 * 演示放映接口（S-03，api-delivery §4.4 接口清单 6：POST /deliver/present/data；
 * v1 PresentController 对齐）。只读派生数据：FINALIZED 守卫 + finalVersionId 快照
 * 组装（图片块注入素材限时 URL），无写路径。
 */
@Controller('deliver/present')
export class PresentController {
  constructor(private readonly presentService: PresentService) {}

  /** 演示数据：deckName/finalVersionSeq/pages（渲染就绪结构，演示模式全屏消费） */
  @Post('data')
  @HttpCode(HttpStatus.OK)
  async data(
    @Body() ao: PresentDataAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PresentDataVO>> {
    return Result.success(await this.presentService.presentData(ao, userId));
  }
}
