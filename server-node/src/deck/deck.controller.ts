import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PageResult, Result } from '../common/result';
import {
  DeckArchiveAO,
  DeckDeleteAO,
  DeckDetailAO,
  DeckDetailVO,
  DeckFinalizeAO,
  DeckListAO,
  DeckListVO,
  DeckRestoreAO,
  DeckSaveAO,
  DeckSaveVO,
  DeckUnfinalizeAO,
} from './deck.dto';
import { DeckManageService } from './deck.manage-service';

/**
 * 创作物管理接口（POST /deck/deck/*，api-deck §4.4 接口清单 1-8；v1 DeckController 逐字对齐）。
 *
 * 个人单用户产品不建 RBAC（api-deck §3.3）：无权限注解，全部接口=登录会话
 * + user_id 属主隔离（@CurrentUser 服务端注入，NR-05；Service/Repository 强制）。
 * HTTP 状态恒 200（v1 对齐：@HttpCode(OK)，异常经全局 Filter 转 Result）。
 */
@Controller('deck/deck')
export class DeckController {
  constructor(private readonly deckManageService: DeckManageService) {}

  /** 1. 创作物列表：分页+筛选（archivedScope），行含统计冗余与 operList */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: DeckListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<DeckListVO>>> {
    const page = await this.deckManageService.listPage(ao, userId);
    return Result.success(page);
  }

  /** 2. 创作物保存：新建/编辑（id 空=新建） */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(
    @Body() ao: DeckSaveAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<DeckSaveVO>> {
    return Result.success(await this.deckManageService.save(ao, userId));
  }

  /** 3. 创作物详情：withStats/withLatestTask 开关 */
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  async detail(
    @Body() ao: DeckDetailAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<DeckDetailVO>> {
    return Result.success(await this.deckManageService.detail(ao, userId));
  }

  /** 4. 创作物归档：任意非归档态 → ARCHIVED */
  @Post('archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Body() ao: DeckArchiveAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.deckManageService.archive(ao.deckId, userId);
    return Result.success();
  }

  /** 5. 创作物恢复：ARCHIVED → archivedFromStatus */
  @Post('restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Body() ao: DeckRestoreAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.deckManageService.restore(ao.deckId, userId);
    return Result.success();
  }

  /** 6. 创作物删除：软删除（仅 ARCHIVED） */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Body() ao: DeckDeleteAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.deckManageService.delete(ao.deckId, userId);
    return Result.success();
  }

  /** 7. 定稿：ITERATING → FINALIZED（守卫：状态→confirm→无进行中任务→currentVersionId 非空） */
  @Post('finalize')
  @HttpCode(HttpStatus.OK)
  async finalize(
    @Body() ao: DeckFinalizeAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.deckManageService.finalize(ao.deckId, ao.confirm, userId);
    return Result.success();
  }

  /** 8. 解锁定稿：FINALIZED → ITERATING（confirm=true，finalVersionId 保留） */
  @Post('unfinalize')
  @HttpCode(HttpStatus.OK)
  async unfinalize(
    @Body() ao: DeckUnfinalizeAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.deckManageService.unfinalize(ao.deckId, ao.confirm, userId);
    return Result.success();
  }
}
