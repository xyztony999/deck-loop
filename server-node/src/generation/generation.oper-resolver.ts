import { TaskStatus } from '../common/enums';
import { OperItem } from '../common/result';

/**
 * 生成任务操作列解析（api-generation §4.4 operList 计算表，v1 GenerationTaskOperResolverService
 * 平移为纯函数——generation 域无 AOP 设施，Service 组装 VO 时逐行注入）。
 *
 * 可见性（均限属主，v1 06-oper-column 链路 createdBy===当前会话 userId）：
 * | 操作 key | 显示条件（TaskStatus） |
 * | cancel   | QUEUED/RUNNING        |
 * | retry    | FAILED                |
 */
export function resolveTaskOperList(
  taskStatus: string | null | undefined,
  createdBy: string | null | undefined,
  currentUserId: string,
): OperItem[] {
  const operList: OperItem[] = [];
  if (taskStatus == null || createdBy == null || createdBy !== currentUserId) {
    return operList;
  }
  // cancel：QUEUED/RUNNING
  if (taskStatus === TaskStatus.QUEUED || taskStatus === TaskStatus.RUNNING) {
    operList.push(OperItem.of('cancel', '取消'));
  }
  // retry：FAILED
  if (taskStatus === TaskStatus.FAILED) {
    operList.push(OperItem.of('retry', '重试'));
  }
  return operList;
}
