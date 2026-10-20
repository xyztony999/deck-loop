import { ExportStatus } from '../common/enums';
import { OperItem } from '../common/result';

/**
 * 导出记录行操作列解析（api-delivery §4.4 export/list；v1 ExportOperResolver 平移）。
 *
 * 规则：
 * | 操作 key   | 显示条件（ExportStatus） |
 * | download  | SUCCEEDED               |
 * | cancel    | QUEUED/RENDERING        |
 * | retry     | FAILED（无独立端点，客户端经 submit 重新发起） |
 *
 * 属主判断（v1 06-oper-column 链路）：createdBy === 当前会话 userId 才有操作列
 * （个人单用户产品恒为属主，判定保留为契约行为）。
 */
export function resolveExportOperList(
  exportStatus: string | null | undefined,
  createdBy: string | null | undefined,
  currentUserId: string,
): OperItem[] {
  const operList: OperItem[] = [];
  if (exportStatus == null || createdBy == null || createdBy !== currentUserId) {
    return operList;
  }
  if (exportStatus === ExportStatus.SUCCEEDED) {
    operList.push(OperItem.of('download', '下载'));
  }
  if (exportStatus === ExportStatus.QUEUED || exportStatus === ExportStatus.RENDERING) {
    operList.push(OperItem.of('cancel', '取消'));
  }
  if (exportStatus === ExportStatus.FAILED) {
    operList.push(OperItem.of('retry', '重新导出'));
  }
  return operList;
}
