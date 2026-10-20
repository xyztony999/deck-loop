import { Module } from '@nestjs/common';
import { MongooseModule, SchemaFactory } from '@nestjs/mongoose';
import { ChannelController } from './channel.controller';
import { ChannelPreferenceService } from './channel.service';
import { ChannelRepository } from './channel.repository';
import {
  ChannelPreference,
  ChannelPreferenceSchema,
} from './schemas/channel-preference.schema';
import {
  ChannelUsageRecordRow,
  ChannelUsageRecordRowSchema,
} from './schemas/channel-usage-record.schema';

/**
 * channel 域模块（api-channel D-01，4 端点；domain-manifest §7）：
 * channel.controller → channel.service → channel.repository → schemas/。
 *
 * 跨域接线（依赖倒置，ports.ts）：
 * - 入站依赖：CHANNEL_REGISTRY_PORT（渠道注册清单）由 platform 域实现（manifest §10：
 *   platform.ChannelRegistryService.listEnabled()）；本模块不 import PlatformModule
 *   （channel/platform 同批并行生成，依赖序见 manifest §10），ChannelPreferenceService
 *   以 @Optional @Inject 消费——集成前清单为空（resolve 兜底抛 BIZ_CHANNEL_UNAVAILABLE，
 *   不静默成功）；接线方式：PlatformModule @Global 暴露 provide 或 app.module 显式 provide。
 * - 出站契约：exports ChannelPreferenceService——generation/adjustment 消费
 *   resolve(taskType,userId,explicit?)（任务创建路由，ADR-010 四层链）。
 * - 事件订阅：channel_preference_changed（本域发布）由 platform 同步扫描订阅（P-02）。
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChannelPreference.name, schema: SchemaFactory.createForClass(ChannelPreference) },
      {
        name: ChannelUsageRecordRow.name,
        schema: SchemaFactory.createForClass(ChannelUsageRecordRow),
      },
    ]),
  ],
  controllers: [ChannelController],
  providers: [ChannelRepository, ChannelPreferenceService],
  exports: [ChannelPreferenceService],
})
export class ChannelModule {}
