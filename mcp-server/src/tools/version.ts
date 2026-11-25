/**
 * version 域 MCP tools —— **agent 直写路径（ADR-017 核心）**。
 *
 * version_create：coding agent 产出 content JSON（契约 api-version §4.1：
 * pages[]→blocks[]，blockType TEXT|IMAGE|PLACEHOLDER）→ 经 VersionArchiveService
 * 唯一写入口归档（单事务：seq 分配→insertOnly→movePointer→引用计数），
 * **完全绕开 AI 网关**——推理消耗在 agent 侧 coding plan。
 *
 * sourceType 自动判定：scope 存在→TARGETED_ADJUST；有基线→FULL_ADJUST；首版→FULL_GENERATE。
 * TARGETED_ADJUST 强制 assertTargetedInvariance（非目标页/块 canonical 不变，越界不产版本）。
 * 首版成功后 DRAFT→ITERATING（onFirstVersionCreated，generation 回调同口径）。
 * taskId 合成 agent-<snowflake>（本地无网关任务行；树 taskStatusOfSource 自然回落 null）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VersionArchiveService } from '@deck-loop/core/dist/version/version.archive-service';
import { VersionManageService } from '@deck-loop/core/dist/version/version.manage-service';
import { VersionArchiveCommand } from '@deck-loop/core/dist/version/version.dto';
import { DeckDomainService } from '@deck-loop/core/dist/deck/deck.domain-service';
import { assertTargetedInvariance } from '@deck-loop/core/dist/generation/targeted-invariance';
import { DeckStatus, VersionSourceType } from '@deck-loop/core/dist/common/enums';
import { nextId } from '@deck-loop/core/dist/common/utils/snowflake';
import { BizException } from '@deck-loop/core/dist/common/exceptions';
import { DECK_NOT_FOUND } from '@deck-loop/core/dist/deck/deck.errors';
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
const contentSchema = z.object({ pages: z.array(pageSchema).min(1) });

export function registerVersionTools(server: McpServer, ctx: ToolContext): void {
  const archive = ctx.core.get(VersionArchiveService);
  const manage = ctx.core.get(VersionManageService);
  const deckDomain = ctx.core.get(DeckDomainService);

  server.registerTool(
    'version_create',
    {
      description:
        '写入新版本（agent 直写，唯一内容写入口）。content 契约：{pages:[{pageId,layout?,title?,note?,blocks:[{blockId,blockType:TEXT|IMAGE|PLACEHOLDER,text?,assetId?,style?}],style?}]}。' +
        'style 可选坐标/字号（x,y,width,height,fontSize,fontFamily,color,textAlign；缺省自动排版）。' +
        'sourceType 自动：首版 FULL_GENERATE / 有基线 FULL_ADJUST / 带 scope TARGETED_ADJUST。' +
        '定向调整（scope={pageId,blockId?}）强制非目标不变性校验，越界拒绝。' +
        'parentVersionId 缺省=当前指针；branchName 缺省=活动分支（≠活动分支=分叉留档）。',
      inputSchema: {
        deckId: z.string().min(1),
        content: contentSchema.describe('页面树快照（整稿）'),
        instruction: z.string().min(1).describe('本次生成/调整指令（落 instruction_snapshot，树摘要展示）'),
        parentVersionId: z.string().optional(),
        branchName: z.string().max(50).optional(),
        scope: z
          .object({ pageId: z.string().min(1), blockId: z.string().optional() })
          .optional()
          .describe('定向调整作用域（页级/块级）；提供即 TARGETED_ADJUST'),
      },
    },
    guarded(async (args) => {
      const deck = await deckDomain.getDeck(args.deckId, ctx.userId);
      if (deck == null) {
        throw new BizException(DECK_NOT_FOUND, '创作物不存在');
      }
      const content = args.content as Record<string, unknown>;
      const taskId = `agent-${nextId()}`;
      const baselineId = args.parentVersionId ?? deck.current_version_id ?? null;
      const sourceType =
        args.scope != null
          ? VersionSourceType.TARGETED_ADJUST
          : baselineId != null
            ? VersionSourceType.FULL_ADJUST
            : VersionSourceType.FULL_GENERATE;

      const instructionSnapshot: Record<string, unknown> = { instruction: args.instruction };
      if (args.scope != null) {
        // 定向调整：基线固化进快照 + 非目标不变性校验（越界抛错，不产版本）
        if (baselineId == null) {
          throw new BizException(DECK_NOT_FOUND, '定向调整须有基线版本（首版请用整稿生成）');
        }
        const baseContent = await archive.getVersionContent(baselineId, ctx.userId);
        instructionSnapshot['targetPath'] = args.scope;
        instructionSnapshot['baseContent'] = baseContent;
        assertTargetedInvariance(instructionSnapshot, content, taskId);
      }

      const command = new VersionArchiveCommand();
      command.deckId = args.deckId;
      command.userId = ctx.userId;
      command.taskId = taskId;
      command.sourceType = sourceType;
      command.instructionSnapshot = instructionSnapshot;
      command.content = content;
      command.parentVersionId = args.parentVersionId ?? null;
      command.branchName = args.branchName ?? null;

      const wasDraft = deck.deck_status === DeckStatus.DRAFT;
      const result = await archive.createVersionFromTask(command);
      if (wasDraft) {
        // 首版流转 DRAFT→ITERATING（generation 成功回调同口径，幂等）
        await deckDomain.onFirstVersionCreated(args.deckId, ctx.userId);
      }
      return ok({ ...result, sourceType, taskId });
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
    guarded(async (args) => ok(await manage.tree(args, ctx.userId))),
  );

  server.registerTool(
    'version_get',
    {
      description: '版本详情（content 完整 JSON + instruction_snapshot + hash/页数）。',
      inputSchema: { versionId: z.string().min(1) },
    },
    guarded(async (args) => ok(await manage.detail(args, ctx.userId))),
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
    guarded(async (args) => ok(await manage.compare(args, ctx.userId))),
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
      await manage.rollback({ ...args, confirm: true }, ctx.userId);
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
      await manage.fork(args, ctx.userId);
      return ok({ deckId: args.deckId, branchName: args.branchName });
    }),
  );
}