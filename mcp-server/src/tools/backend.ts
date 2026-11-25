/**
 * ToolBackend 装配缝（ADR-018 §4.2）：local=LocalBackend（LocalCore 进程内直调，
 * ADR-017 现状）；remote=RemoteClient（HTTP + X-Api-Token，api-web-agent §5.5）。
 * **28 tools 名称/入参 schema/语义/回执结构两模式完全一致**——tools 只消费本接口，
 * 不感知后端形态。
 *
 * 类型口径：通用 AO 入参 Record<string, unknown>（zod 解析产物直传）；通用回执
 * unknown（ok() JSON 序列化）；需字段访问的回执定义为结构快照类型。
 */
import type { OutlineNode } from './outline';

/** deck 快照（outline_save/preview_deck/version_create 守卫消费） */
export interface DeckSnapshot {
  deckId: string;
  deckName: string;
  deckStatus: string;
  currentVersionId: string | null;
  activeBranch: string;
  finalVersionId?: string | null;
}

/** version_create 入参（两模式同 schema） */
export interface VersionCreateInput {
  deckId: string;
  content: Record<string, unknown>;
  instruction: string;
  parentVersionId?: string;
  branchName?: string;
  scope?: { pageId: string; blockId?: string };
}

/** version_create 回执（api-web-agent §4.2 VO；两模式一致） */
export interface VersionCreateReceipt {
  versionId: string;
  versionSeq: number;
  sourceType: string;
  taskId: string;
  branchName: string;
}

/** export submit 回执（exportId 空串=PPTX 未 confirm 提示态） */
export interface ExportSubmitReceipt {
  exportId: string;
  exportStatus: string;
  needConfirm: boolean;
}

/** asset_add 本地文件载荷（remote 转 multipart） */
export interface AssetUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface ToolBackend {
  readonly mode: 'local' | 'remote';

  /* deck 域 */
  deckSave(ao: Record<string, unknown>): Promise<unknown>;
  deckList(ao: Record<string, unknown>): Promise<unknown>;
  deckDetail(ao: Record<string, unknown>): Promise<unknown>;
  deckGet(deckId: string): Promise<DeckSnapshot | null>;
  deckFinalize(deckId: string): Promise<void>;
  deckUnfinalize(deckId: string): Promise<void>;
  deckArchive(deckId: string): Promise<void>;
  deckRestore(deckId: string): Promise<void>;
  deckDelete(deckId: string): Promise<void>;
  /** 大纲保存（local 预校验+直写；remote 映射 /deck/deck/outline-save） */
  outlineSave(deckId: string, nodes: OutlineNode[]): Promise<void>;

  /* version 域 */
  versionCreate(input: VersionCreateInput): Promise<VersionCreateReceipt>;
  versionTree(ao: Record<string, unknown>): Promise<unknown>;
  /** 版本详情完整 VO（content/instructionSnapshot/contentHash/versionSeq 等；两模式同回执） */
  versionDetail(versionId: string): Promise<Record<string, unknown>>;
  versionCompare(ao: Record<string, unknown>): Promise<unknown>;
  versionRollback(deckId: string, versionId: string): Promise<void>;
  versionFork(deckId: string, versionId: string, branchName: string): Promise<void>;

  /* asset 域 */
  assetUpload(file: AssetUploadFile, ao: Record<string, unknown>): Promise<unknown>;
  assetList(ao: Record<string, unknown>): Promise<unknown>;
  brandkitSave(ao: Record<string, unknown>): Promise<unknown>;
  brandkitList(ao: Record<string, unknown>): Promise<unknown>;
  brandkitSetDefault(brandKitId: string): Promise<void>;
  brandkitDelete(brandKitId: string): Promise<void>;
  promptSave(ao: Record<string, unknown>): Promise<unknown>;
  promptList(ao: Record<string, unknown>): Promise<unknown>;
  promptDelete(templateId: string): Promise<void>;

  /* deliver 域（渲染始终本地；产物经 upload/fail 回传） */
  exportSubmit(ao: Record<string, unknown>): Promise<ExportSubmitReceipt>;
  exportList(ao: Record<string, unknown>): Promise<unknown>;
  exportUpload(exportId: string, bytes: Buffer): Promise<unknown>;
  exportFail(exportId: string, errorMsg: string): Promise<void>;
  /** 定稿版本 content（export_deck 渲染输入；FINALIZED 守卫） */
  finalizedContent(deckId: string): Promise<Record<string, unknown>>;

  /** 素材解析：assetId → data URI（local 文件直读；remote 签名 URL 下载） */
  resolveImages(content: Record<string, unknown>): Promise<Map<string, string>>;

  close(): Promise<void>;
}