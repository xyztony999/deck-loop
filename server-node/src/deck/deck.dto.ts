import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';
import {
  DeckStatus,
  DeckType,
  getDeckStatusLabel,
  getDeckTypeLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
} from '../common/enums';
import { OperItem, PageQuery, SelectOption } from '../common/result';
import type { DeckDocument } from './schemas/dl_deck.schema';

/**
 * deck 域 AO/VO（api-deck §4.4 契约冻结平移；v1 ao/vo/deck 包逐字对齐）。
 *
 * - AO：class-validator 校验（NR-04：id 格式/枚举值域/长度；whitelist 管道剥未知字段）
 * - VO：_id 不进 VO（NR-08）；*Name 标签冗余与 *Str 时间格式化随 VO 组装（v1 setting() 语义）
 */

/** id 入参格式（NR-04：长度≤32、[A-Za-z0-9_-]） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 时间入参格式：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss（前端 createdTimeArr 拆分） */
const TIME_RANGE_PATTERN = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/** 空串→undefined（可选字段「空=未提供/清除」语义，v1 isBlank 口径） */
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
 * 格式在 DTO Matches 已拦截，此处仅做形状解析。
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
/* AO — 列表                                                           */
/* ------------------------------------------------------------------ */

/** 创作物列表查询 AO（POST /deck/deck/list，api-deck §4.4） */
export class DeckListAO extends PageQuery {
  /** 页码（重声明补校验注解；declare 不重置父类默认值 1/20） */
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

  /** 名称模糊匹配 */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  keyword?: string;

  /** 类型精确匹配（DeckType code） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(DeckType), { message: 'deckType值不合法' })
  deckType?: string;

  /** 状态精确匹配（DeckStatus code） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(DeckStatus), { message: 'deckStatus值不合法' })
  deckStatus?: string;

  /** 归档范围：0/null=默认不含归档，1=仅归档（此时状态筛选强制 ARCHIVED） */
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1], { message: 'archivedScope仅允许0或1' })
  archivedScope?: number;

  /** 创建时间起（前端 createdTimeArr 拆分） */
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

/* ------------------------------------------------------------------ */
/* AO — 保存 / 详情                                                    */
/* ------------------------------------------------------------------ */

/** 创作物保存 AO（POST /deck/deck/save；deckId 空=新建）。
 *  INV-5：deck_name 非空 ≤100、topic 非空 ≤200；
 *  draft_outline 不在保存入口（由 generation 域大纲保存接口维护）。 */
export class DeckSaveAO {
  /** 空=新建；非空=编辑基本信息（仅 DRAFT/ITERATING 态可编辑） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId?: string;

  @IsString({ message: '创作物类型不能为空' })
  @IsIn(Object.values(DeckType), { message: 'deckType值不合法' })
  deckType!: string;

  @IsString({ message: '创作物名称不能为空' })
  @IsNotEmpty({ message: '创作物名称不能为空' })
  @MaxLength(100, { message: '创作物名称不能超过100字符' })
  deckName!: string;

  @IsString({ message: '主题不能为空' })
  @IsNotEmpty({ message: '主题不能为空' })
  @MaxLength(200, { message: '主题不能超过200字符' })
  topic!: string;

  /** 需求描述（可空；空串=清除） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  requirement?: string;

  /** 默认品牌规范（可空=清除；填写时须存在且启用，INV-7） */
  @IsOptional()
  @Transform(blankToUndefined)
  @Matches(ID_PATTERN, { message: 'defaultBrandKitId格式不合法' })
  defaultBrandKitId?: string;
}

/** 创作物详情 AO（POST /deck/deck/detail；withXxx 默认 false） */
export class DeckDetailAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;

  /** 是否加载统计（versionCount/adjustCount/exportCount），默认 false */
  @IsOptional()
  @IsBoolean()
  withStats: boolean = false;

  /** 是否加载最近任务（taskId/taskType/taskStatus），默认 false */
  @IsOptional()
  @IsBoolean()
  withLatestTask: boolean = false;
}

/* ------------------------------------------------------------------ */
/* AO — 状态动作                                                       */
/* ------------------------------------------------------------------ */

/** 状态动作 AO 基类（archive/restore/delete） */
export abstract class DeckActionAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId不能为空' })
  deckId!: string;
}

/** 创作物归档 AO（POST /deck/deck/archive，任意非归档态 → ARCHIVED） */
export class DeckArchiveAO extends DeckActionAO {}

/** 创作物恢复 AO（POST /deck/deck/restore，ARCHIVED → archivedFromStatus） */
export class DeckRestoreAO extends DeckActionAO {}

/** 创作物删除 AO（POST /deck/deck/delete，软删除，仅 ARCHIVED 可删） */
export class DeckDeleteAO extends DeckActionAO {}

/** 定稿 AO（POST /deck/deck/finalize，ITERATING → FINALIZED） */
export class DeckFinalizeAO extends DeckActionAO {
  /** 二次确认（必须 true；false/缺省在 Service 层守卫拒绝） */
  @IsBoolean({ message: 'confirm不能为空' })
  confirm!: boolean;
}

/** 解锁定稿 AO（POST /deck/deck/unfinalize，FINALIZED → ITERATING） */
export class DeckUnfinalizeAO extends DeckActionAO {
  /** 二次确认（必须 true；false/缺省在 Service 层守卫拒绝） */
  @IsBoolean({ message: 'confirm不能为空' })
  confirm!: boolean;
}

/* ------------------------------------------------------------------ */
/* AO — 字典 / 选择池                                                  */
/* ------------------------------------------------------------------ */

/** 枚举字典批量查询 AO（POST /deck/dict/batch；key=deckType/deckStatus） */
export class DeckDictBatchAO {
  @IsArray()
  @ArrayNotEmpty({ message: 'keys不能为空' })
  @IsString({ each: true })
  keys!: string[];
}

/** 创作物 Select 选择池查询 AO（POST /deck/select/deck-list，deck.select.deckList） */
export class DeckSelectListAO {
  /** 名称模糊匹配（可空） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  keyword?: string;

  /** 状态精确匹配（可空；缺省返回全部非归档） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(Object.values(DeckStatus), { message: 'deckStatus值不合法' })
  deckStatus?: string;
}

/* ------------------------------------------------------------------ */
/* VO                                                                  */
/* ------------------------------------------------------------------ */

/** 创作物保存返回 VO（新建/编辑） */
export class DeckSaveVO {
  deckId!: string;
  deckCode!: string;

  static of(deckId: string, deckCode: string): DeckSaveVO {
    const vo = new DeckSaveVO();
    vo.deckId = deckId;
    vo.deckCode = deckCode;
    return vo;
  }
}

/** 创作物列表行 VO（api-deck §4.4 行字段清单，v1 DeckListVO 逐字对齐） */
export class DeckListVO {
  deckId!: string;
  deckCode!: string;
  deckName!: string;
  deckType!: string;
  deckTypeName!: string;
  topic!: string;
  deckStatus!: string;
  deckStatusName!: string;
  /** 当前版本谱系序号（DRAFT 无版本时为 null） */
  currentVersionSeq!: number | null;
  versionCount!: number;
  adjustCount!: number;
  activeBranch!: string;
  defaultBrandKitId!: string | null;
  defaultBrandKitName!: string | null;
  /** 是否存在进行中任务（finalize/archive 操作可见性标志） */
  hasRunningTask!: boolean;
  /** 属主判断必需（operList isOwner，v1 06-oper-column 链路） */
  createdBy!: string | null;
  createdTime!: Date | null;
  updatedTime!: Date | null;
  createdTimeStr!: string | null;
  updatedTimeStr!: string | null;
  /** 操作列（Service 注入，v1 setting() 语义） */
  operList: OperItem[] = [];

  static of(
    deck: DeckDocument,
    extras: {
      currentVersionSeq: number | null;
      versionCount: number;
      adjustCount: number;
      defaultBrandKitName: string | null;
      hasRunningTask: boolean;
      operList: OperItem[];
    },
  ): DeckListVO {
    const vo = new DeckListVO();
    vo.deckId = deck.deck_id;
    vo.deckCode = deck.deck_code;
    vo.deckName = deck.deck_name;
    vo.deckType = deck.deck_type;
    vo.deckTypeName = getDeckTypeLabel(deck.deck_type);
    vo.topic = deck.topic;
    vo.deckStatus = deck.deck_status;
    vo.deckStatusName = getDeckStatusLabel(deck.deck_status);
    vo.currentVersionSeq = extras.currentVersionSeq;
    vo.versionCount = extras.versionCount;
    vo.adjustCount = extras.adjustCount;
    vo.activeBranch = deck.active_branch;
    vo.defaultBrandKitId = deck.default_brand_kit_id ?? null;
    vo.defaultBrandKitName = extras.defaultBrandKitName;
    vo.hasRunningTask = extras.hasRunningTask;
    vo.createdBy = deck.created_by ?? null;
    vo.createdTime = deck.created_time ?? null;
    vo.updatedTime = deck.updated_time ?? null;
    vo.createdTimeStr = formatDateTime(deck.created_time);
    vo.updatedTimeStr = formatDateTime(deck.updated_time);
    vo.operList = extras.operList;
    return vo;
  }
}

/** 创作物详情 VO（主表全字段 + brandKitName 冗余 + stats/latestTask 开关 + operList） */
export class DeckDetailVO {
  deckId!: string;
  deckCode!: string;
  deckName!: string;
  deckType!: string;
  deckTypeName!: string;
  topic!: string;
  requirement!: string | null;
  deckStatus!: string;
  deckStatusName!: string;
  /** 草稿大纲（节点树整体嵌入 object；首个版本生成后只读） */
  draftOutline!: Record<string, unknown> | null;
  defaultBrandKitId!: string | null;
  /** 品牌规范名称冗余展示（常驻，不随 withStats 开关） */
  defaultBrandKitName!: string | null;
  currentVersionId!: string | null;
  activeBranch!: string;
  finalVersionId!: string | null;
  archivedFromStatus!: string | null;
  archivedFromStatusName!: string | null;
  userId!: string;
  createdBy!: string | null;
  createdName!: string | null;
  createdTime!: Date | null;
  updatedBy!: string | null;
  updatedName!: string | null;
  updatedTime!: Date | null;
  dataVersion!: number;
  createdTimeStr!: string | null;
  updatedTimeStr!: string | null;
  /** 是否存在进行中任务（operList 计算输入，常驻） */
  hasRunningTask!: boolean;
  /** 统计块（withStats=true 加载） */
  stats: DeckDetailStats | null = null;
  /** 最近任务块（withLatestTask=true 加载；无任务为 null） */
  latestTask: DeckDetailLatestTask | null = null;
  /** 操作列（Service 注入） */
  operList: OperItem[] = [];

  static of(
    deck: DeckDocument,
    extras: {
      defaultBrandKitName: string | null;
      hasRunningTask: boolean;
      stats?: DeckDetailStats;
      latestTask?: DeckDetailLatestTask | null;
      operList: OperItem[];
    },
  ): DeckDetailVO {
    const vo = new DeckDetailVO();
    vo.deckId = deck.deck_id;
    vo.deckCode = deck.deck_code;
    vo.deckName = deck.deck_name;
    vo.deckType = deck.deck_type;
    vo.deckTypeName = getDeckTypeLabel(deck.deck_type);
    vo.topic = deck.topic;
    vo.requirement = deck.requirement ?? null;
    vo.deckStatus = deck.deck_status;
    vo.deckStatusName = getDeckStatusLabel(deck.deck_status);
    vo.draftOutline = deck.draft_outline ?? null;
    vo.defaultBrandKitId = deck.default_brand_kit_id ?? null;
    vo.defaultBrandKitName = extras.defaultBrandKitName;
    vo.currentVersionId = deck.current_version_id ?? null;
    vo.activeBranch = deck.active_branch;
    vo.finalVersionId = deck.final_version_id ?? null;
    vo.archivedFromStatus = deck.archived_from_status ?? null;
    vo.archivedFromStatusName =
      deck.archived_from_status != null ? getDeckStatusLabel(deck.archived_from_status) : null;
    vo.userId = deck.user_id;
    vo.createdBy = deck.created_by ?? null;
    vo.createdName = deck.created_name ?? null;
    vo.createdTime = deck.created_time ?? null;
    vo.updatedBy = deck.updated_by ?? null;
    vo.updatedName = deck.updated_name ?? null;
    vo.updatedTime = deck.updated_time ?? null;
    vo.dataVersion = deck.data_version;
    vo.createdTimeStr = formatDateTime(deck.created_time);
    vo.updatedTimeStr = formatDateTime(deck.updated_time);
    vo.hasRunningTask = extras.hasRunningTask;
    vo.stats = extras.stats ?? null;
    vo.latestTask = extras.latestTask ?? null;
    vo.operList = extras.operList;
    return vo;
  }
}

/** 统计块（withStats，api-deck §4.4） */
export class DeckDetailStats {
  versionCount!: number;
  adjustCount!: number;
  exportCount!: number;

  static of(versionCount: number, adjustCount: number, exportCount: number): DeckDetailStats {
    const stats = new DeckDetailStats();
    stats.versionCount = versionCount;
    stats.adjustCount = adjustCount;
    stats.exportCount = exportCount;
    return stats;
  }
}

/** 最近任务块（withLatestTask，v1 LatestTask 含标签冗余） */
export class DeckDetailLatestTask {
  taskId!: string;
  taskType!: string;
  taskTypeName!: string;
  taskStatus!: string;
  taskStatusName!: string;

  static of(taskId: string, taskType: string, taskStatus: string): DeckDetailLatestTask {
    const vo = new DeckDetailLatestTask();
    vo.taskId = taskId;
    vo.taskType = taskType;
    vo.taskTypeName = getTaskTypeLabel(taskType);
    vo.taskStatus = taskStatus;
    vo.taskStatusName = getTaskStatusLabel(taskStatus);
    return vo;
  }
}

/** 字典批量返回 VO（Record 而非 Map——JSON 序列化安全，v1 Map→Jackson 对象对齐） */
export type DeckDictBatchVO = Record<string, SelectOption[]>;
