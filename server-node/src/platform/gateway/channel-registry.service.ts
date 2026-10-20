import { Inject, Injectable } from '@nestjs/common';
import type { ChannelModel, ChannelModelItem, ChannelRegistryPort } from '../../channel/ports';
import { GATEWAY_RUNTIME_CONFIG, type GatewayRuntimeConfig } from './gateway-config';

/**
 * 渠道注册查询服务（gw-channel-registry 对外 OHS，api-platform §5.1；
 * 实现 channel 域定义的倒置接口 src/channel/ports.ts ChannelRegistryPort——
 * manifest §10 签名 `listEnabled(): ChannelModel[]`）。
 *
 * - 配置来源：env GATEWAY_CHANNELS（进程启动快照，进程内读缓存）；
 * - 安全红线 ADR-010 / INV-26：本服务**不触碰密钥字段**——对外仅产出无密钥的
 *   ChannelModel（channel/ports.ts 定义，不含任何密钥字段）；
 *   密钥读取唯一入口 ProviderCredentialsResolver（gateway 包内）；
 * - 消费方：channel 域（偏好可用性标注 / INV-22 校验 / Select model-options /
 *   兜底渠道），经 CHANNEL_REGISTRY_PORT token 注入（PlatformModule @Global 暴露）。
 */
@Injectable()
export class ChannelRegistryService implements ChannelRegistryPort {
  constructor(
    @Inject(GATEWAY_RUNTIME_CONFIG)
    private readonly config: GatewayRuntimeConfig,
  ) {}

  /** 可用渠道清单（enabled 渠道 + 其 enabled 模型，priority 降序；空数组=平台无可用渠道） */
  listEnabled(): ChannelModel[] {
    return this.config.channels
      .filter((channel) => channel.enabled)
      .map(
        (channel): ChannelModel => ({
          channelCode: channel.channelCode,
          channelName: channel.channelName,
          priority: channel.priority,
          models: channel.models
            .filter((model) => model.enabled)
            .map(
              (model): ChannelModelItem => ({
                modelCode: model.modelCode,
                modelName: model.modelName,
                capabilityTags: [...model.capabilityTags],
              }),
            ),
        }),
      )
      .sort((a, b) => b.priority - a.priority);
  }
}
