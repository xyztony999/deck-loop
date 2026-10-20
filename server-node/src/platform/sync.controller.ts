import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import type { AuthPrincipal } from '../common/auth-token-verifier';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SyncPullAO, SyncPullVO } from './platform.dto';
import { SyncPullService } from './sync/sync-pull.service';

/**
 * 多端增量同步接口（P-02，接口域 auth；api-platform §4.4；v1 SyncController 平移）。
 * 会话端点：userId（=accountId）由 AuthGuard/@CurrentUser 服务端注入（ADR-005）。
 */
@Controller('auth/sync')
export class SyncController {
  constructor(private readonly syncPullService: SyncPullService) {}

  /** 增量同步拉取（游标，单页 ≤200 条变更） */
  @Post('pull')
  @HttpCode(HttpStatus.OK)
  async pull(
    @Body() ao: SyncPullAO,
    @CurrentUser() user: AuthPrincipal,
  ): Promise<Result<SyncPullVO>> {
    return Result.success(await this.syncPullService.pull(ao, user.userId));
  }
}
