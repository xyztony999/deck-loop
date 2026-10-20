import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AUTH_TOKEN_VERIFIER } from '../common/auth-token-verifier';
import { CHANNEL_REGISTRY_PORT } from '../channel/ports';
import { Account, AccountSchema } from './schemas/account.schema';
import { UsageRecord, UsageRecordSchema } from './schemas/usage-record.schema';
import { GenerationTaskCore, GenerationTaskCoreSchema } from './schemas/generation-task-core.schema';
import { AccountRepository } from './account.repository';
import { UsageRecordRepository } from './usage-record.repository';
import { GenerationTaskCoreRepository } from './generation-task-core.repository';
import { SessionTokenService } from './session-token.service';
import { LoginFailureGuard } from './login-failure.guard';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { SyncController } from './sync.controller';
import { SyncPullService } from './sync/sync-pull.service';
import { SYNC_CHANGE_SCANNER } from './sync/sync-change-scanner';
import { GenerationTaskSyncScanner } from './sync/generation-task-sync.scanner';
import { GATEWAY_RUNTIME_CONFIG, loadGatewayRuntimeConfig } from './gateway/gateway-config';
import { ChannelRegistryService } from './gateway/channel-registry.service';
import { ProviderCredentialsResolver } from './gateway/provider-credentials.resolver';
import { MockAiProviderAdapter } from './gateway/mock-ai-provider.adapter';
import { ProviderAdapterRegistry } from './gateway/provider-adapter.registry';
import { GatewayTaskService } from './gateway/gateway-task.service';
import { SseTaskStreamHub } from './gateway/sse-task-stream-hub';
import { GatewayStreamController } from './gateway-stream.controller';

/**
 * platform 域模块（P-01 AI 网关 + P-02 账号与设备同步；api-platform.md）。
 *
 * 分层：{account,sync,gateway-stream}.controller → {account,sync-pull,session-token,
 * gateway/*}.service → {account,usage-record,generation-task-core}.repository →
 * schemas/{account,usage-record,generation-task-core}.schema；渠道注册=env/config
 * 读缓存（GATEWAY_CHANNELS，密钥仅 gateway 包内消费，INV-26）。
 *
 * **@Global 说明**：跨域消费方（channel 的 CHANNEL_REGISTRY_PORT @Optional 注入、
 * generation/adjustment 的 GatewayTaskService 直调、common AuthGuard 的
 * AUTH_TOKEN_VERIFIER）在并行生成期不互相 import 本模块——按 channel/ports.ts
 * 接线约定（「PlatformModule @Global 暴露 provide 或 app.module 接线」）选 @Global，
 * 避免改动共享骨架 app.module.ts。
 *
 * 全局职责（domain-manifest §8/§10）：
 * - provide AUTH_TOKEN_VERIFIER（全局 AuthGuard 消费，登录态打通）
 * - provide CHANNEL_REGISTRY_PORT（channel 域 ChannelPreferenceService 消费）
 * - 导出 GatewayTaskService（generation/adjustment 任务提交 execute(task)）
 * - GATEWAY_TASK_CALLBACK 由 generation 域 provide（本域 ModuleRef 惰性解析，不互相 import）
 * - SYNC_CHANGE_SCANNER 由各域 module provide（SyncPullService 经容器发现聚合）
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Account.name, schema: AccountSchema },
      { name: UsageRecord.name, schema: UsageRecordSchema },
      // 同表共治（D1）：模型名 GenerationTaskCore ≠ generation 域全量模型，
      // 同 collection dl_generation_task、不声明业务索引（索引归 generation 域）
      { name: GenerationTaskCore.name, schema: GenerationTaskCoreSchema },
    ]),
  ],
  controllers: [AccountController, SyncController, GatewayStreamController],
  providers: [
    // repositories
    AccountRepository,
    UsageRecordRepository,
    GenerationTaskCoreRepository,
    // 账号与会话（P-02）
    SessionTokenService,
    { provide: AUTH_TOKEN_VERIFIER, useExisting: SessionTokenService },
    LoginFailureGuard,
    AccountService,
    // 多端同步（P-02）：TASK 聚合内置扫描器（D1）+ 聚合发现
    { provide: SYNC_CHANGE_SCANNER, useClass: GenerationTaskSyncScanner },
    SyncPullService,
    // AI 网关（P-01）：env 渠道注册（进程启动快照）→ 清单/密钥/适配器/调度/SSE
    { provide: GATEWAY_RUNTIME_CONFIG, useFactory: loadGatewayRuntimeConfig },
    ChannelRegistryService,
    { provide: CHANNEL_REGISTRY_PORT, useExisting: ChannelRegistryService },
    ProviderCredentialsResolver,
    MockAiProviderAdapter,
    ProviderAdapterRegistry,
    GatewayTaskService,
    SseTaskStreamHub,
  ],
  exports: [
    // 全局 AuthGuard 消费（common 依赖倒置 token）
    { provide: AUTH_TOKEN_VERIFIER, useExisting: SessionTokenService },
    // channel 域 @Optional @Inject 消费（渠道清单防腐端口）
    { provide: CHANNEL_REGISTRY_PORT, useExisting: ChannelRegistryService },
    // 跨域直调（generation/adjustment execute(task)）
    ChannelRegistryService,
    GatewayTaskService,
  ],
})
export class PlatformModule {}
