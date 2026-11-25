/**
 * 工具共享上下文（ADR-018 §4.2 装配缝）：ToolBackend（local=LocalCore 进程内直调 /
 * remote=RemoteClient HTTP）+ 属主 + 数据目录。
 * 本地单用户（ADR-005 个人产品）：无鉴权，userId 固定 'local'；
 * 远程模式属主由个人 token 服务端注入，客户端 userId 仅用于本地产物目录命名。
 */
import type { LocalPaths } from '../paths';
import type { ToolBackend } from './backend';

export const LOCAL_USER_ID = 'local';

/** 远程模式本地产物目录属主名（token 属主由服务端校验，客户端无感知） */
export const REMOTE_USER_ID = 'remote';

export interface ToolContext {
  backend: ToolBackend;
  userId: string;
  paths: LocalPaths;
}