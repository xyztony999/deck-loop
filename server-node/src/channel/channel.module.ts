import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelController } from './channel.controller';
import { ChannelPreferenceService } from './channel.service';
import { ChannelRepository } from './channel.repository';
import { ChannelAdminService } from './channel-admin.service';
import { ChannelConfigRepository } from './channel-config.repository';
import { ChannelConfig } from './schemas/channel-config.schema';
import { ChannelPreference } from './schemas/channel-preference.schema';
// ChannelUsageRecordRow 为 dl_usage_record 只读投影（ADR-016：SQL 直查，无独立 entity）

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
  imports: [TypeOrmModule.forFeature([ChannelConfig, ChannelPreference])],
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
