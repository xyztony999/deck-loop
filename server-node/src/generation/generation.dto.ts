import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TaskStatus, TaskType, getTaskStatusLabel, getTaskTypeLabel } from '../common/enums';
import { OperItem, PageQuery, SelectOption } from '../common/result';
import type { GenerationTaskDocument } from './schemas/dl_generation_task.schema';

/**
 * generation 域 AO/VO（api-generation §4.4 契约冻结平移；v1 ao/vo/generation 包逐字对齐）。
 *
 * - AO：class-validator 校验（NR-04：id 格式/枚举值域/长度；whitelist 管道剥未知字段）
 * - VO：_id 不进 VO（NR-08）；*Name 标签冗余与 *Str 时间格式化随 VO 组装（v1 setting() 语义）；
 *   instruction_snapshot 为整体嵌入 object（D4 全自管 Mixed，api-generation §5.3）
 */

/** id 入参格式（NR-04：长度≤32、[A-Za-z0-9_-]；与 deck/version 域同口径） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 时间入参格式：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss（前端 createdTimeArr 拆分） */
const TIME_RANGE_PATTERN = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/** 空串→undefined（可选字段「空=未提供」语义，v1 isBlank 口径） */
const blankToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

/** Date → 'yyyy-MM-dd HH:mm:ss'（本地时区，v1 DATE_TIME_FORMATTER 对齐） */
export function formatDateTime(date: Date | null | undefined): string | null {
  if (date == null) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * timeRange 解析：date-only 时 start 补 00:00:00 / end 补 23:59:59.999（闭区间）；
 * 格式在 DTO Matches 已拦截，此处仅做形状解析（deck 域同款）。
 */
export function parseTimeRangeBound(
  value: string | null | undefined,
  boundary: 'start' | 'end',
): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const full = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(full)) {
    return new Date(`${full}T${boundary === 'start' ? '00:00:00' : '23:59:59.999'}`);
  }
  return new Date(full.replace(' ', 'T'));
}

/* ------------------------------------------------------------------ */
/* 篇幅常量（LengthOption 未入枚举池——domain-manifest §12 已知缺口，按字符串值域校验） */
/* ------------------------------------------------------------------ */

/** 篇幅值域（api-generation §4.4：SHORT/MEDIUM/LONG） */
export const LENGTH_OPTIONS = ['SHORT', 'MEDIUM', 'LONG'] as const;

/** 默认篇幅（api-generation §4.4：lengthOption 默认 MEDIUM） */
export const DEFAULT_LENGTH_OPTION = 'MEDIUM';

/** 指令摘要候选 key（快照软契约，按序取首个非空文本；v1 BRIEF_KEYS 对齐） */
export const BRIEF_KEYS = ['extraRequirement', 'instruction', 'requirement', 'topic'] as const;

/** instructionBrief 最大长度（api-generation §4.4：摘要 ≤80 字） */
export const BRIEF_MAX_LENGTH = 80;

/* ------------------------------------------------------------------ */
/* AO — 大纲                                                           */
/* ------------------------------------------------------------------ */

/**
 * 大纲节点 AO（outline 节点树元素，api-generation §4.4：
 * `[{nodeId,title,points[],note,pageHint}]`；v1 OutlineNodeAO 对齐）。
 * 持久化形态为 Deck.draft_outline 节点树（数组顶层）。
 */
export class OutlineNodeAO {
  /** 节点 ID（可空：空由保存时按序生成 n1/n2/...） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(32, { message: '节点ID不能超过32字符' })
  nodeId?: string;

  /** 节点标题（≤50 字） */
  @IsString({ message: '节点标题不能为空' })
  @IsNotEmpty({ message: '节点标题不能为空' })
  @MaxLength(50, { message: '节点标题不能超过50字' })
  title!: string;

  /** 要点列表（每条 ≤200 字符） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true, message: '要点必须为字符串' })
  @MaxLength(200, { each: true, message: '要点不能超过200字符' })
  points?: string[];

  /** 备注（≤500） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(500, { message: '节点备注不能超过500字符' })
  note?: string;

  /** 页数提示（该节点建议占页数） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页数提示必须为整数' })
  pageHint?: number;
}

/** 发起大纲生成 AO（POST /gen/outline/generate；INV-3/INV-8、assetIds ≤10 启用态、brandKitId 启用态） */
export class OutlineGenerateAO {
  @IsString({ message: '创作物ID不能为空' })
  @Matches(ID_PATTERN, { message: '创作物ID格式不合法' })
  deckId!: string;

  /** 补充要求（≤500，可空） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(500, { message: '补充要求不能超过500字符' })
  extraRequirement?: string;

  /** 引用素材（≤10，须属主名下启用态） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '引用素材不能超过10个' })
  @IsString({ each: true, message: '素材ID必须为字符串' })
  @MaxLength(32, { each: true, message: '素材ID不能超过32字符' })
  assetIds?: string[];

  /** 品牌规范（可空；填写时须启用态） */
  @IsOptional()
  @Transform(blankToUndefined)
  @Matches(ID_PATTERN, { message: '品牌规范ID格式不合法' })
  brandKitId?: string;
}

/** 保存大纲编辑 AO（POST /gen/outline/save；节点 1~50、title ≤50（OutlineNodeAO 级联校验） */
export class OutlineSaveAO {
  @IsString({ message: '创作物ID不能为空' })
  @Matches(ID_PATTERN, { message: '创作物ID格式不合法' })
  deckId!: string;

  /** 大纲节点树（1~50 节点；DRAFT 态可编辑，首版生成后只读——Service 层守卫） */
  @IsArray({ message: '大纲节点不能为空' })
  @ArrayNotEmpty({ message: '大纲节点不能为空' })
  @ArrayMaxSize(50, { message: '大纲节点不能超过50个' })
  @ValidateNested({ each: true })
  @Type(() => OutlineNodeAO)
  outline!: OutlineNodeAO[];
}

/* ------------------------------------------------------------------ */
/* AO — 整稿                                                           */
/* ------------------------------------------------------------------ */

/** 发起整稿生成 AO（POST /gen/full/generate；outlineSnapshot 或 useDraft=true 二者须其一） */
export class FullGenerateAO {
  @IsString({ message: '创作物ID不能为空' })
  @Matches(ID_PATTERN, { message: '创作物ID格式不合法' })
  deckId!: string;

  /** 确认版大纲快照 JSON 字符串（可空；useDraft=true 时取 Deck.draftOutline） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(65535, { message: '大纲快照过长' })
  outlineSnapshot?: string;

  /** true=直接使用已保存的 draftOutline（默认 false） */
  @IsOptional()
  @IsBoolean()
  useDraft?: boolean;

  /** 品牌规范（可空；填写时须启用态） */
  @IsOptional()
  @Transform(blankToUndefined)
  @Matches(ID_PATTERN, { message: '品牌规范ID格式不合法' })
  brandKitId?: string;

  /** 引用素材（≤10，须属主名下启用态） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '引用素材不能超过10个' })
  @IsString({ each: true, message: '素材ID必须为字符串' })
  @MaxLength(32, { each: true, message: '素材ID不能超过32字符' })
  assetIds?: string[];

  /** 篇幅：SHORT/MEDIUM/LONG，默认 MEDIUM（LengthOption 未入枚举池，值域校验） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn([...LENGTH_OPTIONS], { message: '篇幅选项非法（SHORT/MEDIUM/LONG）' })
  lengthOption?: string;
}

/* ------------------------------------------------------------------ */
/* AO — 任务查询/操作                                                  */
/* ------------------------------------------------------------------ */

/** 任务列表查询 AO（POST /gen/task/list；分页 + 按 deck/状态/类型筛 + 时间范围） */
export class GenerationTaskListAO extends PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'pageNum必须为正整数' })
  declare pageNum: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'pageSize必须为正整数' })
  declare pageSize: number;

  /** 归属创作物精确匹配（可空） */
  @IsOptional()
  @Transform(blankToUndefined)
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId?: string;

  /** 任务状态精确匹配（TaskStatus code，可空） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(TaskStatus), { message: 'taskStatus值不合法' })
  taskStatus?: string;

  /** 任务类型精确匹配（TaskType code，可空） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(TaskType), { message: 'taskType值不合法' })
  taskType?: string;

  /** 创建时间起（yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Matches(TIME_RANGE_PATTERN, {
    message: 'createdTimeStart格式须为yyyy-MM-dd或yyyy-MM-dd HH:mm:ss',
  })
  createdTimeStart?: string;

  /** 创建时间止 */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Matches(TIME_RANGE_PATTERN, {
    message: 'createdTimeEnd格式须为yyyy-MM-dd或yyyy-MM-dd HH:mm:ss',
  })
  createdTimeEnd?: string;
}

/** 任务详情 AO（POST /gen/task/detail，含指令快照） */
export class GenerationTaskDetailAO {
  @IsString({ message: '任务ID不能为空' })
  @Matches(ID_PATTERN, { message: '任务ID格式不合法' })
  taskId!: string;
}

/** 任务进度批量查询 AO（POST /gen/task/progress；taskIds ≤20，客户端 2s 间隔轮询） */
export class GenerationTaskProgressAO {
  @IsArray({ message: '任务ID集合不能为空' })
  @ArrayNotEmpty({ message: '任务ID集合不能为空' })
  @ArrayMaxSize(20, { message: '单次轮询任务数不能超过20' })
  @IsString({ each: true, message: '任务ID必须为字符串' })
  @MaxLength(32, { each: true, message: '任务ID不能超过32字符' })
  taskIds!: string[];
}

/** 取消任务 AO（POST /gen/task/cancel；仅 QUEUED/RUNNING） */
export class GenerationTaskCancelAO {
  @IsString({ message: '任务ID不能为空' })
  @Matches(ID_PATTERN, { message: '任务ID格式不合法' })
  taskId!: string;
}

/** 重试任务 AO（POST /gen/task/retry；仅 FAILED→新任务实例） */
export class GenerationTaskRetryAO {
  @IsString({ message: '任务ID不能为空' })
  @Matches(ID_PATTERN, { message: '任务ID格式不合法' })
  taskId!: string;
}

/** 枚举字典批量查询 AO（POST /gen/dict/batch；key=taskType/taskStatus） */
export class GenerationDictBatchAO {
  @IsArray()
  @ArrayNotEmpty({ message: 'keys不能为空' })
  @IsString({ each: true })
  keys!: string[];
}

/* ------------------------------------------------------------------ */
/* 跨域契约入参 — GenerationTaskCreateCommand（manifest §10，v1 ao 平移） */
/* ------------------------------------------------------------------ */

/**
 * 生成任务创建命令（跨域进程内直调入参，四类 taskType 共用创建链，
 * api-generation §4.3 任务子流程共用契约；非 HTTP AO）。
 *
 * 消费方（单服务进程内直调，无 HTTP 回环）：
 * - generation 域自身：/gen/outline/generate、/gen/full/generate、/gen/task/retry
 *   组装本命令直调 GenerationTaskDomainService#createTask；
 * - adjustment 域（C-03）：/adjust/whole|targeted/submit 组装命令同表写入
 *   （调整类入参校验由 adjust 域先行完成；gen_task_created/finished 以 taskType 区分复用）。
 *
 * userId 显式传入：创建链可能运行在无会话上下文的跨域线程（ADR-005）。
 */
export class GenerationTaskCreateCommand {
  /** 归属创作物（必填） */
  deckId!: string;

  /** 属主（必填，隔离字段 ADR-005） */
  userId!: string;

  /** 任务类型（必填，TaskType code：OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST） */
  taskType!: string;

  /** 基线版本（可空：OUTLINE 为空；调整类=调整起点版本） */
  baseVersionId?: string | null;

  /** 入参/指令快照（必填，整体嵌入 object：大纲快照/指令/scope/brandKitId/assetIds/usedTemplateIds/lengthOption） */
  instructionSnapshot!: Record<string, unknown>;

  /** 任务显式渠道编码（可空=未显式指定；ADR-010 四层链首级，非空时不可用直接失败不降级；须与模型成对） */
  explicitChannelCode?: string | null;

  /** 任务显式模型编码（可空；须与渠道成对） */
  explicitModelCode?: string | null;
}

/** 创建链返回（manifest §10：{ taskId, taskCode }；taskStatus 供发起 VO 组装，恒 QUEUED） */
export class GenerationTaskCreateResult {
  taskId!: string;
  taskCode!: string;
  taskStatus!: string;
  /** 路由快照回传（日志/审计；非契约冻结字段） */
  channelCode!: string;
  modelCode!: string;

  static of(
    taskId: string,
    taskCode: string,
    taskStatus: string,
    channelCode: string,
    modelCode: string,
  ): GenerationTaskCreateResult {
    const result = new GenerationTaskCreateResult();
    result.taskId = taskId;
    result.taskCode = taskCode;
    result.taskStatus = taskStatus;
    result.channelCode = channelCode;
    result.modelCode = modelCode;
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* VO                                                                  */
/* ------------------------------------------------------------------ */

/** 任务发起/重试返回 VO（taskId、taskCode、taskStatus；v1 GenerationTaskSubmitVO 对齐） */
export class GenerationTaskSubmitVO {
  taskId!: string;
  /** 规则编码（GT+yyMMdd+4位） */
  taskCode!: string;
  /** 初始状态（QUEUED；retry 亦为新建实例） */
  taskStatus!: string;
  taskStatusName!: string;

  static of(taskId: string, taskCode: string, taskStatus: string): GenerationTaskSubmitVO {
    const vo = new GenerationTaskSubmitVO();
    vo.taskId = taskId;
    vo.taskCode = taskCode;
    vo.taskStatus = taskStatus;
    vo.taskStatusName = getTaskStatusLabel(taskStatus);
    return vo;
  }
}

/** 任务列表行 VO（api-generation §4.4 行字段清单；v1 GenerationTaskListVO 逐字对齐） */
export class GenerationTaskListVO {
  taskId!: string;
  taskCode!: string;
  taskType!: string;
  taskTypeName!: string;
  taskStatus!: string;
  taskStatusName!: string;
  deckId!: string;
  /** deckName 冗余（跨聚合只读查询回填） */
  deckName!: string | null;
  /** 指令或「大纲/整稿」摘要（≤80 字，instruction_snapshot 派生展示） */
  instructionBrief!: string;
  /** 路由快照：渠道编码（D2 可追溯） */
  channelCode!: string;
  /** 路由快照：模型编码 */
  modelCode!: string;
  /** 成功产物版本（SUCCEEDED 必有） */
  resultVersionId!: string | null;
  /** 产物版本谱系序号（冗余展示，dl_deck_version.version_seq） */
  resultVersionSeq!: number | null;
  /** 失败摘要（终态 FAILED） */
  errorMsg!: string | null;
  /** 属主判断必需（operList isOwner，v1 06-oper-column 链路） */
  createdBy!: string | null;
  createdTime!: Date | null;
  updatedTime!: Date | null;
  createdTimeStr!: string | null;
  updatedTimeStr!: string | null;
  /** 操作列（Service 注入）：cancel(QUEUED/RUNNING)/retry(FAILED) */
  operList: OperItem[] = [];

  static of(
    task: GenerationTaskDocument,
    extras: { deckName: string | null; resultVersionSeq: number | null; operList: OperItem[] },
  ): GenerationTaskListVO {
    const vo = new GenerationTaskListVO();
    vo.taskId = task.task_id;
    vo.taskCode = task.task_code;
    vo.taskType = task.task_type;
    vo.taskTypeName = getTaskTypeLabel(task.task_type);
    vo.taskStatus = task.task_status;
    vo.taskStatusName = getTaskStatusLabel(task.task_status);
    vo.deckId = task.deck_id;
    vo.deckName = extras.deckName;
    vo.instructionBrief = instructionBrief(task);
    vo.channelCode = task.channel_code;
    vo.modelCode = task.model_code;
    vo.resultVersionId = task.result_version_id ?? null;
    vo.resultVersionSeq = extras.resultVersionSeq;
    vo.errorMsg = task.error_msg ?? null;
    vo.createdBy = task.created_by ?? null;
    vo.createdTime = task.created_time ?? null;
    vo.updatedTime = task.updated_time ?? null;
    vo.createdTimeStr = formatDateTime(task.created_time);
    vo.updatedTimeStr = formatDateTime(task.updated_time);
    vo.operList = extras.operList;
    return vo;
  }
}

/** 任务详情 VO（列表行全集 + 基线版本/指令快照/用量计量） */
export class GenerationTaskDetailVO {
  taskId!: string;
  taskCode!: string;
  taskType!: string;
  taskTypeName!: string;
  taskStatus!: string;
  taskStatusName!: string;
  deckId!: string;
  deckName!: string | null;
  /** 基线版本（OUTLINE 为空） */
  baseVersionId!: string | null;
  /** 入参/指令快照（整体嵌入 object 原样返回） */
  instructionSnapshot!: Record<string, unknown>;
  channelCode!: string;
  modelCode!: string;
  resultVersionId!: string | null;
  resultVersionSeq!: number | null;
  errorMsg!: string | null;
  /** 用量计量（网关回填） */
  promptTokens!: number | null;
  completionTokens!: number | null;
  instructionBrief!: string;
  createdBy!: string | null;
  createdName!: string | null;
  createdTime!: Date | null;
  updatedTime!: Date | null;
  createdTimeStr!: string | null;
  updatedTimeStr!: string | null;
  /** 操作列（Service 注入） */
  operList: OperItem[] = [];

  static of(
    task: GenerationTaskDocument,
    extras: { deckName: string | null; resultVersionSeq: number | null; operList: OperItem[] },
  ): GenerationTaskDetailVO {
    const vo = new GenerationTaskDetailVO();
    vo.taskId = task.task_id;
    vo.taskCode = task.task_code;
    vo.taskType = task.task_type;
    vo.taskTypeName = getTaskTypeLabel(task.task_type);
    vo.taskStatus = task.task_status;
    vo.taskStatusName = getTaskStatusLabel(task.task_status);
    vo.deckId = task.deck_id;
    vo.deckName = extras.deckName;
    vo.baseVersionId = task.base_version_id ?? null;
    vo.instructionSnapshot = task.instruction_snapshot;
    vo.channelCode = task.channel_code;
    vo.modelCode = task.model_code;
    vo.resultVersionId = task.result_version_id ?? null;
    vo.resultVersionSeq = extras.resultVersionSeq;
    vo.errorMsg = task.error_msg ?? null;
    vo.promptTokens = task.prompt_tokens ?? null;
    vo.completionTokens = task.completion_tokens ?? null;
    vo.instructionBrief = instructionBrief(task);
    vo.createdBy = task.created_by ?? null;
    vo.createdName = task.created_name ?? null;
    vo.createdTime = task.created_time ?? null;
    vo.updatedTime = task.updated_time ?? null;
    vo.createdTimeStr = formatDateTime(task.created_time);
    vo.updatedTimeStr = formatDateTime(task.updated_time);
    vo.operList = extras.operList;
    return vo;
  }
}

/** 任务进度行 VO（{taskId,taskStatus,progressPercent,stageText}；progress 为派生展示数据） */
export class GenerationTaskProgressVO {
  taskId!: string;
  taskStatus!: string;
  taskStatusName!: string;
  /** 派生进度（QUEUED=0/RUNNING=60/SUCCEEDED=100/终态失败取消=0） */
  progressPercent!: number;
  /** 阶段文案（状态粒度派生；实时进度经网关 SSE GET /gw/task/stream） */
  stageText!: string;

  static of(taskId: string, taskStatus: string): GenerationTaskProgressVO {
    const vo = new GenerationTaskProgressVO();
    vo.taskId = taskId;
    vo.taskStatus = taskStatus;
    vo.taskStatusName = getTaskStatusLabel(taskStatus);
    const derived = derivedProgress(taskStatus);
    vo.progressPercent = derived.percent;
    vo.stageText = derived.stageText;
    return vo;
  }
}

/** 派生进度计算（轮询通道仅状态粒度；v1 fillDerivedProgress 对齐） */
export function derivedProgress(taskStatus: string): { percent: number; stageText: string } {
  switch (taskStatus) {
    case TaskStatus.SUCCEEDED:
      return { percent: 100, stageText: '任务完成' };
    case TaskStatus.RUNNING:
      return { percent: 60, stageText: '模型执行中' };
    case TaskStatus.QUEUED:
      return { percent: 0, stageText: '排队中' };
    case TaskStatus.FAILED:
      return { percent: 0, stageText: '任务失败' };
    default:
      return { percent: 0, stageText: '已取消' };
  }
}

/**
 * instructionBrief：快照内指令摘要（≤80 字，超长截断加 ...），无指令文本回落任务类型
 * 标签（v1 对齐；快照为系统数据，非法形态回落标签不失败——展示性冗余）。
 */
export function instructionBrief(task: GenerationTaskDocument): string {
  const snapshot = task.instruction_snapshot;
  if (snapshot != null && typeof snapshot === 'object') {
    for (const key of BRIEF_KEYS) {
      const value = snapshot[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        const text = value.trim();
        return text.length <= BRIEF_MAX_LENGTH
          ? text
          : `${text.slice(0, BRIEF_MAX_LENGTH)}...`;
      }
    }
  }
  return getTaskTypeLabel(task.task_type);
}

/** 字典批量返回 VO（Record 而非 Map——JSON 序列化安全，v1 Map→Jackson 对象对齐） */
export type GenerationDictBatchVO = Record<string, SelectOption[]>;
