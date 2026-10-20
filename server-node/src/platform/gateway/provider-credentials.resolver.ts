import { Inject, Injectable, Logger } from '@nestjs/common';
import { GW_PROVIDER_FAILED } from '../platform.errors';
import { BizException } from '../../common/exceptions';
import { GATEWAY_RUNTIME_CONFIG, type GatewayRuntimeConfig } from './gateway-config';

/**
 * Provider 密钥解析器（ADR-010/INV-26：**密钥唯一消费点**，仅 gateway 包内注入使用）。
 *
 * - 密钥不出网关域：方法签名只回密钥本体，禁止被 gateway 包外的类注入；
 * - 密钥来源仅 env：GATEWAY_CHANNELS 内联 apiKey 或 apiKeyEnv 指向的独立环境变量；
 * - 日志绝不输出密钥值（未配置时仅 warn 渠道编码）。
 * v1 ProviderCredentialsResolver 平移。
 */
@Injectable()
export class ProviderCredentialsResolver {
  private readonly logger = new Logger(ProviderCredentialsResolver.name);

  constructor(
    @Inject(GATEWAY_RUNTIME_CONFIG)
    private readonly config: GatewayRuntimeConfig,
  ) {}

  /**
   * 解析渠道密钥（真实 provider HTTP 适配器调用前注入）。
   *
   * @throws BizException BIZ_GW_PROVIDER_FAILED（渠道未注册/未启用）
   * @returns 密钥（可能为空串——未配置时按匿名渠道处理）
   */
  resolveApiKey(channelCode: string): string {
    const definition = this.config.channels.find(
      (channel) => channel.channelCode === channelCode,
    );
    if (definition === undefined) {
      throw new BizException(GW_PROVIDER_FAILED, `渠道未注册: ${channelCode}`);
    }
    if (!definition.enabled) {
      throw new BizException(GW_PROVIDER_FAILED, `渠道未启用: ${channelCode}`);
    }
    const fromEnv =
      definition.apiKeyEnv !== undefined ? (process.env[definition.apiKeyEnv] ?? '') : '';
    const apiKey = fromEnv.length > 0 ? fromEnv : (definition.apiKey ?? '');
    if (apiKey.length === 0) {
      this.logger.warn(`渠道 ${channelCode} 未配置密钥引用，适配器将按匿名渠道处理`);
    }
    return apiKey;
  }
}
