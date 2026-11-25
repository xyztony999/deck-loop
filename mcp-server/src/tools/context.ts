/**
 * 工具共享上下文：本地核心句柄 + 固定属主 + 数据目录。
 * 本地单用户（ADR-005 个人产品）：无鉴权，userId 固定 'local'（存储白名单形态）。
 */
import type { LocalCore } from '@deck-loop/core/dist/local';
import type { LocalPaths } from '../paths';

export const LOCAL_USER_ID = 'local';

export interface ToolContext {
  core: LocalCore;
  userId: string;
  paths: LocalPaths;
}