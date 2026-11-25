import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PageResult, Result } from '../common/result';
import { ApiTokenService } from './api-token.service';
import { SessionOnlyGuard } from './session-only.guard';
import {
  ApiTokenIssueAO,
  ApiTokenIssueVO,
  ApiTokenListAO,
  ApiTokenListVO,
  ApiTokenRevokeAO,
} from './platform.dto';

/**
 * 个人 API token 管理接口（POST /auth/token/*，api-web-agent §4.1.3；ADR-018）。
 *
 * **仅会话守卫**（全局 AuthGuard X-Auth-Token + SessionOnlyGuard 拒绝 token 回落；
 * token 管理入口在网站设置页，个人 token 不可自管理——防泄露 token 自我续命）。
 * 属主=会话 userId（NR-05）。
 * HTTP 状态恒 200（@HttpCode(OK)，异常经全局 Filter 转 Result）。
 */
@UseGuards(SessionOnlyGuard)
@Controller('auth/token')
export class ApiTokenController {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  /** 签发 token（明文仅此次回执，INV-28） */
  @Post('issue')
  @HttpCode(HttpStatus.OK)
  async issue(
    @Body() ao: ApiTokenIssueAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<ApiTokenIssueVO>> {
    return Result.success(await this.apiTokenService.issue(ao, userId));
  }

  /** 吊销 token（幂等；即时生效——verify 每次查库） */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Body() ao: ApiTokenRevokeAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.apiTokenService.revoke(ao, userId);
    return Result.success();
  }

  /** token 列表（分页；永不回显 token/token_hash） */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: ApiTokenListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<ApiTokenListVO>>> {
    return Result.success(await this.apiTokenService.listPage(ao, userId));
  }
}