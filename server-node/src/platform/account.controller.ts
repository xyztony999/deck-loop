import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { Public } from '../common/guards/auth.guard';
import type { AuthPrincipal } from '../common/auth-token-verifier';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountService } from './account.service';
import {
  AccountLoginAO,
  AccountLoginVO,
  AccountLogoutAO,
  AccountProfileAO,
  AccountProfileVO,
  AccountRegisterAO,
  AccountRegisterVO,
} from './platform.dto';

/**
 * 账号接口（P-02，接口域 auth；api-platform §4.4；v1 AccountController 平移）。
 *
 * - register/login：@Public（注册/登录免鉴权，api-platform §3.3）；
 * - logout/profile：会话（全局 AuthGuard 校验 X-Auth-Token；@CurrentUser 注入）；
 * - 隔离字段 accountId 服务端注入（NR-05），不取信客户端。
 */
@Controller('auth/account')
export class AccountController {
  /** 会话 token 请求头（v1 TOKEN_HEADER 契约） */
  static readonly TOKEN_HEADER = 'x-auth-token';

  constructor(private readonly accountService: AccountService) {}

  /** 注册（email 唯一 INV-24） */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() ao: AccountRegisterAO): Promise<Result<AccountRegisterVO>> {
    return Result.success(await this.accountService.register(ao));
  }

  /** 登录（→token 30 天滑动 + syncCursor 初始水位） */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() ao: AccountLoginAO): Promise<Result<AccountLoginVO>> {
    return Result.success(await this.accountService.login(ao));
  }

  /** 退出（撤销会话） */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() ao: AccountLogoutAO,
    @Headers(AccountController.TOKEN_HEADER) headerToken?: string,
  ): Promise<Result<null>> {
    await this.accountService.logout(ao, headerToken);
    return Result.success();
  }

  /** 资料读/改昵称（refreshedToken 滑动续期） */
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  async profile(
    @Body() ao: AccountProfileAO,
    @CurrentUser() user: AuthPrincipal,
    @Headers(AccountController.TOKEN_HEADER) headerToken?: string,
  ): Promise<Result<AccountProfileVO>> {
    return Result.success(await this.accountService.profile(ao, user.accountId ?? user.userId, headerToken));
  }
}
