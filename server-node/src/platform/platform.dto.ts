import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SyncChangeOpCode } from '../common/enums/sync-change-op';
import { OperItem } from '../common/result';
import type { ApiToken } from './schemas/api-token.schema';

/**
 * platform 域 AO/VO —— 契约来源：api-platform §4.4（v1 冻结，字段名/类型/可空性禁增删改）。
 * v1 AO/VO 平移：AccountRegisterAO/VO、AccountLoginAO/VO、AccountLogoutAO、
 * AccountProfileAO/VO、SyncPullAO/VO、SyncChangeVO。
 * `_id`(ObjectId) 不进任何 VO（NR-08）；password_hash 不下发（脱敏）。
 *
 * 校验分层说明：
 * - AO 字段统一 @IsOptional()+@IsString()——仅为通过 ValidationPipe whitelist
 *   （无装饰器的字段会被剥离），**语义校验（邮箱格式/密码 8~64/昵称 ≤64）留在
 *   AccountService**：v1 这些错误回 BIZ_AUTH_CREDENTIALS 业务码（契约错误码冻结，
 *   管道硬校验会退化为通用 '参数错误'/500，偏离 v1）；
 * - sync/pull 的 lastCursor 为纯数值游标，管道 @IsInt+@Min 校验（越界=参数错误，
 *   与 v1 Jackson Long 反序列化失败同语义）。
 */

/* ================= 账号（P-02，/auth/account/*） ================= */

/** 注册入参（@Public；语义校验见 AccountService#validateRegister，v1 对齐） */
export class AccountRegisterAO {
  /** 邮箱（格式校验，全局唯一 INV-24） */
  @IsOptional()
  @IsString()
  email?: string;

  /** 密码明文（仅本次请求内存内存在；≥8 位；落库前哈希） */
  @IsOptional()
  @IsString()
  password?: string;

  /** 昵称（≤64 字） */
  @IsOptional()
  @IsString()
  nickname?: string;
}

/** 注册返回 */
export class AccountRegisterVO {
  /** 账号 ID */
  accountId!: string;
  /** 昵称 */
  nickname!: string;
}

/** 登录入参（@Public；空参回 BIZ_AUTH_CREDENTIALS，见 AccountService#login） */
export class AccountLoginAO {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

/** 登录返回 */
export class AccountLoginVO {
  /** 会话 token（30 天滑动） */
  token!: string;
  /** 昵称 */
  nickname!: string;
  /** 同步游标初始值（当前服务端水位，客户端后续增量拉取起点） */
  syncCursor!: number;
}

/** 退出入参（token 可空：缺省时撤销当前会话头） */
export class AccountLogoutAO {
  @IsOptional()
  @IsString()
  token?: string;
}

/** 账户资料入参（读/改昵称合一：nickname 空=只读；非空 ≤64 字=更新） */
export class AccountProfileAO {
  @IsOptional()
  @IsString()
  nickname?: string;
}

/** 账户资料返回（不含 passwordHash） */
export class AccountProfileVO {
  accountId!: string;
  email!: string;
  nickname!: string;
  /** AccountStatus.code */
  accountStatus!: string;
  /** 状态中文名 */
  accountStatusName!: string;
  /** 最近登录时间（v1 Jackson LocalDateTime 序列化对齐：本地时区 yyyy-MM-ddTHH:mm:ss） */
  lastLoginAt!: string | null;
  /** 滑动续期新 token（未到续期窗口为 null，客户端静默替换） */
  refreshedToken!: string | null;
}

/* ================= 多端增量同步（P-02，/auth/sync/pull） ================= */

/** 同步拉取入参 */
export class SyncPullAO {
  /** 上次游标（首次 0；服务端各 collection 单调毫秒水位） */
  @IsOptional()
  @IsInt()
  @Min(0)
  lastCursor?: number;

  /**
   * 上页末条位置 `AGGREGATE:id`（F07 复合游标增量可选字段——与 lastCursor
   * 组成可续传全序，同毫秒 >200 条不再漏行；旧客户端不传时退化为纯 $gt 毫秒）。
   */
  @IsOptional()
  @IsString()
  @Matches(/^([A-Z_]+):([A-Za-z0-9_-]{1,32})$/, { message: 'lastPosition 格式必须为 AGGREGATE:id' })
  lastPosition?: string;
}

/** 单条同步变更项（changes[] 元素） */
export class SyncChangeVO {
  /** 变更聚合：DECK/VERSION/TASK/ASSET/BRANDKIT/PROMPT/EXPORT（ADR-018 去 PREFERENCE；TASK 历史只读） */
  aggregate!: string;
  /** 变更类型：SyncChangeOp（UPSERT/DELETE） */
  op!: SyncChangeOpCode;
  /** 聚合行业务主键 */
  id!: string;
  /** 该行游标（updated_time 毫秒，单调） */
  cursor!: number;
  /** 载荷摘要/全量（JSON 字符串，各聚合扫描器组装） */
  payload!: string;
}

/** 同步拉取返回 */
export class SyncPullVO {
  /** 变更列表（单页 ≤200，按 (cursor, aggregate, id) 升序） */
  changes!: SyncChangeVO[];
  /** 新游标（本页最后一条 cursor；无变更回传 lastCursor） */
  newCursor!: number;
  /** 新位置 `AGGREGATE:id`（F07 复合游标：本页末条位置；无变更回传入参/缺省） */
  newPosition?: string;
  /** 是否还有更多变更 */
  hasMore!: boolean;
}

/* ================= 个人 API token（P-02 增量，/auth/token/*；api-web-agent §4.1，ADR-018） ================= */

/** id 入参格式（NR-04：长度≤32、[A-Za-z0-9_-]；与 deck/version 域同口径） */
const TOKEN_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Date → 'yyyy-MM-dd HH:mm:ss'（本地时区；与 version 域 VO 时间格式同口径） */
function formatDateTime(date: Date | null | undefined): string | null {
  if (date == null) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 签发 token AO（POST /auth/token/issue；会话守卫；明文仅此次回执） */
export class ApiTokenIssueAO {
  /** 用途名（≤50） */
  @IsString({ message: 'tokenName不能为空' })
  @IsNotEmpty({ message: 'tokenName不能为空' })
  @MaxLength(50, { message: 'tokenName长度不能超过50' })
  tokenName!: string;

  /** 有效天数（1~365，缺省 90；permanent=true 时忽略） */
  @IsOptional()
  @IsInt({ message: 'expiresDays必须为整数' })
  @Min(1, { message: 'expiresDays最小为1' })
  @Max(365, { message: 'expiresDays最大为365' })
  expiresDays?: number;

  /** 永久 token（缺省 false；true 时 expires_at=null） */
  @IsOptional()
  @IsBoolean()
  permanent?: boolean;
}

/** 吊销 token AO（POST /auth/token/revoke；幂等） */
export class ApiTokenRevokeAO {
  @IsString({ message: 'tokenId不能为空' })
  @Matches(TOKEN_ID_PATTERN, { message: 'tokenId格式不合法' })
  tokenId!: string;
}

/** token 列表 AO（POST /auth/token/list；分页） */
export class ApiTokenListAO {
  @IsOptional()
  @IsInt()
  @Min(1)
  pageNum?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** 签发回执 VO（**token 明文仅此一次**，INV-28；此后永不回显） */
export class ApiTokenIssueVO {
  tokenId!: string;
  tokenName!: string;
  /** 明文 token（dlpat_+43 字符 base64url；仅签发回执出现一次） */
  token!: string;
  /** 明文前 12 字符（列表回显用） */
  tokenPrefix!: string;
  /** 过期时刻（null=永久） */
  expiresAt!: string | null;
  createdTime!: string | null;

  static of(row: ApiToken, plain: string): ApiTokenIssueVO {
    const vo = new ApiTokenIssueVO();
    vo.tokenId = row.token_id;
    vo.tokenName = row.token_name;
    vo.token = plain;
    vo.tokenPrefix = row.token_prefix;
    vo.expiresAt = formatDateTime(row.expires_at);
    vo.createdTime = formatDateTime(row.created_time);
    return vo;
  }
}

/** token 派生状态（过程数据 P2，不入枚举池；api-web-agent §3.4） */
export type ApiTokenStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** 派生 status：revoked_at≠null→REVOKED；expires_at 到期→EXPIRED；否则 ACTIVE */
export function deriveTokenStatus(row: ApiToken, nowMillis: number): ApiTokenStatus {
  if (row.revoked_at != null) {
    return 'REVOKED';
  }
  if (row.expires_at != null && row.expires_at.getTime() <= nowMillis) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

/** token 列表行 VO（**永不回显 token/token_hash**） */
export class ApiTokenListVO {
  tokenId!: string;
  tokenName!: string;
  tokenPrefix!: string;
  createdTime!: string | null;
  expiresAt!: string | null;
  lastUsedAt!: string | null;
  /** 派生展示值（ACTIVE/EXPIRED/REVOKED） */
  status!: ApiTokenStatus;
  /** 操作列（revoke：status≠REVOKED） */
  operList: OperItem[] = [];

  static of(row: ApiToken, status: ApiTokenStatus): ApiTokenListVO {
    const vo = new ApiTokenListVO();
    vo.tokenId = row.token_id;
    vo.tokenName = row.token_name;
    vo.tokenPrefix = row.token_prefix;
    vo.createdTime = formatDateTime(row.created_time);
    vo.expiresAt = formatDateTime(row.expires_at);
    vo.lastUsedAt = formatDateTime(row.last_used_at);
    vo.status = status;
    vo.operList = status !== 'REVOKED' ? [OperItem.of('revoke', '吊销', 'danger')] : [];
    return vo;
  }
}
