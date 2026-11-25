import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { API_TOKEN_VERIFIER, AUTH_TOKEN_VERIFIER } from '../common/auth-token-verifier';
import { Account } from './schemas/account.schema';
import { ApiToken } from './schemas/api-token.schema';
import { UsageRecord } from './schemas/usage-record.schema';
// GenerationTaskCore 为 dl_generation_task 只读投影（ADR-016：SQL 直查同物理表，无独立 entity）
import { AccountRepository } from './account.repository';
import { ApiTokenRepository } from './api-token.repository';
import { UsageRecordRepository } from './usage-record.repository';
import { GenerationTaskCoreRepository } from './generation-task-core.repository';
import { SessionTokenService } from './session-token.service';
import { ApiTokenService } from './api-token.service';
import { ApiTokenGuard } from './api-token.guard';
import { SessionOnlyGuard } from './session-only.guard';
import { LoginFailureGuard } from './login-failure.guard';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { ApiTokenController } from './api-token.controller';
import { SyncController } from './sync.controller';
import { SyncPullService } from './sync/sync-pull.service';
import { SYNC_CHANGE_SCANNER } from './sync/sync-change-scanner';
import { GenerationTaskSyncScanner } from './sync/generation-task-sync.scanner';

/**
 * platform 域模块（P-02 账号与设备同步 + 个人 API token；api-platform.md +
 * api-web-agent.md §4.1，ADR-018）。
 *
 * **P-01 AI 网关包退役**（gateway/* + gateway-stream controller 删除，编码不复用）；
 * dl_generation_task/dl_usage_record 保留历史只读（TASK 同步扫描 + deck 历史审计读）。
 *
 * 分层：{account,api-token,sync}.controller → {account,api-token,session-token,
 * sync-pull}.service → {account,api-token,usage-record,generation-task-core}.repository
 * → schemas/{account,api-token,usage-record,dl_generation_task}.schema。
 *
 * **@Global 说明**：跨域消费方（common AuthGuard 的 AUTH_TOKEN_VERIFIER /
 * API_TOKEN_VERIFIER、version 域 agent-create 的 ApiTokenGuard）不互相 import
 * 本模块——@Global 暴露 provide，避免共享骨架耦合。
 *
 * 全局职责（api-web-agent §5.1）：
 * - provide AUTH_TOKEN_VERIFIER（会话校验，全局 AuthGuard 优先路径）
 * - provide API_TOKEN_VERIFIER（个人 token 校验，AuthGuard 回落路径）
 * - 导出 ApiTokenGuard/ApiTokenService（agent-create 仅 token 守卫）
 * - SYNC_CHANGE_SCANNER：TASK 聚合历史只读扫描器（D1；ADR-018 去 PREFERENCE）
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Account, ApiToken, UsageRecord])],
  controllers: [AccountController, ApiTokenController, SyncController],
  providers: [
    // repositories
    AccountRepository,
    ApiTokenRepository,
    UsageRecordRepository,
    GenerationTaskCoreRepository,
    // 账号与会话（P-02）
    SessionTokenService,
    { provide: AUTH_TOKEN_VERIFIER, useExisting: SessionTokenService },
    LoginFailureGuard,
    AccountService,
    // 个人 API token（P-02 增量，ADR-018）：独立表/哈希/过期/吊销逻辑
    ApiTokenService,
    { provide: API_TOKEN_VERIFIER, useExisting: ApiTokenService },
    ApiTokenGuard,
    SessionOnlyGuard,
    // 多端同步（P-02，仅服务 MCP 本地离线模式）：TASK 历史只读扫描器 + 聚合发现
    { provide: SYNC_CHANGE_SCANNER, useClass: GenerationTaskSyncScanner },
    SyncPullService,
  ],
  exports: [
    // 全局 AuthGuard 双凭证消费（common 依赖倒置 token）
    { provide: AUTH_TOKEN_VERIFIER, useExisting: SessionTokenService },
    { provide: API_TOKEN_VERIFIER, useExisting: ApiTokenService },
    // agent-create 仅 token 守卫（version 域 @UseGuards 消费）
    ApiTokenGuard,
    ApiTokenService,
  ],
})
export class PlatformModule {}