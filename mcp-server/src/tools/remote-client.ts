/**
 * RemoteClient（ADR-018 §4.2 MCP 远程模式装配缝实现）：HTTP 客户端，逐 tool
 * 映射到既有端点 + agent 直写端点（api-web-agent §5.5 映射表）。
 *
 * - 鉴权：全部请求携 `X-Api-Token: <个人 token>`（agent-create 仅认此头；
 *   其余端点服务端双凭证回落）；Content-Type: application/json（upload multipart）。
 * - 错误透传（D7）：HTTP 200 但 Result.status≠success → {code, msg} 原样转 MCP
 *   错误回执（不翻译不吞码）；BIZ_AUTH_TOKEN_INVALID/BIZ_AUTH_SESSION_EXPIRED →
 *   提示「token 无效/过期，请在网站设置页重新签发」；网络层失败归一
 *   DECK_LOOP_REMOTE_UNREACHABLE（含 URL/状态码，**不含 token**）。
 * - 导出/预览渲染始终本地（export_deck/preview_deck 编排在 tools/export.ts，
 *   本客户端仅提供 submit/detail/file-url/upload/fail 数据缝）。
 */
import {
  AUTH_SESSION_EXPIRED,
  AUTH_TOKEN_INVALID,
  BizException,
} from '@deck-loop/core/dist/common/exceptions';
import { DECK_NOT_FOUND, DECK_OUTLINE_INVALID, DECK_STATUS_FORBIDDEN } from '@deck-loop/core/dist/deck/deck.errors';
import { extractAssetIds } from '@deck-loop/core/dist/version/version.content-support';
import { MAX_IMAGE_BYTES } from '../render/render-template';
import type {
  AssetUploadFile,
  DeckSnapshot,
  ExportSubmitReceipt,
  ToolBackend,
  VersionCreateInput,
  VersionCreateReceipt,
} from './backend';
import type { OutlineNode } from './outline';
import { validateOutline } from './outline';

/** Result 信封（06 §6：{status, code, msg, data}） */
interface ResultEnvelope {
  status?: boolean;
  code?: string;
  msg?: string;
  data?: unknown;
}

/** 远程不可达统一码（api-web-agent §5.5；非 BIZ_*——网络层缺陷） */
export const REMOTE_UNREACHABLE = 'DECK_LOOP_REMOTE_UNREACHABLE';

/** token 无效提示（§5.5：BIZ_AUTH_TOKEN_INVALID/BIZ_AUTH_SESSION_EXPIRED 映射） */
const TOKEN_INVALID_HINT = 'token 无效/过期，请在网站设置页重新签发';

export interface RemoteClientOptions {
  /** API 基址（如 https://host/api；DECK_LOOP_API_URL） */
  apiUrl: string;
  /** 个人 API token（DECK_LOOP_API_TOKEN；仅请求头携带，不落日志） */
  apiToken: string;
}

export class RemoteClient implements ToolBackend {
  readonly mode = 'remote' as const;

  private readonly baseUrl: string;
  private readonly apiToken: string;

  constructor(options: RemoteClientOptions) {
    this.baseUrl = options.apiUrl.replace(/\/+$/, '');
    this.apiToken = options.apiToken;
  }

  /* ---------------- deck ---------------- */

  async deckSave(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/deck/deck/save', ao);
  }

  async deckList(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/deck/deck/list', ao);
  }

  async deckDetail(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/deck/deck/detail', ao);
  }

  async deckGet(deckId: string): Promise<DeckSnapshot | null> {
    try {
      const detail = (await this.post('/deck/deck/detail', {
        deckId,
        withStats: false,
        withLatestTask: false,
      })) as Record<string, unknown>;
      return {
        deckId: String(detail['deckId'] ?? deckId),
        deckName: String(detail['deckName'] ?? ''),
        deckStatus: String(detail['deckStatus'] ?? ''),
        currentVersionId: (detail['currentVersionId'] as string | null) ?? null,
        activeBranch: String(detail['activeBranch'] ?? 'main'),
        finalVersionId: (detail['finalVersionId'] as string | null) ?? null,
      };
    } catch (error) {
      if ((error as { code?: string }).code === DECK_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  async deckFinalize(deckId: string): Promise<void> {
    await this.post('/deck/deck/finalize', { deckId, confirm: true });
  }

  async deckUnfinalize(deckId: string): Promise<void> {
    await this.post('/deck/deck/unfinalize', { deckId, confirm: true });
  }

  async deckArchive(deckId: string): Promise<void> {
    await this.post('/deck/deck/archive', { deckId });
  }

  async deckRestore(deckId: string): Promise<void> {
    await this.post('/deck/deck/restore', { deckId });
  }

  async deckDelete(deckId: string): Promise<void> {
    await this.post('/deck/deck/delete', { deckId });
  }

  async outlineSave(deckId: string, nodes: OutlineNode[]): Promise<void> {
    // 本地预校验保留（§5.5 #5）；DRAFT 守卫/序列化在服务端
    const invalid = validateOutline(nodes);
    if (invalid != null) {
      throw new BizException(DECK_OUTLINE_INVALID, invalid);
    }
    await this.post('/deck/deck/outline-save', { deckId, outline: nodes });
  }

  /* ---------------- version ---------------- */

  async versionCreate(input: VersionCreateInput): Promise<VersionCreateReceipt> {
    // 唯一内容写入口（§5.5 #11 → §4.2 agent-create）
    const vo = (await this.post('/ver/version/agent-create', {
      deckId: input.deckId,
      content: input.content,
      instruction: input.instruction,
      parentVersionId: input.parentVersionId,
      branchName: input.branchName,
      scope: input.scope,
    })) as Record<string, unknown>;
    return {
      versionId: String(vo['versionId']),
      versionSeq: Number(vo['versionSeq']),
      sourceType: String(vo['sourceType']),
      taskId: String(vo['taskId']),
      branchName: String(vo['branchName']),
    };
  }

  async versionTree(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/ver/version/tree', ao);
  }

  async versionDetail(versionId: string): Promise<Record<string, unknown>> {
    return (await this.post('/ver/version/detail', { versionId })) as Record<string, unknown>;
  }

  async versionCompare(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/ver/version/compare', ao);
  }

  async versionRollback(deckId: string, versionId: string): Promise<void> {
    await this.post('/ver/version/rollback', { deckId, versionId, confirm: true });
  }

  async versionFork(deckId: string, versionId: string, branchName: string): Promise<void> {
    await this.post('/ver/version/fork', { deckId, versionId, branchName });
  }

  /* ---------------- asset ---------------- */

  async assetUpload(file: AssetUploadFile, ao: Record<string, unknown>): Promise<unknown> {
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    for (const key of ['assetName', 'category', 'assetType']) {
      const value = ao[key];
      if (typeof value === 'string' && value.length > 0) {
        form.append(key, value);
      }
    }
    return this.postMultipart('/asset/asset/upload', form);
  }

  async assetList(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/asset/asset/list', ao);
  }

  async brandkitSave(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/asset/brandkit/save', ao);
  }

  async brandkitList(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/asset/brandkit/list', ao);
  }

  async brandkitSetDefault(brandKitId: string): Promise<void> {
    await this.post('/asset/brandkit/set-default', { brandKitId });
  }

  async brandkitDelete(brandKitId: string): Promise<void> {
    await this.post('/asset/brandkit/delete', { brandKitId });
  }

  async promptSave(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/asset/prompt/save', ao);
  }

  async promptList(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/asset/prompt/list', ao);
  }

  async promptDelete(templateId: string): Promise<void> {
    await this.post('/asset/prompt/delete', { templateId });
  }

  /* ---------------- deliver ---------------- */

  async exportSubmit(ao: Record<string, unknown>): Promise<ExportSubmitReceipt> {
    const vo = (await this.post('/deliver/export/submit', ao)) as Record<string, unknown>;
    return {
      exportId: String(vo['exportId'] ?? ''),
      exportStatus: String(vo['exportStatus'] ?? ''),
      needConfirm: vo['needConfirm'] === true,
    };
  }

  async exportList(ao: Record<string, unknown>): Promise<unknown> {
    return this.post('/deliver/export/list', ao);
  }

  async exportUpload(exportId: string, bytes: Buffer): Promise<unknown> {
    const form = new FormData();
    form.append('exportId', exportId);
    form.append('file', new Blob([bytes]), `${exportId}.artifact`);
    return this.postMultipart('/deliver/export/upload', form);
  }

  async exportFail(exportId: string, errorMsg: string): Promise<void> {
    await this.post('/deliver/export/fail', { exportId, errorMsg });
  }

  async finalizedContent(deckId: string): Promise<Record<string, unknown>> {
    const deck = await this.deckGet(deckId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, '创作物不存在');
    }
    const finalVersionId = deck.finalVersionId;
    if (deck.deckStatus !== 'FINALIZED' || finalVersionId == null || finalVersionId.length === 0) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '创作物未定稿');
    }
    const detail = await this.versionDetail(finalVersionId);
    return detail['content'] as Record<string, unknown>;
  }

  async resolveImages(content: Record<string, unknown>): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const assetIds = extractAssetIds(content);
    if (assetIds.length === 0) {
      return urls;
    }
    const rows = (await this.post('/asset/asset/file-url', { assetIds })) as Array<{
      assetId: string;
      fileUrl: string | null;
    }>;
    for (const row of rows) {
      if (row.fileUrl == null || row.fileUrl.length === 0) {
        continue;
      }
      urls.set(row.assetId, await this.downloadAsDataUri(row.fileUrl));
    }
    return urls;
  }

  async close(): Promise<void> {
    // HTTP 无持久连接需释放（fetch keep-alive 由运行时管理）
  }

  /* ---------------- HTTP 基础设施 ---------------- */

  /** JSON POST + Result 信封解包（错误透传 D7） */
  private async post(path: string, body: unknown): Promise<unknown> {
    const url = this.baseUrl + path;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Token': this.apiToken,
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch (error) {
      throw unreachable(url, error instanceof Error ? error.message : String(error));
    }
    return this.unwrap(res, url);
  }

  /** multipart POST（upload；boundary 由 FormData 自动设置） */
  private async postMultipart(path: string, form: FormData): Promise<unknown> {
    const url = this.baseUrl + path;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Api-Token': this.apiToken },
        body: form,
      });
    } catch (error) {
      throw unreachable(url, error instanceof Error ? error.message : String(error));
    }
    return this.unwrap(res, url);
  }

  /** Result 解包：status≠success → {code,msg} 原样抛错（防枚举提示映射除外） */
  private async unwrap(res: Response, url: string): Promise<unknown> {
    if (!res.ok) {
      throw unreachable(url, `HTTP ${res.status}`);
    }
    let envelope: ResultEnvelope;
    try {
      envelope = (await res.json()) as ResultEnvelope;
    } catch (error) {
      throw unreachable(url, `响应非 JSON（${error instanceof Error ? error.message : String(error)}）`);
    }
    if (envelope.status !== true) {
      const code = typeof envelope.code === 'string' ? envelope.code : 'ERROR';
      const msg =
        code === AUTH_TOKEN_INVALID || code === AUTH_SESSION_EXPIRED
          ? TOKEN_INVALID_HINT
          : typeof envelope.msg === 'string'
            ? envelope.msg
            : '远程调用失败';
      throw Object.assign(new Error(msg), { code });
    }
    return envelope.data ?? null;
  }

  /** 签名 URL 下载 → data URI（素材渲染输入；10MB 上限同本地口径） */
  private async downloadAsDataUri(fileUrl: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(fileUrl);
    } catch (error) {
      throw unreachable(fileUrl, error instanceof Error ? error.message : String(error));
    }
    if (!res.ok) {
      throw unreachable(fileUrl, `HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('图片素材超过10MB');
    }
    const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
}

/** 网络层失败归一（含 URL/状态码，不含 token） */
function unreachable(url: string, detail: string): Error {
  return Object.assign(new Error(`远程服务不可达：${url}（${detail}）`), {
    code: REMOTE_UNREACHABLE,
  });
}