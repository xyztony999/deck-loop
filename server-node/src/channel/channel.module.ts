import { Module } from '@nestjs/common';
import { MongooseModule, SchemaFactory } from '@nestjs/mongoose';
import { ChannelController } from './channel.controller';
import { ChannelPreferenceService } from './channel.service';
import { ChannelRepository } from './channel.repository';
import { ChannelAdminService } from './channel-admin.service';
import { ChannelConfigRepository } from './channel-config.repository';
import {
  ChannelConfig,
  ChannelConfigSchema,
} from './schemas/channel-config.schema';
import {
  ChannelPreference,
  ChannelPreferenceSchema,
} from './schemas/channel-preference.schema';
import {
  ChannelUsageRecordRow,
  ChannelUsageRecordRowSchema,
} from './schemas/channel-usage-record.schema';

/**
 * channel 域模块（api-channel 4 端点 + 渠道管理端 5 端点 channel-admin-2026-10-23）：
 * channel.controller → {channel.service, channel-admin.service} → repositories → schemas/。
 *
 * 跨域接线（依赖倒置，ports.ts）：
 * - 入站依赖：CHANNEL_REGISTRY_PORT（渠道注册清单）与 GATEWAY_RUNTIME_PORT（运行时
 *   刷新，管理端热生效）由 platform 域实现（@Global 暴露）；本模块以 @Optional @Inject
 *   消费——无 platform 时管理端保存跳过热刷新（重启进程生效）。
 * - 出站契约：exports ChannelPreferenceService——generation/adjustment 消费
 *   resolve(taskType,userId,explicit?)（任务创建路由，ADR-010 四层链）。
 * - dl_channel 权威 schema 在本域；platform/gateway 持同集合只读投影（快照加载）。
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChannelPreference.name, schema: SchemaFactory.createForClass(ChannelPreference) },
      {
        name: ChannelUsageRecordRow.name,
        schema: SchemaFactory.createForClass(ChannelUsageRecordRow),
      },
      // 渠道配置聚合根（管理端权威 schema；platform 侧有同集合只读投影）
      { name: ChannelConfig.name, schema: SchemaFactory.createForClass(ChannelConfig) },
    ]),
  ],
  controllers: [ChannelController],
  providers: [
    ChannelRepository,
    ChannelPreferenceService,
    ChannelConfigRepository,
    ChannelAdminService,
  ],
  exports: [ChannelPreferenceService],
})
export class ChannelModule {}
