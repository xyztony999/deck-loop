/**
 * 连接管理 tools（ADR-019 双模式市场包）：remote_connect 登录 deck-loop 账号
 * （登录→自动签发个人 token→落盘→切 remote，密码不落盘）/ disconnect / status。
 * 仅市场包入口（plugin-main）注册；仓库 local/remote 固定入口不带（env 驱动）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SwitchableBackend } from './switchable-backend';
import { guarded, ok } from './respond';

export function registerAccountTools(server: McpServer, backend: SwitchableBackend): void {
  server.registerTool(
    'remote_connect',
    {
      description:
        '连接远程 deck-loop 系统：用你自己的账号登录（apiUrl 如 https://host/api，邮箱+密码）→' +
        '自动签发个人 API token 并保存 → 切换到远程模式（与网站同库实时）。' +
        '密码仅本次内存使用，绝不落盘。需要向用户索取凭据——不要猜测。' +
        '无服务端时改用本地模式（remote_disconnect 或默认即可，开箱即用）。',
      inputSchema: {
        apiUrl: z.string().url().describe('deck-loop API 基址（含 /api 前缀）'),
        email: z.string().email(),
        password: z.string().min(1),
      },
    },
    guarded(async (args) => {
      const status = await backend.connectRemote(args.apiUrl, args.email, args.password);
      return ok({ ...status, note: '已连接远程，后续创作直接进你的系统；网站可见' });
    }),
  );

  server.registerTool(
    'remote_disconnect',
    {
      description: '断开远程连接，回本地模式（本地库保留；远程 token 配置清除）。',
      inputSchema: {},
    },
    guarded(async () => ok(backend.disconnectRemote())),
  );

  server.registerTool(
    'connection_status',
    {
      description: '当前连接状态：local/remote、远程 apiUrl/token 前缀/到期、本地库路径。',
      inputSchema: {},
    },
    guarded(async () => ok(backend.status())),
  );

  server.registerTool(
    'manage_open',
    {
      description:
        '打开图形管理站：local=内嵌本地网站（同一套 web 前端连本地库，127.0.0.1 绑定）；' +
        'remote=你的 deck-loop 网站。用户要「网页上看/管理素材/浏览版本」时用它。' +
        '默认自动开浏览器；本地站随 MCP 进程存活。',
      inputSchema: {
        open: z.boolean().default(true).describe('自动用系统浏览器打开'),
      },
    },
    guarded(async (args) => ok(await backend.manageOpen(args.open ?? true))),
  );
}