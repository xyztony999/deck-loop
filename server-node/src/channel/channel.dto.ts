import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { TaskType, type TaskTypeCode } from '../common/enums';
import { PageQuery, SelectOption } from '../common/result';

/**
 * channel 域 DTO（api-channel §4.4 AO/VO 平移，契约冻结：字段/消息一字不动）。
 * 注意：class-validator 不级联校验 Record 值（v1 Jakarta @Valid on Map 的差异），
 * preferenceMap 的键值域/档位字段规则由 PreferenceMapConstraint（@Validate）统一承担。
 */

/* ------------------------------------------------------------------ */
/* 汇总维度常量（查询参数，未入枚举池——domain-manifest §12）             */
/* ------------------------------------------------------------------ */

export const USAGE_DIMENSION_CHANNEL = 'CHANNEL';
export const USAGE_DIMENSION_DECK = 'DECK';
export const USAGE_DIMENSION_TASK_TYPE = 'TASK_TYPE';

/** 维度值域白名单（DTO @IsIn 与仓储管道白名单共同引用） */
export const USAGE_DIMENSIONS: ReadonlyArray<string> = [
  USAGE_DIMENSION_CHANNEL,
  USAGE_DIMENSION_DECK,
  USAGE_DIMENSION_TASK_TYPE,
];

/* ------------------------------------------------------------------ */
/* 校验器（v1 @AssertTrue 跨字段校验的 class-validator 等价物）          */
/* ------------------------------------------------------------------ */

/** 非空串且 ≤max（v1 @NotBlank + @Size(max) 的组合语义） */
function isNonBlankStringWithin(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/**
 * 严格解析 yyyy-MM-dd（真实日期，拒绝 2026-02-30；本地时区，v1 LocalDate 语义对齐）。
 */
export function parseStrictDate(input: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (match === null) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * preferenceMap 跨字段校验（v1 ChannelPreferenceSaveAO#isPreferenceMapKeysValid 对齐并
 * 扩展承载档位字段规则）：键必须是 TaskType code；值 null/缺省=清除档位；非空值须为
 * 含成对 channelCode/modelCode（非空且 ≤64）的对象。
 */
@ValidatorConstraint({ name: 'channelPreferenceMap', async: false })
export class PreferenceMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const validTaskTypes = new Set<string>(Object.values(TaskType));
    for (const [key, tier] of Object.entries(value as Record<string, unknown>)) {
      if (typeof key !== 'string' || !validTaskTypes.has(key)) {
        return false;
      }
      if (tier === null || tier === undefined) {
        continue; // 清除档位（回落默认）
      }
      if (typeof tier !== 'object' || tier === null || Array.isArray(tier)) {
        return false;
      }
      const { channelCode, modelCode } = tier as Record<string, unknown>;
      if (!isNonBlankStringWithin(channelCode, 64) || !isNonBlankStringWithin(modelCode, 64)) {
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return 'preferenceMap 的键必须是有效任务类型（OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST），档位值须为 null 或成对 channelCode/modelCode（非空且 ≤64）';
  }
}

/**
 * 用量汇总时间范围跨字段校验（v1 ChannelUsageSummaryAO#isTimeRangeValid 对齐）：
 * 结束日期不早于开始日期，且跨度 ≤12 个月；非法日期（如 2026-02-30）判无效。
 */
@ValidatorConstraint({ name: 'channelUsageTimeRange', async: false })
export class UsageTimeRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const ao = args.object as Pick<ChannelUsageSummaryAO, 'timeRangeStart' | 'timeRangeEnd'>;
    if (ao.timeRangeStart === undefined || ao.timeRangeEnd === undefined) {
      return true; // 空值交给 @IsNotEmpty 报告
    }
    const start = parseStrictDate(ao.timeRangeStart);
    const end = parseStrictDate(ao.timeRangeEnd);
    if (start === null || end === null) {
      return false; // 非法日期（如 2026-02-30）
    }
    if (end.getTime() < start.getTime()) {
      return false;
    }
    // ≤12 个自然月（v1 ChronoUnit.MONTHS.between(start,end) <= 12 语义）
    const ceiling = new Date(
      start.getFullYear(),
      start.getMonth() + 12,
      start.getDate(),
      23,
      59,
      59,
      999,
    );
    return end.getTime() <= ceiling.getTime();
  }

  defaultMessage(): string {
    return '时间范围无效：结束日期不得早于开始日期，且跨度不能超过 12 个月';
  }
}

/* ------------------------------------------------------------------ */
/* AO（请求入参，class-validator 全注解带 message）                      */
/* ------------------------------------------------------------------ */

/** 偏好档位 AO（preferenceMap 值形态；字段规则由 PreferenceMapConstraint 级联承担） */
export class PreferenceTierAO {
  /** 档位渠道编码（INV-22 应用层校验） */
  @IsString({ message: '档位渠道编码必须为字符串' })
  @IsNotEmpty({ message: '档位渠道编码不能为空' })
  @MaxLength(64, { message: '档位渠道编码长度不能超过 64' })
  channelCode!: string;

  /** 档位模型编码（INV-22 应用层校验） */
  @IsString({ message: '档位模型编码必须为字符串' })
  @IsNotEmpty({ message: '档位模型编码不能为空' })
  @MaxLength(64, { message: '档位模型编码长度不能超过 64' })
  modelCode!: string;
}

/** 偏好保存 AO（POST /channel/preference/save；v1 ChannelPreferenceSaveAO 对齐） */
export class ChannelPreferenceSaveAO {
  /** 默认渠道编码（必填，网关清单 enabled 校验 INV-22） */
  @IsString({ message: '默认渠道编码必须为字符串' })
  @IsNotEmpty({ message: '默认渠道编码不能为空' })
  @MaxLength(64, { message: '默认渠道编码长度不能超过 64' })
  defaultChannelCode!: string;

  /** 默认模型编码（必填，INV-22） */
  @IsString({ message: '默认模型编码必须为字符串' })
  @IsNotEmpty({ message: '默认模型编码不能为空' })
  @MaxLength(64, { message: '默认模型编码长度不能超过 64' })
  defaultModelCode!: string;

  /** 分任务类型档位（键=TaskType code；值 null=清除档位回落默认；INV-22 逐项校验） */
  @IsOptional()
  @Validate(PreferenceMapConstraint)
  preferenceMap?: Record<string, PreferenceTierAO | null>;
}

/** 用量汇总查询 AO（POST /channel/usage/summary；v1 ChannelUsageSummaryAO 对齐） */
export class ChannelUsageSummaryAO extends PageQuery {
  /** 聚合维度：CHANNEL-按渠道 / DECK-按创作物 / TASK_TYPE-按任务类型 */
  @IsString({ message: '汇总维度必须为字符串' })
  @IsNotEmpty({ message: '汇总维度不能为空' })
  @IsIn([...USAGE_DIMENSIONS], { message: '汇总维度只支持 CHANNEL/DECK/TASK_TYPE' })
  dimension!: string;

  /** 时间范围-开始日期（yyyy-MM-dd） */
  @IsString({ message: '时间范围开始日期必须为字符串' })
  @IsNotEmpty({ message: '时间范围开始日期不能为空' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '时间范围开始日期格式必须为 yyyy-MM-dd' })
  timeRangeStart!: string;

  /** 时间范围-结束日期（yyyy-MM-dd；跨字段 ≤12 个月校验挂载于本字段） */
  @IsString({ message: '时间范围结束日期必须为字符串' })
  @IsNotEmpty({ message: '时间范围结束日期不能为空' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '时间范围结束日期格式必须为 yyyy-MM-dd' })
  @Validate(UsageTimeRangeConstraint)
  timeRangeEnd!: string;

  /** 页码（仅 DECK 维度分页生效；默认 1） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须为整数' })
  @Min(1, { message: '页码最小为 1' })
  pageNum: number = 1;

  /** 每页条数（仅 DECK 维度分页生效；默认 20） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数必须为整数' })
  @Min(1, { message: '每页条数最小为 1' })
  pageSize: number = 20;
}

/** 渠道选择器查询 AO（POST /channel/select/model-options；v1 ModelOptionAO 对齐） */
export class ModelOptionAO {
  /** 能力标签（可选，eq 精确匹配） */
  @IsOptional()
  @IsString({ message: '能力标签必须为字符串' })
  @MaxLength(64, { message: '能力标签长度不能超过 64' })
  capabilityTag?: string;
}

/* ------------------------------------------------------------------ */
/* VO（返回视图；_id 不进 VO——NR-08）                                    */
/* ------------------------------------------------------------------ */

/** 渠道/模型项（code+name+可用性标注；名称空值兜底回编码） */
export class ChannelItemVO {
  /** 编码 */
  code: string | null = null;
  /** 名称（清单未命中时兜底为编码本身，保证展示不空） */
  name: string | null = null;
  /** 是否在网关清单中 enabled（INV-22/D3 标注） */
  available = false;
}

/** 档位项（detail VO preferenceMap 的值；v1 PreferenceTierVO 对齐） */
export class PreferenceTierVO {
  /** 任务类型（TaskType code） */
  taskType: string;
  /** 任务类型名（TaskType 共享枚举转换） */
  taskTypeName: string | null = null;
  /** 档位渠道编码（usingDefault=true 时为默认渠道编码） */
  channelCode: string | null = null;
  /** 档位渠道名（清单回填，空值兜底回编码） */
  channelName: string | null = null;
  /** 档位模型编码 */
  modelCode: string | null = null;
  /** 档位模型名 */
  modelName: string | null = null;
  /** 渠道+模型是否均可用（D3 容错标注） */
  available = false;
  /** 是否回落默认（未设置该档位） */
  usingDefault = false;

  constructor(taskType: string) {
    this.taskType = taskType;
  }
}

/** 偏好详情 VO（POST /channel/preference/detail；v1 ChannelPreferenceDetailVO 对齐） */
export class ChannelPreferenceDetailVO {
  /** 偏好 ID（未保存过偏好时 null——空骨架） */
  preferenceId: string | null = null;
  /** 属主用户 ID（隔离字段，ADR-005） */
  userId: string;
  /** 默认渠道（含可用性标注） */
  defaultChannel: ChannelItemVO = new ChannelItemVO();
  /** 默认模型（含可用性标注） */
  defaultModel: ChannelItemVO = new ChannelItemVO();
  /** 分任务类型档位（全部 4 档位返回，未设置档位 usingDefault=true 回落默认） */
  preferenceMap: Record<string, PreferenceTierVO> = {};
  /** 平台兜底渠道（只读展示；平台无可用兜底时 null） */
  fallbackChannel: ChannelItemVO | null = null;
  /** 创建人 ID（属主判断） */
  createdBy: string | null = null;
  /** 操作列（SelectOption{value=action,label=显示名} 承载，v1 对齐） */
  operList: SelectOption[] = [];

  constructor(userId: string) {
    this.userId = userId;
  }
}

/** 用量聚合行（v1 UsageRowVO 对齐；lastUsedAt 为展示串 yyyy-MM-dd HH:mm:ss） */
export class UsageRowVO {
  /** 维度键（渠道编码 / deckId / TaskType code） */
  dimKey!: string;
  /** 维度名（渠道名 / 创作物名 / 任务类型名；空值兜底回 dimKey） */
  dimName!: string;
  /** 任务数 */
  taskCount!: number;
  /** 输入 token 合计 */
  promptTokens!: number;
  /** 输出 token 合计 */
  completionTokens!: number;
  /** 最近使用时间（yyyy-MM-dd HH:mm:ss） */
  lastUsedAt!: string | null;
}

/** 用量汇总 VO（POST /channel/usage/summary；v1 ChannelUsageSummaryVO 对齐） */
export class ChannelUsageSummaryVO {
  /** 聚合维度（CHANNEL/DECK/TASK_TYPE） */
  dimension: string;
  /** 维度去重总数（DECK 维度=分页前总数） */
  total: number;
  /** 聚合行（DECK 维度已按分页裁剪） */
  rows: UsageRowVO[];

  constructor(dimension: string, total: number, rows: UsageRowVO[]) {
    this.dimension = dimension;
    this.total = total;
    this.rows = rows;
  }
}

/** 渠道选择器选项 VO（POST /channel/select/model-options；SelectOption+扩展） */
export class ModelOptionVO {
  /** 选项值（=modelCode） */
  value!: string;
  /** 选项标签（「渠道名 / 模型名」） */
  label!: string;
  /** 渠道编码 */
  channelCode!: string;
  /** 渠道名 */
  channelName!: string;
  /** 模型编码（与 value 同值，冗余便于取用） */
  modelCode!: string;
  /** 模型名 */
  modelName!: string;
  /** 能力标签（capabilityTag 过滤依据） */
  capabilityTags!: string[];
}

/** 档位 AO 的任务类型值域辅助（键校验/档位遍历共用） */
export function isTaskTypeCode(code: string): code is TaskTypeCode {
  return Object.values(TaskType).includes(code as TaskTypeCode);
}

/* ------------------------------------------------------------------ */
/* 渠道管理端（channel-admin-2026-10-23 §4；增量契约）                  */
/* ------------------------------------------------------------------ */

/** 能力标签值域（网关调度路由依据；与枚举池 capabilityTag 对齐） */
export const CHANNEL_CAPABILITY_TAGS: ReadonlyArray<string> = [
  'OUTLINE',
  'FULL_GENERATE',
  'FULL_ADJUST',
  'TARGETED_ADJUST',
];

/** 管理端·渠道模型行 AO */
export class ChannelAdminModelAO {
  @IsNotEmpty({ message: '模型编码不能为空' })
  @Matches(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/, { message: '模型编码格式无效' })
  modelCode!: string;

  @IsNotEmpty({ message: '模型名称不能为空' })
  @MaxLength(100)
  modelName!: string;

  @IsArray()
  @IsIn(CHANNEL_CAPABILITY_TAGS, { each: true, message: '能力标签含未定义值' })
  capabilityTags!: string[];

  @IsBoolean()
  enabled!: boolean;
}

/** 管理端·渠道保存 AO（creating=true 新建语义；apiKey 空=保留已存密钥） */
export class ChannelAdminSaveAO {
  @IsNotEmpty({ message: '渠道编码不能为空' })
  @Matches(/^[A-Z][A-Z0-9_]{0,47}$/, { message: '渠道编码须为大写字母开头的 A-Z0-9_' })
  channelCode!: string;

  /** 新建语义标记：true=必须不存在（否则 CODE_EXISTS）；缺省=编辑语义（必须已存在） */
  @IsOptional()
  @IsBoolean()
  creating?: boolean;

  @IsNotEmpty({ message: '渠道名称不能为空' })
  @MaxLength(100)
  channelName!: string;

  @IsNotEmpty({ message: 'baseUrl 不能为空' })
  @MaxLength(500)
  apiBaseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  apiKeyEnv?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-9999)
  @Max(9999)
  priority?: number;

  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: '至少配置一个模型' })
  @ValidateNested({ each: true })
  @Type(() => ChannelAdminModelAO)
  models!: ChannelAdminModelAO[];
}

/** 管理端·渠道编码 AO（detail/启停共用） */
export class ChannelAdminCodeAO {
  @IsNotEmpty({ message: '渠道编码不能为空' })
  @MaxLength(64)
  channelCode!: string;
}

/** 管理端·启停 AO */
export class ChannelAdminSetEnabledAO {
  @IsNotEmpty({ message: '渠道编码不能为空' })
  @MaxLength(64)
  channelCode!: string;

  @IsBoolean()
  enabled!: boolean;
}

/** 管理端·连通性测试 AO：channelCode 走已存渠道；否则走临时 baseUrl+apiKey+modelCode */
export class ChannelAdminTestAO {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelCode?: string;
}

/** 管理端·模型行 VO */
export class ChannelAdminModelVO {
  modelCode!: string;
  modelName!: string;
  capabilityTags!: string[];
  enabled!: boolean;
}

/** 管理端·渠道项 VO（密钥只回掩码，绝不回明文/密文） */
export class ChannelAdminItemVO {
  channelCode!: string;
  channelName!: string;
  apiBaseUrl!: string;
  priority!: number;
  enabled!: boolean;
  builtin!: boolean;
  source!: string;
  /** 掩码（●●●●尾4）或 env 引用名展示；空=未配置 */
  apiKeyMasked!: string;
  models!: ChannelAdminModelVO[];

  constructor(
    channelCode: string,
    channelName: string,
    apiBaseUrl: string,
    priority: number,
    enabled: boolean,
    builtin: boolean,
    source: string,
    apiKeyMasked: string,
    models: ChannelAdminModelVO[],
  ) {
    this.channelCode = channelCode;
    this.channelName = channelName;
    this.apiBaseUrl = apiBaseUrl;
    this.priority = priority;
    this.enabled = enabled;
    this.builtin = builtin;
    this.source = source;
    this.apiKeyMasked = apiKeyMasked;
    this.models = models;
  }
}

/** 管理端·清单 VO */
export class ChannelAdminListVO {
  records!: ChannelAdminItemVO[];
  total!: number;

  constructor(records: ChannelAdminItemVO[], total: number) {
    this.records = records;
    this.total = total;
  }
}

/** 管理端·连通性测试 VO */
export class ChannelAdminTestVO {
  ok!: boolean;
  latencyMs?: number;
  errorMsg?: string;

  constructor(ok: boolean, latencyMs?: number, errorMsg?: string) {
    this.ok = ok;
    this.latencyMs = latencyMs;
    this.errorMsg = errorMsg;
  }
}
