/**
 * deliver 域 MCP tools（ADR-017 Phase 2：headless 导出 + 预览）。
 *
 * export_deck 复用 ExportService 全状态机：submit（FINALIZED 守卫 + INV-14 锚定
 * + EX 取号 QUEUED）→ 本地 headless 渲染 → uploadArtifact（魔数/大小校验 +
 * SUCCEEDED + 落账）；渲染失败 reportFailure（FAILED）。产物路径直接返回。
 *
 * preview_deck：本地便利工具（非交付物），不要求 FINALIZED——当前指针版本或
 * 指定版本 → 独立 HTML 放映（键盘翻页），替代 Tauri 放映。
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ExportService } from '@deck-loop/core/dist/deliver/export.service';
import { DeckDomainService } from '@deck-loop/core/dist/deck/deck.domain-service';
import { VersionArchiveService } from '@deck-loop/core/dist/version/version.archive-service';
import { VersionManageService } from '@deck-loop/core/dist/version/version.manage-service';
import { AssetRepository } from '@deck-loop/core/dist/asset/asset.repository';
import { extractAssetIds } from '@deck-loop/core/dist/version/version.content-support';
import { extensionOfFormat } from '@deck-loop/core/dist/deliver/deliver.constant';
import { BizException } from '@deck-loop/core/dist/common/exceptions';
import { DECK_NOT_FOUND } from '@deck-loop/core/dist/deck/deck.errors';
import { parseSlides } from '../render/render-template';
import {
  fileToDataUri,
  previewDocument,
  renderBrowserArtifact,
  renderPptxArtifact,
} from '../render/export-renderer';
import type { ToolContext } from './context';
import { guarded, ok } from './respond';

/** 本地素材解析：assetId → storage_key → 文件直读 data URI（无 HTTP 签名链路） */
async function resolveLocalImages(
  content: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const assetIds = extractAssetIds(content);
  if (assetIds.length === 0) {
    return urls;
  }
  const assets = ctx.core.get(AssetRepository);
  const found = await assets.findByIds(ctx.userId, assetIds);
  for (const asset of found) {
    urls.set(asset.asset_id, await fileToDataUri(join(ctx.paths.assetsDir, asset.storage_key)));
  }
  return urls;
}

export function registerExportTools(server: McpServer, ctx: ToolContext): void {
  const exports = ctx.core.get(ExportService);
  const deckDomain = ctx.core.get(DeckDomainService);
  const archive = ctx.core.get(VersionArchiveService);
  const versions = ctx.core.get(VersionManageService);

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
      const submitVo = await exports.submit(
        { deckId: args.deckId, exportFormat: args.exportFormat, confirm: args.confirm },
        ctx.userId,
      );
      if (!submitVo.exportId) {
        // PPTX 未 confirm 的提示态回执（未创建任务）
        return ok(submitVo);
      }
      try {
        const { finalVersionId } = await deckDomain.assertFinalized(args.deckId, ctx.userId);
        const content = await archive.getVersionContent(finalVersionId, ctx.userId);
        const slides = parseSlides(content);
        const imageUrls = await resolveLocalImages(content, ctx);
        const artifact =
          args.exportFormat === 'PPTX'
            ? await renderPptxArtifact(slides, imageUrls)
            : await renderBrowserArtifact(args.exportFormat, slides, imageUrls);
        await exports.uploadArtifact(submitVo.exportId, { buffer: artifact.bytes }, ctx.userId);
        const filePath = join(
          ctx.paths.artifactsDir,
          ctx.userId,
          `${submitVo.exportId}.${extensionOfFormat(args.exportFormat)}`,
        );
        return ok({
          exportId: submitVo.exportId,
          exportFormat: args.exportFormat,
          filePath,
          fileSize: artifact.bytes.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await exports
          .reportFailure({ exportId: submitVo.exportId, errorMsg: message }, ctx.userId)
          .catch(() => undefined);
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
    guarded(async (args) => ok(await exports.listPage(args, ctx.userId))),
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
      const deck = await deckDomain.getDeck(args.deckId, ctx.userId);
      if (deck == null) {
        throw new BizException(DECK_NOT_FOUND, '创作物不存在');
      }
      const versionId = args.versionId ?? deck.current_version_id;
      if (versionId == null || versionId.length === 0) {
        throw new BizException(DECK_NOT_FOUND, '当前无版本可预览');
      }
      const detail = await versions.detail({ versionId }, ctx.userId);
      const slides = parseSlides(detail.content);
      const imageUrls = await resolveLocalImages(detail.content, ctx);
      const html = previewDocument(deck.deck_name, slides, imageUrls);
      const filePath = join(ctx.paths.previewsDir, `${args.deckId}-v${detail.versionSeq}.html`);
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