/**
 * asset 域 MCP tools（复用 AssetService.upload：INV-19 类型/大小、INV-20 hash
 * 查重/复活原样；本地文件路径 → memory payload，内容寻址落 ASSET_STORAGE_DIR）。
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AssetService } from '@deck-loop/core/dist/asset/asset.service';
import type { ToolContext } from './context';
import { guarded, ok } from './respond';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

export function registerAssetTools(server: McpServer, ctx: ToolContext): void {
  const assets = ctx.core.get(AssetService);

  server.registerTool(
    'asset_add',
    {
      description:
        '从本地文件路径添加图片素材（jpg/jpeg/png/svg/webp，≤10MB；同 hash 查重/复活）。' +
        '返回 assetId——version_create 的 IMAGE 块经 assetId 引用（引用计数自动维护）。',
      inputSchema: {
        filePath: z.string().min(1).describe('本地图片文件绝对路径'),
        assetName: z.string().max(128).optional().describe('素材名称（缺省取文件名）'),
        category: z.string().max(64).optional(),
        assetType: z.enum(['IMAGE', 'LOGO']).default('IMAGE'),
      },
    },
    guarded(async (args) => {
      const buffer = await readFile(args.filePath);
      const ext = extname(args.filePath).slice(1).toLowerCase();
      const vo = await assets.upload(
        {
          fieldname: 'file',
          originalname: basename(args.filePath),
          encoding: '7bit',
          mimetype: MIME_BY_EXT[ext] ?? 'application/octet-stream',
          size: buffer.length,
          buffer,
        },
        { assetName: args.assetName, category: args.category, assetType: args.assetType },
        ctx.userId,
      );
      return ok(vo);
    }),
  );

  server.registerTool(
    'asset_list',
    {
      description: '素材分页列表（keyword 名称模糊；assetType IMAGE/LOGO；assetStatus ACTIVE/DISABLED）。',
      inputSchema: {
        keyword: z.string().optional(),
        assetType: z.enum(['IMAGE', 'LOGO']).optional(),
        assetStatus: z.enum(['ACTIVE', 'DISABLED']).optional(),
        pageNum: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(async (args) => ok(await assets.listPage(args, ctx.userId))),
  );
}