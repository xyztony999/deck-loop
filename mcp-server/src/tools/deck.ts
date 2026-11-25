/**
 * deck 域 MCP tools（两模式同 schema/语义/回执；后端经 ToolBackend 装配缝：
 * local=DeckManageService/DeckDomainService 直调，remote=HTTP 映射 §5.5 #1-10）。
 * 定稿/解锁的二次确认在工具层固定 confirm=true（agent 调用即显式意图）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DeckStatus } from '@deck-loop/core/dist/common/enums';
import type { ToolContext } from './context';
import { guarded, ok } from './respond';
import type { OutlineNode } from './outline';

export function registerDeckTools(server: McpServer, ctx: ToolContext): void {
  const backend = ctx.backend;

  server.registerTool(
    'deck_create',
    {
      description:
        '新建创作物（DRAFT 态，空版本树，active_branch=main）。返回 deckId/deckCode。后续用 outline_save 写大纲、version_create 写整稿。',
      inputSchema: {
        deckName: z.string().min(1).max(100).describe('创作物名称（≤100 字）'),
        topic: z.string().min(1).max(200).describe('主题（≤200 字）'),
        requirement: z.string().optional().describe('需求描述（可空）'),
        defaultBrandKitId: z.string().optional().describe('默认品牌规范（须存在且启用，INV-7）'),
      },
    },
    guarded(async (args) => {
      const vo = await backend.deckSave({
        deckType: 'DECK',
        deckName: args.deckName,
        topic: args.topic,
        requirement: args.requirement,
        defaultBrandKitId: args.defaultBrandKitId,
      });
      return ok(vo);
    }),
  );

  server.registerTool(
    'deck_list',
    {
      description: '分页列出创作物（默认不含归档；keyword 名称模糊；deckStatus 精确筛选）。',
      inputSchema: {
        keyword: z.string().optional(),
        deckStatus: z.enum(['DRAFT', 'ITERATING', 'FINALIZED', 'ARCHIVED']).optional(),
        archivedScope: z.union([z.literal(0), z.literal(1)]).optional().describe('1=仅归档'),
        pageNum: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(async (args) => ok(await backend.deckList(args))),
  );

  server.registerTool(
    'deck_get',
    {
      description:
        '创作物详情（状态/当前版本指针/定稿版本/大纲 draftOutline/统计）。读 content 用 version_get。',
      inputSchema: {
        deckId: z.string().min(1),
        withStats: z.boolean().default(true),
      },
    },
    guarded(async (args) =>
      ok(await backend.deckDetail({ deckId: args.deckId, withStats: args.withStats, withLatestTask: false })),
    ),
  );

  server.registerTool(
    'deck_update',
    {
      description: '编辑基本信息（仅 DRAFT/ITERATING 态；名称/主题/需求）。',
      inputSchema: {
        deckId: z.string().min(1),
        deckName: z.string().min(1).max(100),
        topic: z.string().min(1).max(200),
        requirement: z.string().optional(),
      },
    },
    guarded(async (args) =>
      ok(
        await backend.deckSave({
          deckId: args.deckId,
          deckType: 'DECK',
          deckName: args.deckName,
          topic: args.topic,
          requirement: args.requirement,
        }),
      ),
    ),
  );

  server.registerTool(
    'outline_save',
    {
      description:
        '保存大纲（仅 DRAFT 态；首版后只读）。nodes 1~50，title ≤50 字，points 要点数组，pageHint 建议页数（整数）。落盘为顶层节点数组。',
      inputSchema: {
        deckId: z.string().min(1),
        nodes: z
          .array(
            z.object({
              nodeId: z.string().optional(),
              title: z.string(),
              points: z.array(z.string()).optional(),
              note: z.string().optional(),
              pageHint: z.number().optional(),
            }),
          )
          .describe('大纲节点树'),
      },
    },
    guarded(async (args) => {
      // 守卫/序列化在后端（local 预校验+直写；remote 预校验+HTTP outline-save）
      await backend.outlineSave(args.deckId, args.nodes as OutlineNode[]);
      return ok({ deckId: args.deckId, nodeCount: args.nodes.length });
    }),
  );

  server.registerTool(
    'deck_finalize',
    {
      description:
        '定稿（ITERATING→FINALIZED，锚定当前版本为 finalVersionId）。导出/放映前置。需已有版本。',
      inputSchema: { deckId: z.string().min(1) },
    },
    guarded(async (args) => {
      await backend.deckFinalize(args.deckId);
      return ok({ deckId: args.deckId, deckStatus: DeckStatus.FINALIZED });
    }),
  );

  server.registerTool(
    'deck_unfinalize',
    {
      description: '解锁定稿（FINALIZED→ITERATING，继续迭代；finalVersionId 保留作最近定稿记录）。',
      inputSchema: { deckId: z.string().min(1) },
    },
    guarded(async (args) => {
      await backend.deckUnfinalize(args.deckId);
      return ok({ deckId: args.deckId, deckStatus: DeckStatus.ITERATING });
    }),
  );

  server.registerTool(
    'deck_archive',
    {
      description: '归档（任意非归档态→ARCHIVED）。',
      inputSchema: { deckId: z.string().min(1) },
    },
    guarded(async (args) => {
      await backend.deckArchive(args.deckId);
      return ok({ deckId: args.deckId, deckStatus: DeckStatus.ARCHIVED });
    }),
  );

  server.registerTool(
    'deck_restore',
    {
      description: '恢复归档（ARCHIVED→归档前状态）。',
      inputSchema: { deckId: z.string().min(1) },
    },
    guarded(async (args) => {
      await backend.deckRestore(args.deckId);
      return ok({ deckId: args.deckId });
    }),
  );

  server.registerTool(
    'deck_delete',
    {
      description: '软删除（仅 ARCHIVED 态可删）。破坏性操作——调用前须获得用户明确授权。',
      inputSchema: { deckId: z.string().min(1) },
    },
    guarded(async (args) => {
      await backend.deckDelete(args.deckId);
      return ok({ deckId: args.deckId, deleted: true });
    }),
  );
}