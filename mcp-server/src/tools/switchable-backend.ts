/**
 * 双模式动态后端（ADR-019 市场包）：ToolBackend 缝不变，运行时按配置持
 * local（sql.js/better-sqlite3，懒加载）或 remote（RemoteClient）委托。
 *
 * 配置 ~/.deck-loop/config.json：{mode, apiUrl?, token?}。remote_connect 登录
 * 成功后自动签发个人 token 并落盘（**密码永不落盘**）；disconnect 回 local。
 * 28 业务 tools 无感知——全部经本类委托；account tools 经 connect/disconnect/status。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LocalPaths } from '../paths';
import type { ToolBackend, DeckSnapshot, VersionCreateInput, VersionCreateReceipt, ExportSubmitReceipt, AssetUploadFile } from './backend';
import type { OutlineNode } from './outline';
import { RemoteClient } from './remote-client';

export interface PluginConfig {
  mode: 'local' | 'remote';
  apiUrl?: string;
  token?: string;
  tokenPrefix?: string;
  expiresAt?: number | null;
}

export interface ConnectionStatus {
  mode: 'local' | 'remote';
  apiUrl: string | null;
  tokenPrefix: string | null;
  expiresAt: number | null;
  localDatabase: string;
}

function configPath(paths: LocalPaths): string {
  return paths.home + '/config.json';
}

function loadConfig(paths: LocalPaths): PluginConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(paths), 'utf8')) as PluginConfig;
    return raw.mode === 'remote' ? raw : { mode: 'local' };
  } catch {
    return { mode: 'local' };
  }
}

function saveConfig(paths: LocalPaths, cfg: PluginConfig): void {
  mkdirSync(dirname(configPath(paths)), { recursive: true });
  writeFileSync(configPath(paths), JSON.stringify(cfg, null, 2), 'utf8');
}

/** 服务端 Result 信封解包（login/issue 共用；失败抛带 code 的 Error） */
async function postJson(baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { status: boolean; code?: string; msg?: string; data?: any };
  if (json.status === false) {
    const err = new Error(json.msg ?? '请求失败') as Error & { code?: string };
    err.code = json.code;
    throw err;
  }
  return json.data;
}

export class SwitchableBackend implements ToolBackend {
  private remote: RemoteClient | null = null;
  private localPromise: Promise<ToolBackend> | null = null;
  private localBackend: ToolBackend | null = null;
  private cfg: PluginConfig;

  constructor(private readonly paths: LocalPaths, private readonly userId: string) {
    // 优先级：env（工具 MCP 配置预置）> config.json（remote_connect 落盘）> 默认 local
    const envUrl = process.env.DECK_LOOP_API_URL?.trim();
    const envToken = process.env.DECK_LOOP_API_TOKEN?.trim();
    if (envUrl && envToken) {
      this.cfg = { mode: 'remote', apiUrl: envUrl.replace(/\/+$/, ''), token: envToken };
    } else {
      this.cfg = loadConfig(paths);
    }
    if (this.cfg.mode === 'remote' && this.cfg.apiUrl && this.cfg.token) {
      this.remote = new RemoteClient({ apiUrl: this.cfg.apiUrl, apiToken: this.cfg.token });
    }
  }

  get mode(): 'local' | 'remote' {
    return this.remote != null ? 'remote' : 'local';
  }

  private active(): Promise<ToolBackend> {
    if (this.remote != null) {
      return Promise.resolve(this.remote);
    }
    if (this.localPromise == null) {
      this.localPromise = (async () => {
        // DECK_LOOP_DB 先于 core entity import（列类型常量求值时序）
        process.env.DECK_LOOP_DB = 'sqlite';
        const { createLocalCore } = await import('@deck-loop/core/dist/local');
        const { initLocalEngine } = await import('../local-engine');
        const { LocalBackend } = await import('./local-backend');
        const { engine, driver } = await initLocalEngine();
        const core = await createLocalCore({ database: this.paths.database, engine, driver });
        this.localBackend = new LocalBackend(core, this.userId, this.paths);
        return this.localBackend;
      })();
    }
    return this.localPromise;
  }

  /* ---------------- 连接管理（account tools 消费） ---------------- */

  /** 登录 deck-loop 账号 → 自动签发个人 token → 落盘 → 切 remote（密码不落盘） */
  async connectRemote(apiUrl: string, email: string, password: string): Promise<ConnectionStatus> {
    const base = apiUrl.replace(/\/+$/, '');
    const login = await postJson(base, '/auth/account/login', { email, password });
    const issued = await postJson(
      base,
      '/auth/token/issue',
      { tokenName: 'deck-loop-plugin' },
      { 'X-Auth-Token': login.token },
    );
    this.cfg = {
      mode: 'remote',
      apiUrl: base,
      token: issued.token,
      tokenPrefix: issued.tokenPrefix,
      expiresAt: issued.expiresAt ?? null,
    };
    saveConfig(this.paths, this.cfg);
    this.remote = new RemoteClient({ apiUrl: base, apiToken: issued.token });
    return this.status();
  }

  /** 断开远程 → 回 local（保留本地库；远程 token 配置清除） */
  disconnectRemote(): ConnectionStatus {
    this.remote = null;
    this.cfg = { mode: 'local' };
    saveConfig(this.paths, this.cfg);
    return this.status();
  }

  status(): ConnectionStatus {
    return {
      mode: this.mode,
      apiUrl: this.cfg.apiUrl ?? null,
      tokenPrefix: this.cfg.tokenPrefix ?? null,
      expiresAt: this.cfg.expiresAt ?? null,
      localDatabase: this.paths.database,
    };
  }

  /* ---------------- ToolBackend 委托（31 方法） ---------------- */

  async deckSave(ao: Record<string, unknown>) { return (await this.active()).deckSave(ao); }
  async deckList(ao: Record<string, unknown>) { return (await this.active()).deckList(ao); }
  async deckDetail(ao: Record<string, unknown>) { return (await this.active()).deckDetail(ao); }
  async deckGet(deckId: string): Promise<DeckSnapshot | null> { return (await this.active()).deckGet(deckId); }
  async deckFinalize(deckId: string) { return (await this.active()).deckFinalize(deckId); }
  async deckUnfinalize(deckId: string) { return (await this.active()).deckUnfinalize(deckId); }
  async deckArchive(deckId: string) { return (await this.active()).deckArchive(deckId); }
  async deckRestore(deckId: string) { return (await this.active()).deckRestore(deckId); }
  async deckDelete(deckId: string) { return (await this.active()).deckDelete(deckId); }
  async outlineSave(deckId: string, nodes: OutlineNode[]) { return (await this.active()).outlineSave(deckId, nodes); }
  async versionCreate(input: VersionCreateInput): Promise<VersionCreateReceipt> { return (await this.active()).versionCreate(input); }
  async versionTree(ao: Record<string, unknown>) { return (await this.active()).versionTree(ao); }
  async versionDetail(versionId: string) { return (await this.active()).versionDetail(versionId); }
  async versionCompare(ao: Record<string, unknown>) { return (await this.active()).versionCompare(ao); }
  async versionRollback(deckId: string, versionId: string) { return (await this.active()).versionRollback(deckId, versionId); }
  async versionFork(deckId: string, versionId: string, branchName: string) { return (await this.active()).versionFork(deckId, versionId, branchName); }
  async assetUpload(file: AssetUploadFile, ao: Record<string, unknown>) { return (await this.active()).assetUpload(file, ao); }
  async assetList(ao: Record<string, unknown>) { return (await this.active()).assetList(ao); }
  async brandkitSave(ao: Record<string, unknown>) { return (await this.active()).brandkitSave(ao); }
  async brandkitList(ao: Record<string, unknown>) { return (await this.active()).brandkitList(ao); }
  async brandkitSetDefault(brandKitId: string) { return (await this.active()).brandkitSetDefault(brandKitId); }
  async brandkitDelete(brandKitId: string) { return (await this.active()).brandkitDelete(brandKitId); }
  async promptSave(ao: Record<string, unknown>) { return (await this.active()).promptSave(ao); }
  async promptList(ao: Record<string, unknown>) { return (await this.active()).promptList(ao); }
  async promptDelete(templateId: string) { return (await this.active()).promptDelete(templateId); }
  async exportSubmit(ao: Record<string, unknown>): Promise<ExportSubmitReceipt> { return (await this.active()).exportSubmit(ao); }
  async exportList(ao: Record<string, unknown>) { return (await this.active()).exportList(ao); }
  async exportUpload(exportId: string, bytes: Buffer) { return (await this.active()).exportUpload(exportId, bytes); }
  async exportFail(exportId: string, errorMsg: string) { return (await this.active()).exportFail(exportId, errorMsg); }
  async finalizedContent(deckId: string) { return (await this.active()).finalizedContent(deckId); }
  async resolveImages(content: Record<string, unknown>) { return (await this.active()).resolveImages(content); }

  async close(): Promise<void> {
    if (this.localBackend != null) {
      await this.localBackend.close();
    }
  }
}