import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TargetKind, getTaskStatusLabel } from '../common/enums';
import { SelectOption } from '../common/result';
import type { GenerationTaskCreateResult } from '../generation/generation.dto';

/**
 * adjustment 域 AO/VO（api-adjustment §4.4 契约冻结平移；v1 ao/vo/adjust 包逐字对齐）。
 *
 * - AO：class-validator 校验（NR-04：id 格式/枚举值域/长度；whitelist 管道剥未知字段）
 * - VO：_id 不进 VO（NR-08，本域无自有 collection 亦无 _id 暴露面）；
 *   *Name 标签冗余随 VO 组装（v1 setting() 语义）
 * - 值对象契约（§4.1 instruction_snapshot adjust 节）由 Service 组装，
 *   DTO 层仅承载 HTTP 入参/出参
 */

/** id 入参格式（NR-04：长度≤32、[A-Za-z0-9_-]；与 deck/version/generation 域同口径） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 空串→undefined（可选字段「空=未提供」语义，v1 isBlank 口径） */
const blankToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

/* ------------------------------------------------------------------ */
/* AO — 目标定位 / 提交 / 校验 / 字典                                   */
/* ------------------------------------------------------------------ */

/**
 * 定向调整目标定位坐标（targetPath 值对象，api-adjustment §4.1）。
 * 契约：{pageId}（TargetKind=PAGE）或 {pageId, blockId}（TEXT_BLOCK/IMAGE_BLOCK）；
 * 结构化承载于 instruction_snapshot 的 adjust 节（ADR-008，不落自有表）。
 */
export class AdjustTargetPathAO {
  /** 目标页（必填；dl_deck_version.content pages[].pageId） */
  @IsString({ message: 'pageId不能为空' })
  @IsNotEmpty({ message: 'pageId不能为空' })
  @MaxLength(32, { message: 'pageId不能超过32字符' })
  pageId!: string;

  /** 目标块（TEXT_BLOCK/IMAGE_BLOCK 必填，PAGE 须为空；pages[].blocks[].blockId） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(32, { message: 'blockId不能超过32字符' })
  blockId?: string;
}

/** 整稿调整提交 AO（POST /adjust/whole/submit；D3 分叉 confirm/branchName 语义见 Service） */
export class WholeAdjustSubmitAO {
  @IsString({ message: '创作物ID不能为空' })
  @Matches(ID_PATTERN, { message: '创作物ID格式不合法' })
  deckId!: string;

  /** 基线版本（提交即锁定：快照进 instruction_snapshot，api-adjustment §3.2） */
  @IsString({ message: '基线版本ID不能为空' })
  @Matches(ID_PATTERN, { message: '基线版本ID格式不合法' })
  baseVersionId!: string;

  /** 指令文本（≤2000；INV-10：{占位符} 须全部替换） */
  @IsString({ message: '调整指令不能为空' })
  @IsNotEmpty({ message: '调整指令不能为空' })
  @MaxLength(2000, { message: '调整指令不能超过2000字符' })
  instructionText!: string;

  /** 品牌约束开关（默认 false） */
  @IsOptional()
  @IsBoolean()
  applyBrandKit?: boolean;

  /** 品牌规范（apply=true 时生效；空=取 Deck 默认规范，启用态校验） */
  @IsOptional()
  @Transform(blankToUndefined)
  @Matches(ID_PATTERN, { message: '品牌规范ID格式不合法' })
  brandKitId?: string;

  /** 话术模板来源记录（存在性校验；服务端仅记录不取正文，api-adjustment §1.5） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '话术模板不能超过10个' })
  @IsString({ each: true, message: '话术模板ID必须为字符串' })
  @MaxLength(32, { each: true, message: '话术模板ID不能超过32字符' })
  usedTemplateIds?: string[];

  /** 基线≠当前时是否确认分叉（默认 false=仅提示不下任务） */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  /** 分叉分支名（confirm=true 必填，同 deck 唯一，早期冲突拦截；≤50） */
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '分叉分支名不能超过50字符' })
  branchName?: string;
}

/**
 * 定向调整提交 AO（POST /adjust/targeted/submit）。
 * 较整稿调整增 targetKind/targetPath；INV-9 等价 /adjust/scope/validate 内联执行；
 * 其余校验与分叉语义同 WholeAdjustSubmitAO（v1 TargetedAdjustSubmitAO 全字段对齐）。
 */
export class TargetedAdjustSubmitAO extends WholeAdjustSubmitAO {
  /** 目标作用域类型（TargetKind：PAGE/TEXT_BLOCK/IMAGE_BLOCK） */
  @IsString({ message: 'targetKind不能为空' })
  @IsNotEmpty({ message: 'targetKind不能为空' })
  @IsIn(Object.values(TargetKind), { message: 'targetKind非法（PAGE/TEXT_BLOCK/IMAGE_BLOCK）' })
  targetKind!: string;

  /** 目标定位坐标（{pageId} 或 {pageId, blockId}，INV-9 内联校验） */
  @IsObject({ message: 'targetPath不能为空' })
  @ValidateNested()
  @Type(() => AdjustTargetPathAO)
  targetPath!: AdjustTargetPathAO;
}

/** 目标作用域校验 AO（POST /adjust/scope/validate；D4 提交前独立拦截） */
export class AdjustScopeValidateAO {
  @IsString({ message: '创作物ID不能为空' })
  @Matches(ID_PATTERN, { message: '创作物ID格式不合法' })
  deckId!: string;

  /** 待校验版本（提交时即 baseVersionId） */
  @IsString({ message: '版本ID不能为空' })
  @Matches(ID_PATTERN, { message: '版本ID格式不合法' })
  versionId!: string;

  @IsString({ message: 'targetKind不能为空' })
  @IsNotEmpty({ message: 'targetKind不能为空' })
  @IsIn(Object.values(TargetKind), { message: 'targetKind非法（PAGE/TEXT_BLOCK/IMAGE_BLOCK）' })
  targetKind!: string;

  @IsObject({ message: 'targetPath不能为空' })
  @ValidateNested()
  @Type(() => AdjustTargetPathAO)
  targetPath!: AdjustTargetPathAO;
}

/** 枚举字典批量查询 AO（POST /adjust/dict/batch；key=targetKind） */
export class AdjustDictBatchAO {
  @IsArray({ message: 'keys不能为空' })
  @ArrayNotEmpty({ message: 'keys不能为空' })
  @IsString({ each: true })
  keys!: string[];
}

/* ------------------------------------------------------------------ */
/* 指令快照常量（api-adjustment §4.1 值对象字段名，契约冻结）            */
/* ------------------------------------------------------------------ */

/** 快照指令文本双 key：instruction（generation BRIEF_KEYS 摘要首选）+ §4.1 字段名 */
export const SNAPSHOT_KEY_INSTRUCTION = 'instruction';

/** 话术模板占位符形态（dl_prompt_template.content「含 {占位符}」；INV-10） */
export const PLACEHOLDER_PATTERN = /\{[^{}]*\}/;

/** content 契约块类型（api-version §4.1：TEXT/IMAGE/PLACEHOLDER；比较不区分大小写，
 * 设计文档大小写并存，按不敏感匹配兼容——v1 同注记） */
export const BLOCK_TYPE_TEXT = 'TEXT';
export const BLOCK_TYPE_IMAGE = 'IMAGE';

/* ------------------------------------------------------------------ */
/* VO                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 调整提交返回 VO（POST /adjust/whole/submit、/adjust/targeted/submit）：
 * taskId/taskCode/taskStatus/forked；基线≠当前未确认时 needForkBranch=true
 * 提示态返回（不产生任务，taskId=null）。任务跟踪/取消/重试复用 /gen/task/*。
 */
export class AdjustSubmitVO {
  /** 新任务 ID（needForkBranch=true 提示态为 null，未创建任务） */
  taskId!: string | null;
  /** 规则编码（GT+yyMMdd+4位，generation 域创建链分配） */
  taskCode!: string | null;
  /** 初始状态（QUEUED；提示态为 null） */
  taskStatus!: string | null;
  taskStatusName!: string | null;
  /** 本次提交是否为「从基线分叉调整」（D3：基线≠当前且 confirm=true） */
  forked!: boolean;
  /** 基线≠当前版本且未 confirm：true=提示前端命名分支后重提 */
  needForkBranch!: boolean;
  /** 分叉分支名（forked=true 时回显；提示态为 null） */
  branchName!: string | null;

  static of(
    created: GenerationTaskCreateResult,
    forked: boolean,
    branchName: string | null,
  ): AdjustSubmitVO {
    const vo = new AdjustSubmitVO();
    vo.taskId = created.taskId;
    vo.taskCode = created.taskCode;
    vo.taskStatus = created.taskStatus;
    vo.taskStatusName = getTaskStatusLabel(created.taskStatus);
    vo.forked = forked;
    vo.needForkBranch = false;
    vo.branchName = branchName;
    return vo;
  }

  /** 分叉提示态（confirm=false 拒绝提交）：不创建任务，仅回提示（v1 forkPromptVO 对齐） */
  static forkPrompt(): AdjustSubmitVO {
    const vo = new AdjustSubmitVO();
    vo.taskId = null;
    vo.taskCode = null;
    vo.taskStatus = null;
    vo.taskStatusName = null;
    vo.forked = false;
    vo.needForkBranch = true;
    vo.branchName = null;
    return vo;
  }
}

/**
 * 目标作用域校验返回 VO（POST /adjust/scope/validate）：valid(bool)、targetSummary
 * （页码+块摘要，供 UI 回显）。invalid 的原因定位走业务异常
 * （BIZ_ADJUST_SCOPE_INVALID），valid=true 时本 VO 携带定位摘要。
 */
export class AdjustScopeValidateVO {
  /** 作用域是否有效（true=可提交定向调整） */
  valid!: boolean;
  /** 目标类型（回显） */
  targetKind!: string;
  targetKindName!: string | null;
  /** 定位页 ID */
  pageId!: string;
  /** 页序号（1 起，基线内容快照内的顺序） */
  pageNo!: number;
  /** 页标题（快照 pages[].title，可空） */
  pageTitle!: string | null;
  /** 定位块 ID（PAGE 作用域为 null） */
  blockId!: string | null;
  /** 块类型（TEXT/IMAGE；PAGE 作用域为 null） */
  blockType!: string | null;
  /** 摘要（页码+块摘要，供 UI 回显，如「第3页「竞品对比」· 文本块」） */
  targetSummary!: string;
}

/** 字典批量返回 VO（Record 而非 Map——JSON 序列化安全，v1 Map→Jackson 对象对齐） */
export type AdjustDictBatchVO = Record<string, SelectOption[]>;
