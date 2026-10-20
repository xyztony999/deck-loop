import { BizException } from '../../common/exceptions';
import { GW_PROVIDER_FAILED, GW_PROVIDER_TIMEOUT } from '../platform.errors';
import type { GatewayTaskRequest } from './gateway-task-request';

/**
 * 外部 AI provider 适配器接口（api-platform §3.2 出站 ACL，隔离厂商模型）。
 * v1 AiProviderAdapter 平移（同步 → Promise 化）：
 * - 方法按 TaskType 对齐：OUTLINE→generateOutline、FULL_GENERATE→generateContent、
 *   FULL_ADJUST/TARGETED_ADJUST→adjustContent；
 * - 每渠道一实现，channelCode() 为路由匹配键；
 * - 真实厂商接入点：GATEWAY_CHANNELS 注册渠道 + OpenAI 兼容适配器自动生效。
 */
export interface AiProviderAdapter {
  /** 本适配器承接的渠道编码（与渠道注册 channelCode 一致） */
  channelCode(): string;

  /** 大纲生成（TaskType.OUTLINE） */
  generateOutline(context: ProviderCallContext): Promise<ProviderCallResult>;

  /** 整稿内容生成（TaskType.FULL_GENERATE） */
  generateContent(context: ProviderCallContext): Promise<ProviderCallResult>;

  /** 内容调整（TaskType.FULL_ADJUST / TARGETED_ADJUST） */
  adjustContent(context: ProviderCallContext): Promise<ProviderCallResult>;
}

/** Provider 调用上下文（网关域内值对象；密钥经本对象注入适配器，不出 gateway 包） */
export interface ProviderCallContext {
  /** 任务快照（taskId 为 provider 调用幂等键） */
  task: GatewayTaskRequest;
  /** 渠道密钥（ADR-010：仅 gateway 包内流转，禁日志/VO） */
  apiKey: string;
  /** 调用超时（毫秒） */
  timeoutMillis: number;
}

/** Provider 调用结果（网关域内值对象：产物 + 用量） */
export interface ProviderCallResult {
  /** 产物 JSON（大纲节点树 / 版本内容快照，回调业务编排的 result 参数） */
  content: string;
  /** 输入 token */
  promptTokens: number;
  /** 输出 token */
  completionTokens: number;
}

/**
 * Provider 调用异常（v1 ProviderCallException 平移）：
 * code 取 GW_*（超时/失败/配额）；调度器捕获后走失败路径——错误码随
 * onTaskCallback 的 result 参数回传业务编排，任务 error_msg 由 generation 域落库。
 */
export class ProviderCallError extends BizException {
  /** 是否可重试（网络/超时/5xx/429=true；4xx 业务错误=false） */
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = true) {
    super(code, message);
    this.name = 'ProviderCallError';
    this.retryable = retryable;
  }

  static timeout(message: string): ProviderCallError {
    return new ProviderCallError(GW_PROVIDER_TIMEOUT, message, true);
  }

  static failed(message: string, retryable = true): ProviderCallError {
    return new ProviderCallError(GW_PROVIDER_FAILED, message, retryable);
  }
}
