import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { getVersionSourceTypeLabel } from '../common/enums';
import { OperItem, SelectOption } from '../common/result';
import type { DeckVersionDocument } from './schemas/dl_deck_version.schema';

/**
 * version 域 AO/VO（api-version §4.4 契约冻结平移；v1 ao/vo/version 包逐字对齐）。
 *
 * - AO：class-validator 校验（NR-04：id 格式/枚举值域/长度；whitelist 管道剥未知字段）
 * - VO：_id 不进 VO（NR-08）；*Name 标签冗余与 *Str 时间格式化随 VO 组装（v1 setting() 语义）；
 *   content/instruction_snapshot 为整体嵌入 object（D5 全自管 Mixed，api-version §5.3）
 */

/** id 入参格式（NR-04：长度≤32、[A-Za-z0-9_-]；与 deck 域同口径） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

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

/* ------------------------------------------------------------------ */
/* changeKind 常量（过程数据，未入枚举池——domain-manifest §12 已知缺口）  */
/* ------------------------------------------------------------------ */

/** 页级/块级差异类型（api-version §4.4 compare） */
export const CHANGE_KIND_NONE = 'NONE';
export const CHANGE_KIND_STRUCTURE = 'STRUCTURE';
export const CHANGE_KIND_TEXT = 'TEXT';
export const CHANGE_KIND_IMAGE = 'IMAGE';
export const CHANGE_KIND_NEW = 'NEW';
export const CHANGE_KIND_REMOVED = 'REMOVED';

/** branchScope 值域（ALL/ACTIVE，默认 ACTIVE） */
export const BRANCH_SCOPE_ALL = 'ALL';
export const BRANCH_SCOPE_ACTIVE = 'ACTIVE';

/* ------------------------------------------------------------------ */
/* AO — 树 / 详情 / 对比 / 回退 / 分叉                                  */
/* ------------------------------------------------------------------ */

/** 版本树查询 AO（POST /ver/version/tree；branchScope ACTIVE=仅活动分支谱系，ALL=全量） */
export class VersionTreeAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;

  /** 分支范围：ALL/ACTIVE，默认 ACTIVE（branches[] 分支列表不受该开关影响） */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn([BRANCH_SCOPE_ALL, BRANCH_SCOPE_ACTIVE], { message: 'branchScope仅支持ALL或ACTIVE' })
  branchScope: string = BRANCH_SCOPE_ACTIVE;
}

/** 版本详情 AO（POST /ver/version/detail；归属校验=deck→version 级联，api-version §3.3） */
export class VersionDetailAO {
  @IsString({ message: 'versionId不能为空' })
  @Matches(ID_PATTERN, { message: 'versionId格式不合法' })
  versionId!: string;
}

/** 双版本对比 AO（POST /ver/version/compare；同版本比较拒绝 BIZ_VERSION_SAME_COMPARE） */
export class VersionCompareAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;

  @IsString({ message: 'leftVersionId不能为空' })
  @Matches(ID_PATTERN, { message: 'leftVersionId格式不合法' })
  leftVersionId!: string;

  @IsString({ message: 'rightVersionId不能为空' })
  @Matches(ID_PATTERN, { message: 'rightVersionId格式不合法' })
  rightVersionId!: string;
}

/** 版本回退 AO（POST /ver/version/rollback；回退=移当前指针，Deck 须 ITERATING，历史不动） */
export class VersionRollbackAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;

  @IsString({ message: 'versionId不能为空' })
  @Matches(ID_PATTERN, { message: 'versionId格式不合法' })
  versionId!: string;

  /** 二次确认，必须 true（false/缺省在 Service 层守卫拒绝） */
  @IsOptional()
  @IsBoolean()
  confirm: boolean = false;
}

/** 版本分叉 AO（POST /ver/version/fork；branchName 同 deck 唯一 INV-12，分叉头=versionId） */
export class VersionForkAO {
  @IsString({ message: 'deckId不能为空' })
  @Matches(ID_PATTERN, { message: 'deckId格式不合法' })
  deckId!: string;

  @IsString({ message: 'versionId不能为空' })
  @Matches(ID_PATTERN, { message: 'versionId格式不合法' })
  versionId!: string;

  /** 新分支名（同 deck 唯一；≤50） */
  @IsString({ message: 'branchName不能为空' })
  @IsNotEmpty({ message: 'branchName不能为空' })
  @MaxLength(50, { message: 'branchName长度不能超过50' })
  branchName!: string;
}

/* ------------------------------------------------------------------ */
/* AO — 字典                                                           */
/* ------------------------------------------------------------------ */

/** version 域枚举字典批量查询 AO（POST /ver/dict/batch；key=versionSourceType） */
export class VersionDictBatchAO {
  @IsArray()
  @ArrayNotEmpty({ message: 'keys不能为空' })
  @IsString({ each: true })
  keys!: string[];
}

/* ------------------------------------------------------------------ */
/* 跨域契约入参 — VersionArchiveCommand（manifest §10，v1 ao 平移）      */
/* ------------------------------------------------------------------ */

/**
 * 版本留档命令（跨域进程内直调入参，供 generation 域任务成功回调调用；
 * v1 VersionArchiveCommand 对齐——非 HTTP AO（网关回调线程无会话上下文），
 * userId 必须显式传入（ADR-005 隔离字段）。
 *
 * forkBranchName 语义（v1 修复后的 applyForkFromSnapshot 链）：调整任务指令快照
 * 解析出的 forkBranchName 由 generation 侧在回调组装 command 时填入 branchName
 * （≠活动分支=分叉留档：新分支首版本，D3）；常规留档留空。
 */
export class VersionArchiveCommand {
  /** 归属创作物（必填） */
  deckId!: string;

  /** 属主（必填，隔离字段 ADR-005；回调线程无会话上下文） */
  userId!: string;

  /** 来源任务（必填，dl_generation_task.task_id） */
  taskId!: string;

  /** 来源类型（必填，VersionSourceType code：FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST） */
  sourceType!: string;

  /** 来源指令/入参快照（必填，整体嵌入 object，含 scope/brand/assetIds/outline 快照） */
  instructionSnapshot!: Record<string, unknown>;

  /** 页面树快照（必填：pages[]→blocks[]，api-version §4.1 content 契约） */
  content!: Record<string, unknown>;

  /** 父版本（可空；空=取 Deck.currentVersionId，首版为 null。分叉留档=快照 baseVersionId） */
  parentVersionId?: string | null;

  /** 分支名（可空；空=Deck.activeBranch 常规留档不换分支。非空且≠活动分支=分叉留档） */
  branchName?: string | null;
}

/** 留档结果（manifest §10：{ versionId, versionSeq }） */
export class VersionArchiveResult {
  versionId!: string;
  versionSeq!: number;

  static of(versionId: string, versionSeq: number): VersionArchiveResult {
    const result = new VersionArchiveResult();
    result.versionId = versionId;
    result.versionSeq = versionSeq;
    return result;
  }
}

/** content 快照（getVersionContent 返回形态；pages[]→blocks[] 值对象树整体） */
export type ContentSnapshot = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* VO — 版本树                                                          */
/* ------------------------------------------------------------------ */

/** 版本谱系树 VO（POST /ver/version/tree；tree 节点递归 + branches 全量分支列表） */
export class VersionTreeVO {
  deckId!: string;
  /** Deck 状态（operList 计算输入，随树返回供前端禁用判断） */
  deckStatus!: string;
  /** 活动分支 */
  activeBranch!: string;
  /** 当前版本指针 */
  currentVersionId!: string | null;
  /** 定稿版本（INV-2，FINALIZED 必有值） */
  finalVersionId!: string | null;
  /** 谱系树根节点列表（根=parent 为空或父节点被 branchScope 过滤的版本） */
  tree: VersionTreeNode[] = [];
  /** 分支列表（全量，不受 branchScope 影响） */
  branches: VersionTreeBranch[] = [];

  static of(
    deckId: string,
    deckStatus: string,
    activeBranch: string,
    currentVersionId: string | null,
    finalVersionId: string | null,
    tree: VersionTreeNode[],
    branches: VersionTreeBranch[],
  ): VersionTreeVO {
    const vo = new VersionTreeVO();
    vo.deckId = deckId;
    vo.deckStatus = deckStatus;
    vo.activeBranch = activeBranch;
    vo.currentVersionId = currentVersionId;
    vo.finalVersionId = finalVersionId;
    vo.tree = tree;
    vo.branches = branches;
    return vo;
  }
}

/** 树节点（版本摘要行，v1 VersionTreeVO.Node 对齐） */
export class VersionTreeNode {
  versionId!: string;
  versionSeq!: number;
  branchName!: string;
  sourceType!: string;
  /** sourceType 中文标签（setting 填充） */
  sourceTypeName!: string;
  /** 来源指令摘要（instruction_snapshot 提取，≤60 字） */
  instructionBrief!: string | null;
  /** 来源任务状态（TaskStatus code，树浏览展示） */
  taskStatusOfSource!: string | null;
  createdTime!: Date | null;
  createdTimeStr!: string | null;
  /** 是否当前指针版本（deck.currentVersionId） */
  isCurrent!: boolean;
  /** 是否定稿版本（deck.finalVersionId） */
  isFinal!: boolean;
  /** 属主判断必需（v1 06-oper-column 链路） */
  createdBy!: string | null;
  /** 操作列（Service 注入：set-current/fork-from/export-from，由 Deck 状态驱动） */
  operList: OperItem[] = [];
  /** 子版本（按 versionSeq 升序） */
  children: VersionTreeNode[] = [];
}

/** 分支行（v1 VersionTreeVO.Branch 对齐） */
export class VersionTreeBranch {
  branchName!: string;
  /** 分支头版本（分支内 versionSeq 最大者；空分支为空） */
  headVersionId!: string | null;
  versionCount!: number;
  /** 是否活动分支（deck.activeBranch） */
  isActive!: boolean;
}

/* ------------------------------------------------------------------ */
/* VO — 版本详情                                                        */
/* ------------------------------------------------------------------ */

/** 版本详情 VO（POST /ver/version/detail；全字段 + content 完整 JSON，前端按页虚拟渲染） */
export class VersionDetailVO {
  versionId!: string;
  deckId!: string;
  versionSeq!: number;
  branchName!: string;
  /** 父版本（首版为空） */
  parentVersionId!: string | null;
  sourceType!: string;
  sourceTypeName!: string;
  /** 来源任务 */
  taskId!: string;
  /** 来源指令/入参快照（整体嵌入 object 原样返回） */
  instructionSnapshot!: Record<string, unknown>;
  /** 页面树快照完整 JSON（pages[]→blocks[]，object 形态） */
  content!: Record<string, unknown>;
  contentHash!: string;
  pageCount!: number;
  userId!: string;
  createdBy!: string | null;
  createdName!: string | null;
  createdTime!: Date | null;
  createdTimeStr!: string | null;

  static of(version: DeckVersionDocument): VersionDetailVO {
    const vo = new VersionDetailVO();
    vo.versionId = version.version_id;
    vo.deckId = version.deck_id;
    vo.versionSeq = version.version_seq;
    vo.branchName = version.branch_name;
    vo.parentVersionId = version.parent_version_id ?? null;
    vo.sourceType = version.source_type;
    vo.sourceTypeName = getVersionSourceTypeLabel(version.source_type);
    vo.taskId = version.task_id;
    vo.instructionSnapshot = version.instruction_snapshot;
    vo.content = version.content;
    vo.contentHash = version.content_hash;
    vo.pageCount = version.page_count;
    vo.userId = version.user_id;
    vo.createdBy = version.created_by ?? null;
    vo.createdName = version.created_name ?? null;
    vo.createdTime = version.created_time ?? null;
    vo.createdTimeStr = formatDateTime(version.created_time);
    return vo;
  }
}

/* ------------------------------------------------------------------ */
/* VO — 双版本对比                                                      */
/* ------------------------------------------------------------------ */

/** 双版本对比 VO（POST /ver/version/compare；P7 过程数据，实时计算不落库 D4） */
export class VersionCompareVO {
  deckId!: string;
  leftVersionId!: string;
  rightVersionId!: string;
  /** content_hash 相同（true 时 pages 全部为 NONE，可前端短路） */
  sameHash!: boolean;
  /** 逐页差异（按左版本页序，右版本新增页追加于后） */
  pages: VersionComparePageDiff[] = [];

  static of(
    deckId: string,
    leftVersionId: string,
    rightVersionId: string,
    sameHash: boolean,
    pages: VersionComparePageDiff[],
  ): VersionCompareVO {
    const vo = new VersionCompareVO();
    vo.deckId = deckId;
    vo.leftVersionId = leftVersionId;
    vo.rightVersionId = rightVersionId;
    vo.sameHash = sameHash;
    vo.pages = pages;
    return vo;
  }
}

/** 页差异行（PageDiff 嵌套，api-version §4.4） */
export class VersionComparePageDiff {
  pageId!: string;
  /** 左版本页下标（0 起；右版本新增页为 null） */
  leftIndex!: number | null;
  /** 右版本页下标（0 起；左版本被移除页为 null） */
  rightIndex!: number | null;
  /** 页级差异类型（NONE/STRUCTURE/TEXT/IMAGE/NEW/REMOVED） */
  changeKind!: string;
  /** 块级差异（仅变更块；NONE 页为空列表） */
  diffBlocks: VersionCompareBlockDiff[] = [];

  static of(
    pageId: string,
    leftIndex: number | null,
    rightIndex: number | null,
    changeKind: string,
    diffBlocks: VersionCompareBlockDiff[],
  ): VersionComparePageDiff {
    const diff = new VersionComparePageDiff();
    diff.pageId = pageId;
    diff.leftIndex = leftIndex;
    diff.rightIndex = rightIndex;
    diff.changeKind = changeKind;
    diff.diffBlocks = diffBlocks;
    return diff;
  }
}

/** 块差异行（BlockDiff 嵌套） */
export class VersionCompareBlockDiff {
  blockId!: string;
  /** 块级差异类型（NEW/REMOVED/STRUCTURE/TEXT/IMAGE） */
  changeKind!: string;

  static of(blockId: string, changeKind: string): VersionCompareBlockDiff {
    const diff = new VersionCompareBlockDiff();
    diff.blockId = blockId;
    diff.changeKind = changeKind;
    return diff;
  }
}

/** 字典批量返回 VO（Record 而非 Map——JSON 序列化安全，v1 Map→Jackson 对齐） */
export type VersionDictBatchVO = Record<string, SelectOption[]>;

/** content/instruction_snapshot 对象判定（Mixed 嵌入契约；ArchiveService 命令校验用） */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
