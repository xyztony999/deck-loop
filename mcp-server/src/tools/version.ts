/**
 * version 域 MCP tools —— **agent 直写路径（ADR-017 核心 / ADR-018 两模式）**。
 *
 * version_create：coding agent 产出 content JSON（契约 api-version §4.1：
 * pages[]→blocks[]，blockType TEXT|IMAGE|PLACEHOLDER）→ 经 VersionArchiveService
 * 唯一写入口归档（local 进程内直调 / remote POST /ver/version/agent-create，
 * 同一服务同一事务：seq 分配→insertOnly→movePointer→引用计数）。
 *
 * sourceType 自动判定：scope 存在→TARGETED_ADJUST；有基线→FULL_ADJUST；首版→FULL_GENERATE。
 * TARGETED_ADJUST 强制 assertTargetedInvariance（非目标页/块 canonical 不变，越界不产版本）。
 * 首版成功后 DRAFT→ITERATING（onFirstVersionCreated）。
 * taskId 合成 agent-<snowflake>（不建任务行；树 taskStatusOfSource 自然回落 null）。
 * 载荷红线（两模式一致）：pages 1~200、instruction ≤2000、content ≤2MB（env AGENT_CONTENT_MAX_MB）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context';
import { guarded, ok } from './respond';

/** content 契约 zod 形状（pages[]→blocks[]；style 自由值对象，渲染侧容错解析） */
const blockSchema = z.object({
  blockId: z.string().min(1),
  blockType: z.enum(['TEXT', 'IMAGE', 'PLACEHOLDER']),
  text: z.string().optional(),
  assetId: z.string().optional(),
  style: z.record(z.unknown()).optional(),
});
const pageSchema = z.object({
  pageId: z.string().min(1),
  layout: z.string().optional(),
  title: z.string().optional(),
  note: z.string().optional().describe('演讲者备注'),
  blocks: z.array(blockSchema),
  style: z.record(z.unknown()).optional(),
});
const contentSchema = z.object({ pages: z.array(pageSchema).min(1).max(200) });

export function registerVersionTools(server: McpServer, ctx: ToolContext): void {
  const backend = ctx.backend;

  server.registerTool(
    'version_create',
    {
      description:
        '写入新版本（agent 直写，唯一内容写入口）。content 契约：{pages:[{pageId,layout?,title?,note?,blocks:[{blockId,blockType:TEXT|IMAGE|PLACEHOLDER,text?,assetId?,style?}],style?}]}。' +
        'style 可选坐标/字号（x,y,width,height,fontSize,fontFamily,color,textAlign；缺省自动排版）。' +
        'sourceType 自动：首版 FULL_GENERATE / 有基线 FULL_ADJUST / 带 scope TARGETED_ADJUST。' +
        '定向调整（scope={pageId,blockId?}）强制非目标不变性校验，越界拒绝。' +
        'parentVersionId 缺省=当前指针；branchName 缺省=活动分支（≠活动分支=分叉留档）。' +
        '载荷红线：pages 1~200、instruction ≤2000 字、content ≤2MB。',
      inputSchema: {
        deckId: z.string().min(1),
        content: contentSchema.describe('页面树快照（整稿）'),
        instruction: z.string().min(1).max(2000).describe('本次生成/调整指令（落 instruction_snapshot，树摘要展示）'),
        parentVersionId: z.string().optional(),
        branchName: z.string().max(50).optional(),
        scope: z
          .object({ pageId: z.string().min(1), blockId: z.string().optional() })
          .optional()
          .describe('定向调整作用域（页级/块级）；提供即 TARGETED_ADJUST'),
      },
    },
    guarded(async (args) => {
      const receipt = await backend.versionCreate({
        deckId: args.deckId,
        content: args.content as Record<string, unknown>,
        instruction: args.instruction,
        parentVersionId: args.parentVersionId,
        branchName: args.branchName,
        scope: args.scope,
      });
      return ok(receipt);
    }),
  );

  server.registerTool(
    'version_tree',
    {
      description: '版本谱系树 + 分支列表（branchScope ALL=全量 / ACTIVE=仅活动分支，默认 ACTIVE）。',
      inputSchema: {
        deckId: z.string().min(1),
        branchScope: z.enum(['ALL', 'ACTIVE']).default('ACTIVE'),
      },
    },
    guarded(async (args) => ok(await backend.versionTree(args))),
  );

  server.registerTool(
    'version_get',
    {
      description: '版本详情（content 完整 JSON + instruction_snapshot + hash/页数）。',
      inputSchema: { versionId: z.string().min(1) },
    },
    guarded(async (args) => ok(await backend.versionDetail(args.versionId))),
  );

  server.registerTool(
    'version_compare',
    {
      description: '双版本逐页逐块对比（changeKind NONE/STRUCTURE/TEXT/IMAGE/NEW/REMOVED）。',
      inputSchema: {
        deckId: z.string().min(1),
        leftVersionId: z.string().min(1),
        rightVersionId: z.string().min(1),
      },
    },
    guarded(async (args) => ok(await backend.versionCompare(args))),
  );

  server.registerTool(
    'version_rollback',
    {
      description: '回退=移当前指针到历史版本（历史不动；Deck 须 ITERATING，FINALIZED 先解锁）。',
      inputSchema: {
        deckId: z.string().min(1),
        versionId: z.string().min(1),
      },
    },
    guarded(async (args) => {
      await backend.versionRollback(args.deckId, args.versionId);
      return ok({ deckId: args.deckId, currentVersionId: args.versionId });
    }),
  );

  server.registerTool(
    'version_fork',
    {
      description: '从版本分叉新命名分支（复制快照为首版 + 切换活动分支；branchName 同 deck 唯一）。',
      inputSchema: {
        deckId: z.string().min(1),
        versionId: z.string().min(1),
        branchName: z.string().min(1).max(50),
      },
    },
    guarded(async (args) => {
      await backend.versionFork(args.deckId, args.versionId, args.branchName);
      return ok({ deckId: args.deckId, branchName: args.branchName });
    }),
  );
}