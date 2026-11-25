/**
 * deliver 域 MCP tools（ADR-017 Phase 2 / ADR-018 两模式：headless 导出 + 预览）。
 *
 * **渲染始终本地**（服务端零渲染红线 ADR-015）：
 * - export_deck：submit（FINALIZED 守卫 + INV-14 锚定 + EX 取号 QUEUED；remote 经
 *   HTTP）→ 取定稿 content + 素材（local 文件直读 / remote 签名 URL 下载）→
 *   本地 headless 渲染（系统 Edge PDF/PNG、pptxgenjs PPTX）→ upload 回传落账
 *   （魔数/大小服务端校验）；渲染失败 fail 回传 FAILED。产物本地副本路径回执。
 * - preview_deck：本地便利工具（非交付物），不要求 FINALIZED——当前指针版本或
 *   指定版本 → 独立 HTML 放映（键盘翻页），替代 Tauri 放映。
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { extensionOfFormat } from '@deck-loop/core/dist/deliver/deliver.constant';
import { BizException } from '@deck-loop/core/dist/common/exceptions';
import { DECK_NOT_FOUND } from '@deck-loop/core/dist/deck/deck.errors';
import { parseSlides, previewDocument } from '../render/render-template';
import { renderBrowserArtifact, renderPptxArtifact } from '../render/export-renderer';
import type { ToolContext } from './context';
import { guarded, ok } from './respond';

export function registerExportTools(server: McpServer, ctx: ToolContext): void {
  const backend = ctx.backend;

  server.registerTool(
    'export_deck',
    {
      description:
        '导出定稿创作物（须 FINALIZED）。PDF=打印级分页文件；IMAGES=逐页 PNG  zip 包；' +
        'PPTX=可编辑文本层（beta，字号 fit:shrink）。返回本地产物文件路径。' +
        '渲染在本地 headless 浏览器（系统 Edge）执行，失败自动落 FAILED 账。',
      inputSchema: {
        deckId: z.string().min(1),
        exportFormat: z.enum(['PDF', 'IMAGES', 'PPTX']),
        confirm: z.boolean().default(true).describe('PPTX beta 确认（默认 true）'),
      },
    },
    guarded(async (args) => {
      const submitVo = await backend.exportSubmit({
        deckId: args.deckId,
        exportFormat: args.exportFormat,
        confirm: args.confirm,
      });
      if (!submitVo.exportId) {
        // PPTX 未 confirm 的提示态回执（未创建任务）
        return ok(submitVo);
      }
      try {
        const content = await backend.finalizedContent(args.deckId);
        const slides = parseSlides(content);
        const imageUrls = await backend.resolveImages(content);
        const artifact =
          args.exportFormat === 'PPTX'
            ? await renderPptxArtifact(slides, imageUrls)
            : await renderBrowserArtifact(args.exportFormat, slides, imageUrls);
        await backend.exportUpload(submitVo.exportId, artifact.bytes);
        const filePath = join(
          ctx.paths.artifactsDir,
          ctx.userId,
          `${submitVo.exportId}.${extensionOfFormat(args.exportFormat)}`,
        );
        // 本地产物副本（remote 模式服务端落账在云端，filePath 须本地可打开；
        // local 模式与核心存储同路径同字节，重写幂等）
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, artifact.bytes);
        return ok({
          exportId: submitVo.exportId,
          exportFormat: args.exportFormat,
          filePath,
          fileSize: artifact.bytes.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await backend.exportFail(submitVo.exportId, message).catch(() => undefined);
        throw error;
      }
    }),
  );

  server.registerTool(
    'export_list',
    {
      description: '导出记录分页（SUCCEEDED 终态即导出记录；可按 deck/格式/状态筛）。',
      inputSchema: {
        deckId: z.string().optional(),
        exportFormat: z.enum(['PDF', 'IMAGES', 'PPTX']).optional(),
        exportStatus: z.enum(['QUEUED', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional(),
        pageNum: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(async (args) => ok(await backend.exportList(args))),
  );

  server.registerTool(
    'preview_deck',
    {
      description:
        '生成独立 HTML 放映预览（键盘 ←→/空格翻页，F 全屏；本地浏览器打开）。' +
        '缺省=当前指针版本；versionId 可指定任意版本。不要求定稿（本地便利工具）。',
      inputSchema: {
        deckId: z.string().min(1),
        versionId: z.string().optional(),
        open: z.boolean().default(true).describe('生成后自动用系统浏览器打开'),
      },
    },
    guarded(async (args) => {
      const deck = await backend.deckGet(args.deckId);
      if (deck == null) {
        throw new BizException(DECK_NOT_FOUND, '创作物不存在');
      }
      const versionId = args.versionId ?? deck.currentVersionId;
      if (versionId == null || versionId.length === 0) {
        throw new BizException(DECK_NOT_FOUND, '当前无版本可预览');
      }
      const detail = await backend.versionDetail(versionId);
      const content = detail['content'] as Record<string, unknown>;
      const slides = parseSlides(content);
      const imageUrls = await backend.resolveImages(content);
      const html = previewDocument(deck.deckName, slides, imageUrls);
      const filePath = join(ctx.paths.previewsDir, `${args.deckId}-v${String(detail['versionSeq'])}.html`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, html, 'utf8');
      if (args.open) {
        openInBrowser(filePath);
      }
      return ok({ deckId: args.deckId, versionId, filePath, pageCount: slides.length });
    }),
  );
}

/** 系统浏览器打开（win32 start / darwin open / linux xdg-open；失败静默——路径已返回） */
function openInBrowser(filePath: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // 打开失败不影响产物交付
  }
}