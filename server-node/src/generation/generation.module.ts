import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChannelModule } from '../channel/channel.module';
import { AssetModule } from '../asset/asset.module';
import { DeckModule } from '../deck/deck.module';
import { GATEWAY_TASK_CALLBACK } from '../platform/gateway/gateway-task-callback';
import { VersionModule } from '../version/version.module';
import { GenerationTaskCallbackImpl } from './generation.callback.service';
import {
  GenerationFullController,
  GenerationOutlineController,
} from './generation.controller';
import { GenerationTaskController } from './generation.task.controller';
import { GenerationDictController } from './generation.dict.controller';
import { GenerationTaskDomainService } from './generation.domain-service';
import { GenerationEventPublisher } from './generation.events';
import { GenerationQueryRepository } from './generation.query.repository';
import { GenerationTaskRepository } from './generation.repository';
import { GenerationDictService } from './generation.dict-service';
import { GenerationTaskService } from './generation.service';
import {
  GENERATION_TASK_MODEL,
  GenerationTaskSchema,
} from './schemas/dl_generation_task.schema';

/**
 * generation 域模块（C-02 初稿生成，api-generation.md 9 端点）。
 *
 * 分层（node-specs 20 §2）：
 *   controller×3（outline+full/task/dict 路由前缀）→ service（Task 管理接口 +
 *   Domain 跨域创建链 + Callback 网关回调编排 + Dict 字典）→ repository
 *   （dl_generation_task 白名单/INV-8 互斥/GT 取号/终态条件更新）+
 *   query.repository（跨聚合只读投影，v1 GenerationTaskQueryMapper 先例）
 *   → schemas/dl_generation_task.schema.ts（四类 taskType 共用，索引归本模型声明）
 *
 * 跨域接线（domain-manifest §2④/§10）：
 * - 进口：DeckModule（assertCanCreateTask/updateDraftOutline/onFirstVersionCreated/getDeck）、
 *   ChannelModule（resolve 任务路由）、VersionModule（createVersionFromTask 留档唯一入口）；
 *   GatewayTaskService 经 PlatformModule @Global 直接注入（不 import，避免循环依赖）
 * - 出口：exports GenerationTaskDomainService——adjustment 域（C-03）whole/targeted
 *   submit 组装 GenerationTaskCreateCommand 复用统一创建链
 * - **provide GATEWAY_TASK_CALLBACK = GenerationTaskCallbackImpl**：platform 网关
 *   ModuleRef 惰性解析消费（回调编排=跨聚合编排点：OUTLINE→draft_outline 写入；
 *   三类内容任务→版本留档/指针/首版编排）
 * - TASK 聚合同步扫描归 platform 内置 GenerationTaskSyncScanner（D1 同表共治，
 *   本模块无需注册 SYNC_CHANGE_SCANNER）
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GENERATION_TASK_MODEL, schema: GenerationTaskSchema },
    ]),
    AssetModule,
    DeckModule,
    ChannelModule,
    VersionModule,
  ],
  controllers: [
    GenerationOutlineController,
    GenerationFullController,
    GenerationTaskController,
    GenerationDictController,
  ],
  providers: [
    GenerationTaskRepository,
    GenerationQueryRepository,
    GenerationEventPublisher,
    GenerationTaskDomainService,
    { provide: GATEWAY_TASK_CALLBACK, useClass: GenerationTaskCallbackImpl },
    GenerationTaskService,
    GenerationDictService,
  ],
  exports: [GenerationTaskDomainService],
})
export class GenerationModule {}
