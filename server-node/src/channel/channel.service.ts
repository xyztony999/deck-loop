import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BizException } from '../common/exceptions';
import { Result, SelectOption } from '../common/result';
import { TaskType, getTaskTypeLabel } from '../common/enums';
import {
  CHANNEL_REGISTRY_PORT,
  ROUTE_SOURCE_DEFAULT,
  ROUTE_SOURCE_EXPLICIT,
  ROUTE_SOURCE_PLATFORM_FALLBACK,
  ROUTE_SOURCE_TIER,
  type ChannelModel,
  type ChannelModelItem,
  type ChannelRegistryPort,
  type ExplicitRoute,
  type FallbackChannel,
  RouteDecision,
} from './ports';
import { CHANNEL_UNAVAILABLE, CHANNEL_UNAVAILABLE_MSG } from './channel.errors';
import {
  ChannelItemVO,
  ChannelPreferenceDetailVO,
  ChannelUsageSummaryVO,
  PreferenceTierVO,
  type ChannelPreferenceSaveAO,
  type ChannelUsageSummaryAO,
  type ModelOptionAO,
  type ModelOptionVO,
  type UsageRowVO,
  USAGE_DIMENSION_CHANNEL,
  USAGE_DIMENSION_TASK_TYPE,
  isTaskTypeCode,
  parseStrictDate,
} from './channel.dto';
import { type PreferenceTier } from './schemas/channel-preference.schema';
import {
  ChannelRepository,
  type UsageAggregateRow,
  type UsageDimension,
} from './channel.repository';

/** 领域事件（api-channel §4.5）：businessType=channel_preference_changed，载荷=userId */
export const CHANNEL_PREFERENCE_CHANGED = 'channel_preference_changed';

/** resolve 显式路由入参（宽松入参形态；半空由 Service 拒绝） */
export type ExplicitRouteInput = { channelCode?: string | null; modelCode?: string | null };

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** yyyy-MM-dd HH:mm:ss（本地时区，v1 LocalDateTime 展示语义对齐） */
function formatDateTime(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

/**
 * 渠道偏好应用服务（api-channel D-01；v1 ChannelPreferenceServiceImpl 对齐）：
 * - 主数据类：save 只做 upsert（无状态机/无业务编码），成功后发
 *   channel_preference_changed（事务提交后发布语义=单文档原子 upsert 返回后，NR-07）
 * - 用量聚合为跨模块只读（dl_usage_record，D2；写入归 platform 网关域）
 * - 渠道清单经 ChannelRegistryPort 防腐（依赖倒置：platform 实现 CHANNEL_REGISTRY_PORT）
 * - resolve=任务创建路由输入（ADR-010 四层链：任务显式>偏好档位>偏好默认>平台兜底；
 *   消费方 generation/adjustment，domain-manifest §10）
 */
@Injectable()
export class ChannelPreferenceService {
  private readonly logger = new Logger(ChannelPreferenceService.name);

  constructor(
    private readonly repository: ChannelRepository,
    @Optional()
    @Inject(CHANNEL_REGISTRY_PORT)
    private readonly registryPort: ChannelRegistryPort | null,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 偏好详情 / 保存（POST /channel/preference/detail|save）            */
  /* ---------------------------------------------------------------- */

  /**
   * 偏好详情：含渠道可用性标注（D3：渠道下线容错——存量偏好保留、标记不可用、
   * 路由自动降级）与平台兜底渠道（只读展示）。未保存过偏好时返回空骨架
   * （preferenceId=null，档位全 usingDefault）。
   */
  async detail(userId: string): Promise<ChannelPreferenceDetailVO> {
    this.requireUserId(userId);
    const snapshot = await this.repository.findSnapshotByUserId(userId);
    const registry = this.listEnabled();
    const defaultChannel = snapshot?.defaultChannelCode ?? null;
    const defaultModel = snapshot?.defaultModelCode ?? null;
    const tiers = snapshot?.tiers ?? {};

    const vo = new ChannelPreferenceDetailVO(userId);
    vo.preferenceId = snapshot?.preferenceId ?? null;
    vo.defaultChannel = this.buildChannelItem(defaultChannel, defaultModel, registry);
    vo.defaultModel = this.buildModelItem(defaultChannel, defaultModel, registry);
    vo.preferenceMap = this.buildTierVOs(defaultChannel, defaultModel, tiers, registry);

    const fallback = this.resolveFallback(registry);
    if (fallback !== null) {
      vo.fallbackChannel = {
        code: fallback.channelCode,
        name: fallback.channelName,
        available: true,
      };
    }
    vo.createdBy = snapshot?.createdBy ?? null;
    vo.operList = [SelectOption.of('save', '编辑偏好')];
    return vo;
  }

  /**
   * 偏好保存（upsert by userId，INV-23）：
   * - INV-22：默认渠道/模型 + 已设置档位逐项校验（须在网关清单 enabled）
   * - preferenceMap 值 null=清除该档位回落默认（落库前剔除，不持久化 null 键）
   * - 写入成功后发 channel_preference_changed（载荷=userId）
   */
  async save(userId: string, ao: ChannelPreferenceSaveAO): Promise<void> {
    this.requireUserId(userId);
    const registry = this.listEnabled();

    // INV-22：默认渠道/模型须在网关清单 enabled
    this.assertChannelModelEnabled(ao.defaultChannelCode, ao.defaultModelCode, registry, '默认');

    // INV-22：逐档位校验；null 值档位=清除（回落默认），不落库
    const effectiveTiers: Record<string, PreferenceTier> = {};
    const incoming = ao.preferenceMap ?? {};
    for (const [taskTypeCode, tier] of Object.entries(incoming)) {
      if (tier === null || tier === undefined) {
        continue; // 清除档位
      }
      this.assertChannelModelEnabled(tier.channelCode, tier.modelCode, registry, `档位[${getTaskTypeLabel(taskTypeCode)}]`);
      effectiveTiers[taskTypeCode] = { channelCode: tier.channelCode, modelCode: tier.modelCode };
    }

    await this.repository.upsertByUser(userId, {
      defaultChannelCode: ao.defaultChannelCode,
      defaultModelCode: ao.defaultModelCode,
      preferenceMap: effectiveTiers,
    });

    // 数据库写入成功（单文档原子 upsert 已提交）后发布（NR-07：回滚不发）
    this.eventEmitter.emit(CHANNEL_PREFERENCE_CHANGED, userId);
    this.logger.log(
      `preference saved: userId=${userId}, defaultChannel=${ao.defaultChannelCode}, tiers=[${Object.keys(effectiveTiers).join(',')}]`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 用量汇总（POST /channel/usage/summary）                            */
  /* ---------------------------------------------------------------- */

  /**
   * 用量聚合（dimension=CHANNEL/DECK/TASK_TYPE，时间范围 ≤12 个月，DECK 维度分页）：
   * rows 维度名——CHANNEL 来自注册清单、TASK_TYPE 来自共享枚举、DECK 由聚合管道
   * $lookup dl_deck 回填；lastUsedAt 格式化 yyyy-MM-dd HH:mm:ss。
   */
  async usageSummary(userId: string, ao: ChannelUsageSummaryAO): Promise<ChannelUsageSummaryVO> {
    this.requireUserId(userId);
    const dimension = ao.dimension as UsageDimension; // DTO @IsIn 已值域校验

    const startDay = parseStrictDate(ao.timeRangeStart);
    const endDay = parseStrictDate(ao.timeRangeEnd);
    if (startDay === null || endDay === null) {
      // 防御：DTO UsageTimeRangeConstraint 已拦截（不可达分支）
      throw new BizException(Result.CODE_FAIL, '时间范围无效：日期格式必须为 yyyy-MM-dd');
    }
    const start = startDay; // 当日 00:00:00.000（v1 atStartOfDay）
    const end = new Date(
      endDay.getFullYear(),
      endDay.getMonth(),
      endDay.getDate(),
      23,
      59,
      59,
      999,
    ); // 当日末尾（v1 atTime(23,59,59)，Mongo 毫秒精度补 .999）

    const { rows, total } = await this.repository.aggregateUsage({
      userId,
      dimension,
      start,
      end,
      pageNum: ao.pageNum,
      pageSize: ao.pageSize,
    });

    const registry = dimension === USAGE_DIMENSION_CHANNEL ? this.listEnabled() : [];
    const voRows = rows.map((row) => this.toUsageRowVO(row, dimension, registry));
    return new ChannelUsageSummaryVO(ao.dimension, total, voRows);
  }

  /* ---------------------------------------------------------------- */
  /* 渠道选择器（POST /channel/select/model-options）                    */
  /* ---------------------------------------------------------------- */

  /**
   * 模型选项清单（选择池 channel.select.modelOptions；SelectOption+扩展）：
   * value=modelCode、label=「渠道名 / 模型名」；capabilityTag 可选 eq 过滤。
   */
  modelOptions(ao: ModelOptionAO): ModelOptionVO[] {
    const capabilityTag = ao?.capabilityTag ?? null;
    const options: ModelOptionVO[] = [];
    for (const channel of this.listEnabled()) {
      for (const model of channel.models) {
        if (capabilityTag !== null && !(model.capabilityTags ?? []).includes(capabilityTag)) {
          continue;
        }
        const channelName = channel.channelName || channel.channelCode; // 名称兜底回编码
        const modelName = model.modelName || model.modelCode;
        options.push({
          value: model.modelCode,
          label: `${channelName} / ${modelName}`,
          channelCode: channel.channelCode,
          channelName,
          modelCode: model.modelCode,
          modelName,
          capabilityTags: model.capabilityTags ?? [],
        });
      }
    }
    return options;
  }

  /* ---------------------------------------------------------------- */
  /* 路由解析（api-channel §5.1 跨域契约，ADR-010 四层链）               */
  /* ---------------------------------------------------------------- */

  /**
   * 路由解析全链：任务显式 > 偏好档位 > 偏好默认 > 平台兜底。
   * 消费方 generation/adjustment（任务创建路由，结果写入路由快照）。
   *
   * - 任务显式（成对必填）：不可用直接失败 BIZ_CHANNEL_UNAVAILABLE，不静默降级（路由可追溯）
   * - 偏好档位（D3 容错）：档位渠道下线→自动降级到下一级，不抛错
   * - 平台兜底：清单 priority 首位渠道+首个启用模型；平台无可用渠道→BIZ_CHANNEL_UNAVAILABLE
   */
  async resolve(
    taskType: string,
    userId: string,
    explicit?: ExplicitRouteInput,
  ): Promise<RouteDecision> {
    if (!isNonBlank(userId)) {
      throw new BizException(Result.CODE_FAIL, '路由解析缺少 userId');
    }
    if (!isTaskTypeCode(taskType)) {
      throw new BizException(Result.CODE_FAIL, `路由解析的任务类型无效：${taskType}`);
    }
    const registry = this.listEnabled();

    // 第 1 级：任务显式（成对必填；显式指定不可用直接失败，不静默降级）
    const explicitPair = normalizeExplicitPair(explicit);
    if (explicitPair !== null) {
      this.assertChannelModelEnabled(explicitPair.channelCode, explicitPair.modelCode, registry, '任务显式');
      return RouteDecision.of(explicitPair.channelCode, explicitPair.modelCode, ROUTE_SOURCE_EXPLICIT);
    }

    const snapshot = await this.repository.findSnapshotByUserId(userId);
    const tiers = snapshot?.tiers ?? {};

    // 第 2 级：偏好档位（preference_map by taskType；D3 容错降级到下一级）
    const tier = tiers[taskType];
    if (tier !== undefined) {
      const picked = this.pickEnabled(tier.channelCode, tier.modelCode, registry);
      if (picked !== null) {
        return RouteDecision.of(picked.channelCode, picked.modelCode, ROUTE_SOURCE_TIER);
      }
    }

    // 第 3 级：偏好默认（default_channel_code/default_model_code）
    const defaultChannel = snapshot?.defaultChannelCode ?? null;
    const defaultModel = snapshot?.defaultModelCode ?? null;
    const defaultPicked = this.pickEnabled(defaultChannel, defaultModel, registry);
    if (defaultPicked !== null) {
      return RouteDecision.of(defaultPicked.channelCode, defaultPicked.modelCode, ROUTE_SOURCE_DEFAULT);
    }

    // 第 4 级：平台兜底（清单 priority 首位渠道+其首个启用模型）
    const fallback = this.resolveFallback(registry);
    if (fallback === null) {
      throw new BizException(
        CHANNEL_UNAVAILABLE,
        `平台无可用渠道，无法完成路由解析（taskType=${taskType}）`,
      );
    }
    return RouteDecision.of(fallback.channelCode, fallback.modelCode, ROUTE_SOURCE_PLATFORM_FALLBACK);
  }

  /* ---------------------------------------------------------------- */
  /* 私有工具                                                           */
  /* ---------------------------------------------------------------- */

  /** 用户上下文缺失防御（正常流程 AuthGuard+@CurrentUser 已保证） */
  private requireUserId(userId: string): void {
    if (!isNonBlank(userId)) {
      throw new BizException(Result.CODE_FAIL, '用户上下文缺失（未登录或会话未注入）');
    }
  }

  /** 渠道清单（依赖倒置：platform 实现 CHANNEL_REGISTRY_PORT；集成前视为空清单） */
  private listEnabled(): ChannelModel[] {
    return this.registryPort === null ? [] : this.registryPort.listEnabled();
  }

  /** 平台兜底渠道：清单 priority 首位（platform 侧已按数值大优先排序）+ 其首个启用模型 */
  private resolveFallback(registry: ChannelModel[]): FallbackChannel | null {
    const first = registry[0];
    if (first === undefined) {
      return null;
    }
    const firstModel = first.models[0];
    if (firstModel === undefined) {
      return null;
    }
    return {
      channelCode: first.channelCode,
      channelName: first.channelName,
      modelCode: firstModel.modelCode,
    };
  }

  /** 渠道+模型是否均在网关清单 enabled（INV-22 判定；成对可用才有效） */
  private pickEnabled(
    channelCode: string | null,
    modelCode: string | null,
    registry: ChannelModel[],
  ): { channelCode: string; modelCode: string } | null {
    if (!isNonBlank(channelCode) || !isNonBlank(modelCode)) {
      return null;
    }
    const channel = registry.find((item) => item.channelCode === channelCode);
    if (channel === undefined) {
      return null;
    }
    return channel.models.some((model) => model.modelCode === modelCode)
      ? { channelCode, modelCode }
      : null;
  }

  /** 清单内查找模型（先匹配渠道再匹配模型） */
  private findModel(
    channelCode: string | null,
    modelCode: string | null,
    registry: ChannelModel[],
  ): ChannelModelItem | null {
    if (!isNonBlank(channelCode) || !isNonBlank(modelCode)) {
      return null;
    }
    for (const channel of registry) {
      if (channel.channelCode !== channelCode) {
        continue;
      }
      const model = channel.models.find((item) => item.modelCode === modelCode);
      if (model !== undefined) {
        return model;
      }
    }
    return null;
  }

  /** INV-22 守卫：不可用即抛 BIZ_CHANNEL_UNAVAILABLE（不静默降级） */
  private assertChannelModelEnabled(
    channelCode: string | null,
    modelCode: string | null,
    registry: ChannelModel[],
    scene: string,
  ): void {
    if (this.pickEnabled(channelCode, modelCode, registry) === null) {
      throw new BizException(
        CHANNEL_UNAVAILABLE,
        `${CHANNEL_UNAVAILABLE_MSG}（${scene}，未在网关清单中启用：${channelCode ?? ''}/${modelCode ?? ''}）`,
      );
    }
  }

  /** 默认渠道项（code+name+可用性；名称空值兜底回编码） */
  private buildChannelItem(
    channelCode: string | null,
    modelCode: string | null,
    registry: ChannelModel[],
  ): ChannelItemVO {
    const item = new ChannelItemVO();
    item.code = channelCode;
    item.available = this.pickEnabled(channelCode, modelCode, registry) !== null;
    item.name =
      registry.find((channel) => channel.channelCode === channelCode)?.channelName ?? channelCode;
    return item;
  }

  /** 默认模型项（code+name+可用性） */
  private buildModelItem(
    channelCode: string | null,
    modelCode: string | null,
    registry: ChannelModel[],
  ): ChannelItemVO {
    const item = new ChannelItemVO();
    item.code = modelCode;
    item.available = this.pickEnabled(channelCode, modelCode, registry) !== null;
    const model = this.findModel(channelCode, modelCode, registry);
    item.name = model === null ? modelCode : model.modelName;
    return item;
  }

  /** 全 4 档位 VO（未设置档位以 usingDefault=true、回落默认渠道/模型返回） */
  private buildTierVOs(
    defaultChannel: string | null,
    defaultModel: string | null,
    tiers: Record<string, PreferenceTier>,
    registry: ChannelModel[],
  ): Record<string, PreferenceTierVO> {
    const voMap: Record<string, PreferenceTierVO> = {};
    for (const taskTypeCode of Object.values(TaskType)) {
      const tier = tiers[taskTypeCode];
      const tierVO = new PreferenceTierVO(taskTypeCode);
      tierVO.taskTypeName = getTaskTypeLabel(taskTypeCode);

      let channelCode: string | null;
      let modelCode: string | null;
      if (tier !== undefined) {
        channelCode = tier.channelCode;
        modelCode = tier.modelCode;
        tierVO.usingDefault = false;
      } else {
        channelCode = defaultChannel;
        modelCode = defaultModel;
        tierVO.usingDefault = true;
      }

      tierVO.channelCode = channelCode;
      tierVO.modelCode = modelCode;
      tierVO.available = this.pickEnabled(channelCode, modelCode, registry) !== null;
      tierVO.channelName =
        registry.find((channel) => channel.channelCode === channelCode)?.channelName ?? channelCode;
      const model = this.findModel(channelCode, modelCode, registry);
      tierVO.modelName = model === null ? modelCode : model.modelName;

      voMap[taskTypeCode] = tierVO;
    }
    return voMap;
  }

  /** 聚合行 → VO 行（维度名解析：CHANNEL=注册清单 / TASK_TYPE=共享枚举 / DECK=管道回填） */
  private toUsageRowVO(
    row: UsageAggregateRow,
    dimension: UsageDimension,
    registry: ChannelModel[],
  ): UsageRowVO {
    let dimName: string | null = row.dimName;
    if (dimension === USAGE_DIMENSION_CHANNEL) {
      dimName =
        registry.find((channel) => channel.channelCode === row.dimKey)?.channelName ?? null;
    } else if (dimension === USAGE_DIMENSION_TASK_TYPE) {
      dimName = getTaskTypeLabel(row.dimKey);
    }
    return {
      dimKey: row.dimKey,
      dimName: dimName ?? row.dimKey, // 空值兜底回 dimKey，保证展示不空
      taskCount: row.taskCount,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      lastUsedAt: row.lastUsedAt === null ? null : formatDateTime(row.lastUsedAt),
    };
  }
}

/** 任务显式路由归一化：两者皆空=null（未显式指定）；半空=拒绝；成对=返回 */
function normalizeExplicitPair(explicit?: ExplicitRouteInput): ExplicitRoute | null {
  const channelCode = explicit?.channelCode ?? null;
  const modelCode = explicit?.modelCode ?? null;
  const channelBlank = !isNonBlank(channelCode);
  const modelBlank = !isNonBlank(modelCode);
  if (channelBlank && modelBlank) {
    return null;
  }
  if (channelBlank || modelBlank) {
    throw new BizException(Result.CODE_FAIL, '任务显式路由的渠道与模型必须成对指定');
  }
  return { channelCode, modelCode };
}
