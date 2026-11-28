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
        '连接远程 deck-loop 系统（与网站同库实时）。**推荐：只传 apiUrl（浏览器授权）**——' +
        '自动打开网站授权页，用户以自己账号（passkey/密码均可）确认，token 自动签发回传，' +
        '凭据不进对话；工具会等待最长 120s，超时返回 loginUrl 可重试。' +
        '备选：email+password 直连（密码仅内存使用不落盘）。' +
        '需要向用户索取 apiUrl——不要猜测；无服务端时用本地模式（默认）。',
      inputSchema: {
        apiUrl: z.string().url().describe('deck-loop API 基址（含 /api 前缀）'),
        email: z.string().email().optional().describe('仅密码直连时需要'),
        password: z.string().min(1).optional().describe('密码直连形态（缺省走浏览器授权）'),
        open: z.boolean().default(true).describe('浏览器授权：自动打开授权页'),
      },
    },
    guarded(async (args) => {
      if (args.password != null && args.password.length > 0) {
        if (args.email == null || args.email.length === 0) {
          throw Object.assign(new Error('密码直连形态需要 email（或缺省 password 走浏览器授权）'), {
            code: 'BIZ_AUTH_CREDENTIALS',
          });
        }
        const status = await backend.connectRemote(args.apiUrl, args.email, args.password);
        return ok({ ...status, note: '已连接远程，后续创作直接进你的系统；网站可见' });
      }
      const status = await backend.connectBrowser(args.apiUrl, args.open ?? true);
      return ok(status);
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