/**
 * 导出产物对象存储 —— v1 LocalExportArtifactStorage 对齐（api-delivery D1：
 * 云端渲染产物入对象存储；当前本地目录落盘，生产替换 OSS/S3 时仅替换本实现，
 * key 契约不变）。
 *
 * - key 形态：{userId}/{exportId}.{ext}；写入经临时文件替换（rename），避免半写文件可见
 * - 路径防穿越：storage key 仅由白名单字符构成（userId/exportId 雪花段、小写扩展名），
 *   load 入口二次校验 key 形态，落盘前校验拼接结果仍在根目录内（asset 域 storage 同款）
 * - env 直读（不引 config 包）；默认值对齐 v1 DeliverProperties.artifactDir
 */
import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_EXPORT_ARTIFACT_DIR,
  ENV_EXPORT_ARTIFACT_DIR,
} from './deliver.constant';

/** 存储 key 白名单形态：{userId}/{exportId}.{ext}（雪花段×2、ext 小写字母数字） */
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}\/[A-Za-z0-9_-]{1,32}\.[a-z0-9]{1,8}$/;

/** userId / exportId 白名单（雪花串形态） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 扩展名白名单（小写字母数字） */
const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value : fallback;
}

@Injectable()
export class ExportArtifactStorageService {
  private readonly rootDir: string;

  constructor() {
    this.rootDir = readEnv(ENV_EXPORT_ARTIFACT_DIR, DEFAULT_EXPORT_ARTIFACT_DIR);
  }

  /**
   * 存储产物字节，返回存储 key（{userId}/{exportId}.{ext}）。
   * 入参（userId/exportId/extension）均经白名单校验后拼接——同 key 重写等价
   * （临时文件 + rename 原子替换）。
   */
  async store(userId: string, exportId: string, extension: string, bytes: Buffer): Promise<string> {
    if (!ID_PATTERN.test(userId)) {
      throw new Error('导出产物落盘 userId 非白名单格式');
    }
    if (!ID_PATTERN.test(exportId)) {
      throw new Error('导出产物落盘 exportId 非白名单格式');
    }
    if (!EXTENSION_PATTERN.test(extension)) {
      throw new Error('导出产物落盘扩展名非白名单格式');
    }
    const root = resolve(this.rootDir);
    const storageKey = `${userId}/${exportId}.${extension}`;
    const target = join(root, storageKey);
    // 防穿越兜底：拼接结果必须仍在根目录之内
    if (!target.startsWith(root + sep)) {
      throw new Error('导出产物落盘路径越界');
    }
    await mkdir(join(root, userId), { recursive: true });
    const temp = join(root, userId, `render-${randomUUID()}.tmp`);
    await writeFile(temp, bytes);
    await rename(temp, target);
    return storageKey;
  }

  /**
   * 按存储 key 读取产物字节。
   *
   * @return 产物字节；key 非白名单形态/文件不存在返回 null（调用方转 NOT_DOWNLOADABLE）
   */
  async load(storageKey: string): Promise<Buffer | null> {
    if (storageKey == null || storageKey.trim().length === 0 || !STORAGE_KEY_PATTERN.test(storageKey)) {
      return null;
    }
    const root = resolve(this.rootDir);
    const source = join(root, storageKey);
    if (!source.startsWith(root + sep)) {
      return null;
    }
    try {
      return await readFile(source);
    } catch {
      return null;
    }
  }
}
