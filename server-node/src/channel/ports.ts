/**
 * channel 域跨域契约文件（domain-manifest §10）：
 * - 入站（依赖倒置）：ChannelRegistryPort —— channel 定义接口 + DI token，
 *   platform 域实现（ChannelRegistryService.listEnabled() 的防腐投影，api-platform §5.1）；
 *   channel 不直连 gateway 包、不触碰密钥（ADR-010/INV-26）
 * - 出站：RouteDecision —— ChannelPreferenceService#resolve(taskType,userId,explicit?) 的
 *   返回值，消费方 generation/adjustment（任务创建路由，写入路由快照）
 */

/** 注册模型（gw-channel-registry 无密钥投影；v1 RegisteredModel 对齐） */
export interface ChannelModelItem {
  /** 模型编码 */
  modelCode: string;
  /** 模型名称 */
  modelName: string;
  /** 能力标签（channel 域 Select 按 capabilityTag eq 过滤） */
  capabilityTags: string[];
}

/**
 * 注册渠道（manifest §10 命名 ChannelModel；v1 RegisteredChannel 分组视图对齐）：
 * enabled 渠道 + 其 enabled 模型，**不含任何密钥字段**（INV-26 静态检查红线）。
 */
export interface ChannelModel {
  /** 渠道编码 */
  channelCode: string;
  /** 渠道名称 */
  channelName: string;
  /** 优先级（数值大优先；platform 侧按其降序返回，channel 兜底取首位） */
  priority: number;
  /** 渠道下启用模型清单 */
  models: ChannelModelItem[];
}

/**
 * 渠道注册防腐端口（channel → platform OHS）：
 * platform 侧 provide CHANNEL_REGISTRY_PORT 实现本接口（@Global 暴露或 app.module 接线）；
 * channel 侧 @Optional() @Inject 消费——集成前 registry 视为空清单
 * （resolve 逐级降级后抛 BIZ_CHANNEL_UNAVAILABLE，不静默成功）。
 */
export interface ChannelRegistryPort {
  /**
   * 网关清单中 enabled 的渠道及其模型（INV-22 校验 / D3 可用性标注 /
   * Select model-options 数据源；platform 侧按 priority 数值大优先排序）。
   * 空数组=平台无可用渠道。
   */
  listEnabled(): ChannelModel[];
}

/** DI token（platform 侧 provide/useClass；字符串 token 跨模块直接引用） */
export const CHANNEL_REGISTRY_PORT = 'CHANNEL_REGISTRY_PORT';

/** 平台兜底渠道（channel 域路由概念值对象：清单 priority 首位渠道 + 其首个启用模型） */
export interface FallbackChannel {
  channelCode: string;
  channelName: string;
  modelCode: string;
}

/** resolve 命中层级：任务显式指定（显式不可用抛 BIZ_CHANNEL_UNAVAILABLE，不静默降级） */
export const ROUTE_SOURCE_EXPLICIT = 'EXPLICIT';
/** 命中层级：偏好档位（preference_map by taskType） */
export const ROUTE_SOURCE_TIER = 'TIER';
/** 命中层级：偏好默认（default_channel_code/default_model_code） */
export const ROUTE_SOURCE_DEFAULT = 'DEFAULT';
/** 命中层级：平台兜底（ADR-010 末级：注册清单 priority 首位渠道+首个模型） */
export const ROUTE_SOURCE_PLATFORM_FALLBACK = 'PLATFORM_FALLBACK';

/** 任务显式路由入参（成对必填；半空由 Service 拒绝） */
export interface ExplicitRoute {
  channelCode: string;
  modelCode: string;
}

/**
 * 路由解析结果（api-channel §5.1 对外服务返回值；v1 RouteDecision 对齐）：
 * source 标注实际命中层级（路由可追溯）；generation/adjustment 创建任务时
 * 将 channelCode/modelCode 写入 dl_generation_task 路由快照。
 */
export class RouteDecision {
  readonly channelCode: string;
  readonly modelCode: string;
  /** 命中层级（ROUTE_SOURCE_* 常量） */
  readonly source: string;

  private constructor(channelCode: string, modelCode: string, source: string) {
    this.channelCode = channelCode;
    this.modelCode = modelCode;
    this.source = source;
  }

  static of(channelCode: string, modelCode: string, source: string): RouteDecision {
    return new RouteDecision(channelCode, modelCode, source);
  }
}

/**
 * 网关运行时刷新端口（渠道管理端，channel-admin-2026-10-23 §3）：
 * 管理保存/启停落库后由 platform 侧 GatewayRuntimeStore 实现 reload()——
 * 重建内存快照并通知适配器重建（热生效，无需重启进程）。
 */
export interface GatewayRuntimePort {
  reload(): Promise<void>;
}

/** DI token（platform 侧 provide/useExisting GatewayRuntimeStore） */
export const GATEWAY_RUNTIME_PORT = 'GATEWAY_RUNTIME_PORT';
