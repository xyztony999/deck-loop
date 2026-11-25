/**
 * 品牌规范 / 话术模板 MCP tools（ADR-017 客户端移除补齐：服务已挂 AssetModule，
 * 纯包装。INV-16 logo 启用态 / INV-17 默认唯一 / INV-18 被引用禁删 /
 * INV-21 占位符语法均由 BrandKitService/PromptTemplateService 原样守卫）。
 *
 * agent 用法：brandkit_save 沉淀色彩/字体规范 → deck_create 的 defaultBrandKitId
 * 引用 → 生成 content 时按规范取色取字体（style.color/fontFamily）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrandKitService, PromptTemplateService } from '@deck-loop/core/dist/asset/asset.service';
import type { ToolContext } from './context';
import { guarded, ok } from './respond';

export function registerBrandKitTools(server: McpServer, ctx: ToolContext): void {
  const kits = ctx.core.get(BrandKitService);
  const prompts = ctx.core.get(PromptTemplateService);

  server.registerTool(
    'brandkit_save',
    {
      description:
        '新建/编辑品牌规范（kitName ≤50；colors.primary 主色 + assistants 辅色 ≤16；' +
        'fonts.title/body 字体名；logoAssetId 须 ACTIVE 素材）。brandKitId 空=新建。' +
        '生成 content 时按规范取 style.color/fontFamily。',
      inputSchema: {
        brandKitId: z.string().optional(),
        kitName: z.string().min(1).max(50),
        colors: z.object({
          primary: z.string().describe('主色（6 位 hex）'),
          assistants: z.array(z.string()).max(16).optional(),
        }),
        fonts: z
          .object({ title: z.string().optional(), body: z.string().optional() })
          .optional(),
        logoAssetId: z.string().optional(),
      },
    },
    guarded(async (args) => ok(await kits.save(args, ctx.userId))),
  );

  server.registerTool(
    'brandkit_list',
    {
      description: '品牌规范分页列表（keyword 名称模糊）。',
      inputSchema: {
        keyword: z.string().optional(),
        pageNum: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(async (args) => ok(await kits.listPage(args, ctx.userId))),
  );

  server.registerTool(
    'brandkit_set_default',
    {
      description: '设为默认品牌规范（用户维度唯一，INV-17 事务切换）。',
      inputSchema: { brandKitId: z.string().min(1) },
    },
    guarded(async (args) => {
      await kits.setDefault(args, ctx.userId);
      return ok({ brandKitId: args.brandKitId, isDefault: true });
    }),
  );

  server.registerTool(
    'brandkit_delete',
    {
      description: '删除品牌规范（被引用/默认规范守卫拒绝）。破坏性操作——须用户明确授权。',
      inputSchema: { brandKitId: z.string().min(1) },
    },
    guarded(async (args) => {
      await kits.delete(args, ctx.userId);
      return ok({ brandKitId: args.brandKitId, deleted: true });
    }),
  );

  server.registerTool(
    'prompt_save',
    {
      description:
        '新建/编辑话术模板（title ≤50；content ≤2000，{名称} 占位符 ≤10 处；' +
        'templateScene WHOLE=整稿 / TARGETED=定向）。templateId 空=新建。',
      inputSchema: {
        templateId: z.string().optional(),
        title: z.string().min(1).max(50),
        content: z.string().min(1).max(2000),
        category: z.string().max(64).optional(),
        templateScene: z.enum(['WHOLE', 'TARGETED']),
      },
    },
    guarded(async (args) => ok(await prompts.save(args, ctx.userId))),
  );

  server.registerTool(
    'prompt_list',
    {
      description: '话术模板分页列表（keyword 标题/正文模糊；templateScene 筛）。',
      inputSchema: {
        keyword: z.string().optional(),
        templateScene: z.enum(['WHOLE', 'TARGETED']).optional(),
        pageNum: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(async (args) => ok(await prompts.listPage(args, ctx.userId))),
  );

  server.registerTool(
    'prompt_delete',
    {
      description: '删除话术模板。破坏性操作——须用户明确授权。',
      inputSchema: { templateId: z.string().min(1) },
    },
    guarded(async (args) => {
      await prompts.delete(args, ctx.userId);
      return ok({ templateId: args.templateId, deleted: true });
    }),
  );
}