import { ExportStatus, type ExportStatusCode } from '../common/enums';

/**
 * ExportStatus 状态机流转表（api-delivery §4.2；v1 ExportStatusFlow 平移，
 * state-machine 规约集中校验形态）。纯静态工具类（v1 private 构造器 +
 * final class 语义：TS 无 final 类，以私有构造器 + 全静态成员落实）。
 *
 * 状态流转与触发来源标注：
 * ```
 * QUEUED    --[系统回调:渲染网关受理]-->   RENDERING
 * RENDERING --[系统回调:渲染成功]-->      SUCCEEDED（INV-15：file_key 必有）
 * RENDERING --[系统回调:渲染失败]-->      FAILED（error_msg 摘要）
 * QUEUED/RENDERING --[用户操作:取消]-->   CANCELLED
 * ```
 * 无审批、无回退边；终态集合 {SUCCEEDED, FAILED, CANCELLED} 不再流转
 * （SUCCEEDED 终态即「导出记录」，api-delivery §1.4）。
 * 全部流转以「条件更新（exportId + 期望前置状态）」承载，重复投递/并发取消天然幂等。
 */
export class ExportStatusFlow {
  private constructor() {}

  /** 合法流转边：from → 可达 to 集合 */
  private static readonly TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
    [ExportStatus.QUEUED]: new Set([ExportStatus.RENDERING, ExportStatus.CANCELLED]),
    [ExportStatus.RENDERING]: new Set([
      ExportStatus.SUCCEEDED,
      ExportStatus.FAILED,
      ExportStatus.CANCELLED,
    ]),
    [ExportStatus.SUCCEEDED]: new Set(),
    [ExportStatus.FAILED]: new Set(),
    [ExportStatus.CANCELLED]: new Set(),
  };

  /** 终态集合（终态任务不再流转；cancel 对终态幂等返回） */
  private static readonly TERMINAL: ReadonlySet<string> = new Set([
    ExportStatus.SUCCEEDED,
    ExportStatus.FAILED,
    ExportStatus.CANCELLED,
  ]);

  /** 流转边校验（非法组合为集成缺陷快速失败；本域当前各推进点即合法边，供守卫复用） */
  static canTransition(from: string | null | undefined, to: string | null | undefined): boolean {
    if (from == null || to == null) {
      return false;
    }
    return ExportStatusFlow.TRANSITIONS[from]?.has(to) === true;
  }

  /** 是否终态（SUCCEEDED/FAILED/CANCELLED） */
  static isTerminal(statusCode: string | null | undefined): boolean {
    return statusCode != null && ExportStatusFlow.TERMINAL.has(statusCode);
  }

  /** 按 code 解析枚举值（容错 null/未知值返回 null） */
  static parse(statusCode: string | null | undefined): ExportStatusCode | null {
    if (statusCode == null) {
      return null;
    }
    const values = Object.values(ExportStatus) as readonly ExportStatusCode[];
    return values.includes(statusCode as ExportStatusCode)
      ? (statusCode as ExportStatusCode)
      : null;
  }
}
