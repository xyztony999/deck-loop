import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, getAccountStatusLabel } from '../common/enums';
import { BizException } from '../common/exceptions';
import { nextId } from '../common/utils/snowflake';
import { Account } from './schemas/account.schema';
import { AccountRepository } from './account.repository';
import { LoginFailureGuard } from './login-failure.guard';
import { SessionTokenService } from './session-token.service';
import {
  AccountLoginAO,
  AccountLoginVO,
  AccountLogoutAO,
  AccountProfileAO,
  AccountProfileVO,
  AccountRegisterAO,
  AccountRegisterVO,
} from './platform.dto';
import {
  AUTH_CREDENTIALS,
  AUTH_CREDENTIALS_MSG,
  AUTH_EMAIL_EXISTS,
  AUTH_EMAIL_EXISTS_MSG,
  AUTH_SESSION_EXPIRED,
  AUTH_SESSION_EXPIRED_MSG,
} from './platform.errors';

/**
 * 账号服务（P-02：注册/登录/退出/资料；v1 AccountServiceImpl 平移）。
 *
 * - 注册：INV-24 email 全局唯一（先查 + uk_email 唯一索引兜底并发）；
 * - 登录：失败 5 次锁 10 分钟（LoginFailureGuard）→ BIZ_AUTH_CREDENTIALS；
 *   LOCKED 账号拒绝登录；成功签发 30 天 token、回填 last_login_at，
 *   VO 带 syncCursor 初始水位（当前服务端毫秒）；
 * - 退出：撤销会话（token 无效时静默成功，幂等）；
 * - 资料：读/改昵称合一（nickname 空=只读）；滑动续期 refreshedToken。
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly sessionTokenService: SessionTokenService,
    private readonly loginFailureGuard: LoginFailureGuard,
  ) {}

  /** 注册（email 全局唯一 INV-24 → BIZ_AUTH_EMAIL_EXISTS） */
  async register(ao: AccountRegisterAO): Promise<AccountRegisterVO> {
    const { email, nickname, password } = validateRegister(ao);
    if ((await this.accountRepository.findByEmail(email)) !== null) {
      throw new BizException(AUTH_EMAIL_EXISTS, AUTH_EMAIL_EXISTS_MSG);
    }
    const now = new Date();
    const account = new Account();
    account.account_id = nextId();
    account.email = email;
    account.password_hash = this.sessionTokenService.hashPassword(password);
    account.nickname = nickname;
    account.account_status = AccountStatus.ACTIVE;
    account.last_login_at = undefined;
    account.data_version = 0;
    account.delete_sign = 0;
    account.created_by = account.account_id;
    account.created_name = account.nickname;
    account.created_time = now;
    account.updated_by = account.account_id;
    account.updated_name = account.nickname;
    account.updated_time = now;
    try {
      await this.accountRepository.insert(account);
    } catch (error) {
      // INV-24 唯一索引兜底（并发注册撞 uk_email，Mongo code=11000）
      if (isDuplicateKeyError(error)) {
        throw new BizException(AUTH_EMAIL_EXISTS, AUTH_EMAIL_EXISTS_MSG);
      }
      throw error;
    }
    const vo = new AccountRegisterVO();
    vo.accountId = account.account_id;
    vo.nickname = account.nickname;
    return vo;
  }

  /** 登录（失败 5 次锁 10 分钟 → BIZ_AUTH_CREDENTIALS；成功签发 30 天滑动 token） */
  async login(ao: AccountLoginAO): Promise<AccountLoginVO> {
    if (
      ao === null ||
      ao === undefined ||
      isBlank(ao.email) ||
      isBlank(ao.password)
    ) {
      throw new BizException(AUTH_CREDENTIALS, AUTH_CREDENTIALS_MSG);
    }
    const email = (ao.email ?? '').trim();
    if (this.loginFailureGuard.isLocked(email)) {
      const remainMinutes = Math.max(1, Math.floor(this.loginFailureGuard.lockedRemainMillis(email) / 60_000));
      throw new BizException(
        AUTH_CREDENTIALS,
        `失败次数过多已锁定，请约 ${remainMinutes} 分钟后重试`,
      );
    }
    const account = await this.accountRepository.findByEmail(email);
    if (
      account === null ||
      !this.sessionTokenService.verifyPassword(ao.password, account.password_hash)
    ) {
      this.loginFailureGuard.recordFail(email);
      throw new BizException(AUTH_CREDENTIALS, AUTH_CREDENTIALS_MSG);
    }
    if (account.account_status !== AccountStatus.ACTIVE) {
      throw new BizException(AUTH_CREDENTIALS, '账号已锁定，请联系支持');
    }
    this.loginFailureGuard.clear(email);
    await this.accountRepository.touchLastLogin(account.account_id, new Date());

    const vo = new AccountLoginVO();
    vo.token = this.sessionTokenService.issue(account.account_id);
    vo.nickname = account.nickname;
    vo.syncCursor = Date.now();
    return vo;
  }

  /**
   * 退出（撤销会话）：AO.token 优先；AO 未携带时撤销当前会话头 token
   * （AuthGuard 已校验后者有效；v1 仅撤销 AO token，此处为无害超集——幂等撤销）。
   */
  async logout(ao: AccountLogoutAO, headerToken: string | undefined): Promise<void> {
    if (ao !== null && ao !== undefined && !isBlank(ao.token)) {
      this.sessionTokenService.revoke(ao.token);
      return;
    }
    if (!isBlank(headerToken)) {
      this.sessionTokenService.revoke(headerToken);
    }
  }

  /** 资料读/改昵称（nickname 空=只读；滑动续期 refreshedToken） */
  async profile(
    ao: AccountProfileAO,
    accountId: string,
    headerToken: string | undefined,
  ): Promise<AccountProfileVO> {
    const account = await this.accountRepository.findByAccountId(accountId);
    if (account === null) {
      this.logger.warn(`账号不存在 accountId=${accountId}`);
      throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
    }
    let nickname = account.nickname;
    if (ao !== null && ao !== undefined && !isBlank(ao.nickname)) {
      const trimmed = (ao.nickname ?? '').trim();
      if (trimmed.length > 64) {
        throw new BizException(AUTH_CREDENTIALS, '昵称超长（≤64 字）');
      }
      await this.accountRepository.updateNickname(account.account_id, trimmed, new Date());
      nickname = trimmed;
    }
    const vo = new AccountProfileVO();
    vo.accountId = account.account_id;
    vo.email = account.email;
    vo.nickname = nickname;
    vo.accountStatus = account.account_status;
    vo.accountStatusName = getAccountStatusLabel(account.account_status);
    vo.lastLoginAt = formatLocalDateTime(account.last_login_at);
    vo.refreshedToken = this.sessionTokenService.refreshIfNeeded(headerToken);
    return vo;
  }

  /* ---------------- 校验（语义校验在 Service，v1 错误码对齐；见 platform.dto.ts 注释） ---------------- */
}

/**
 * 注册语义校验（v1 AccountServiceImpl#validateRegister 平移）：
 * 空/格式/长度不合法一律 BIZ_AUTH_CREDENTIALS（v1 错误码语义）。
 * @returns 归一化入参（email/nickname trim，password 原文）
 */
function validateRegister(ao: AccountRegisterAO): { email: string; nickname: string; password: string } {
  if (ao === null || ao === undefined || isBlank(ao.email) || isBlank(ao.password) || isBlank(ao.nickname)) {
    throw new BizException(AUTH_CREDENTIALS, '注册信息不完整');
  }
  const email = (ao.email ?? '').trim();
  const nickname = (ao.nickname ?? '').trim();
  const password = ao.password ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new BizException(AUTH_CREDENTIALS, '邮箱格式不正确');
  }
  if (password.length < 8 || password.length > 64) {
    throw new BizException(AUTH_CREDENTIALS, '密码长度须为 8~64 位');
  }
  if (email.length > 128 || nickname.length > 64) {
    throw new BizException(AUTH_CREDENTIALS, '邮箱/昵称超长');
  }
  return { email, nickname, password };
}

/** Mongo 唯一键冲突（code=11000）判定 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/** v1 Jackson LocalDateTime 序列化对齐（本地时区，yyyy-MM-ddTHH:mm:ss，无毫秒无时区后缀） */
function formatLocalDateTime(value: Date | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    + `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}
