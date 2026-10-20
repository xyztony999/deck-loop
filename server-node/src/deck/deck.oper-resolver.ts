import { DeckStatus } from '../common/enums';
import { OperItem } from '../common/result';

/**
 * 创作物操作列解析（api-deck §4.4 operList 计算表，v1 DeckOperResolverService 平移）。
 *
 * 属主判断（v1 06-oper-column 链路）：createdBy === 当前会话 userId 才有操作列
 * （个人单用户产品恒为属主，判定保留为契约行为）。
 * 计算表：
 * | 操作 key   | 显示条件（DeckStatus）                        |
 * | edit       | DRAFT/ITERATING                               |
 * | finalize   | ITERATING 且无进行中任务                       |
 * | unfinalize | FINALIZED                                     |
 * | archive    | DRAFT/ITERATING/FINALIZED 且无进行中任务        |
 * | restore    | ARCHIVED                                      |
 * | delete     | ARCHIVED（danger）                            |
 */
export function resolveDeckOperList(
  deckStatus: string | null | undefined,
  hasRunningTask: boolean,
  createdBy: string | null | undefined,
  currentUserId: string,
): OperItem[] {
  const operList: OperItem[] = [];
  if (deckStatus == null || createdBy == null || createdBy !== currentUserId) {
    return operList;
  }

  // edit：DRAFT/ITERATING
  if (deckStatus === DeckStatus.DRAFT || deckStatus === DeckStatus.ITERATING) {
    operList.push(OperItem.of('edit', '编辑'));
  }
  // finalize：ITERATING 且无进行中任务
  if (deckStatus === DeckStatus.ITERATING && !hasRunningTask) {
    operList.push(OperItem.of('finalize', '定稿'));
  }
  // unfinalize：FINALIZED
  if (deckStatus === DeckStatus.FINALIZED) {
    operList.push(OperItem.of('unfinalize', '解锁定稿'));
  }
  // archive：DRAFT/ITERATING/FINALIZED 且无进行中任务
  if (deckStatus !== DeckStatus.ARCHIVED && !hasRunningTask) {
    operList.push(OperItem.of('archive', '归档'));
  }
  // restore / delete：ARCHIVED
  if (deckStatus === DeckStatus.ARCHIVED) {
    operList.push(OperItem.of('restore', '恢复'));
    operList.push(OperItem.of('delete', '删除', 'danger'));
  }
  return operList;
}
