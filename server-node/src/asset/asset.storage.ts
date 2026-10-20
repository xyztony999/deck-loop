/**
 * 素材对象存储 —— v1 LocalAssetStorageServiceImpl 对齐（api-assets.md §3.2：
 * 对象存储为基础设施；生产接 OSS/S3 预签名 URL 时仅替换本实现，调用方签名不变）。
 *
 * - 内容寻址落盘：{localDir}/{userId}/{fileHash}.{ext}（临时文件写完 rename，
 *   避免半写文件可见）
 * - 限时签名 URL：{publicBaseUrl}/{storageKey}?expires={epochSeconds}&sign={hmac}，
 *   HMAC-SHA256(key, storageKey + ':' + expires)，key=env ASSET_URL_SECRET（NR-06：
 *   仅 env，禁入库/禁进 VO/禁日志）
 * - 路径防穿越：storage key 仅由白名单字符构成（userId 雪花段/hash hex64/小写扩展名），
 *   signUrl 入口二次校验 key 形态，落盘前校验拼接结果仍在根目录内
 * - env 直读（不引 config 包，对齐 app.module.ts 口径）；默认值对齐 v1
 *   AssetStorageProperties
 */
import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  DEFAULT_ASSET_STORAGE_DIR,
  DEFAULT_ASSET_URL_PUBLIC_BASE_URL,
  DEFAULT_ASSET_URL_SECRET,
  DEFAULT_ASSET_URL_TTL_SECONDS,
  ENV_ASSET_STORAGE_DIR,
  ENV_ASSET_URL_PUBLIC_BASE_URL,
  ENV_ASSET_URL_SECRET,
  ENV_ASSET_URL_TTL_SECONDS,
} from './asset.constant';

/** 存储 key 白名单形态：{userId}/{hash64}.{ext}（userId 雪花段、hash 十六进制、ext 小写字母数字） */
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

/** userId 白名单（雪花串/账号 id 形态） */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** fileHash 白名单（SHA-256 十六进制 64 位） */
const FILE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** 扩展名白名单（小写字母数字） */
const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value : fallback;
}

function readEnvInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class AssetStorageService {
  private readonly localDir: string;
  private readonly publicBaseUrl: string;
  private readonly signKey: string;
  private readonly ttlSeconds: number;

  constructor() {
    this.localDir = readEnv(ENV_ASSET_STORAGE_DIR, DEFAULT_ASSET_STORAGE_DIR);
    this.publicBaseUrl = readEnv(
      ENV_ASSET_URL_PUBLIC_BASE_URL,
      DEFAULT_ASSET_URL_PUBLIC_BASE_URL,
    ).replace(/\/+$/, '');
    this.signKey = readEnv(ENV_ASSET_URL_SECRET, DEFAULT_ASSET_URL_SECRET);
    this.ttlSeconds = readEnvInt(ENV_ASSET_URL_TTL_SECONDS, DEFAULT_ASSET_URL_TTL_SECONDS);
  }

  /** 默认签发有效期（秒），供调用方回填 VO 的 expiresIn */
  defaultTtlSeconds(): number {
    return this.ttlSeconds;
  }

  /**
   * 存储文件字节，返回存储 key。
   * 入参（userId/fileHash/extension）均经白名单校验后拼接——内容寻址同 key
   * 重写等价（临时文件 + rename 原子替换）。
   */
  async store(
    userId: string,
    fileHash: string,
    extension: string,
    bytes: Buffer,
  ): Promise<string> {
    if (!USER_ID_PATTERN.test(userId)) {
      throw new Error('素材落盘 userId 非白名单格式');
    }
    if (!FILE_HASH_PATTERN.test(fileHash)) {
      throw new Error('素材落盘 fileHash 非白名单格式');
    }
    if (!EXTENSION_PATTERN.test(extension)) {
      throw new Error('素材落盘扩展名非白名单格式');
    }
    const rootDir = resolve(this.localDir);
    const storageKey = `${userId}/${fileHash}.${extension}`;
    const target = join(rootDir, storageKey);
    // 防穿越兜底：拼接结果必须仍在根目录之内
    if (!target.startsWith(rootDir + sep)) {
      throw new Error('素材落盘路径越界');
    }
    await mkdir(join(rootDir, userId), { recursive: true });
    const temp = join(rootDir, userId, `upload-${randomUUID()}.tmp`);
    await writeFile(temp, bytes);
    await rename(temp, target);
    return storageKey;
  }

  /** 生成限时访问 URL（HMAC-SHA256 签名，URL 形态与 v1 逐字一致） */
  signUrl(storageKey: string, ttlSeconds: number = this.ttlSeconds): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error('素材签名 storageKey 非白名单格式（疑似路径穿越）');
    }
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sign = this.hmacHex(`${storageKey}:${expires}`);
    return `${this.publicBaseUrl}/${storageKey}?expires=${expires}&sign=${sign}`;
  }

  /** 签名 URL 对应的过期时刻（epoch 毫秒，OHS expiresAt 组装用） */
  expiresAtFor(ttlSeconds: number = this.ttlSeconds): number {
    return (Math.floor(Date.now() / 1000) + ttlSeconds) * 1000;
  }

  /**
   * 校验限时 URL 凭证并返回文件绝对路径（GET /files 消费；与 signUrl 对偶）。
   * 校验链：storageKey 白名单形态 → expires 正整数且未过期 → HMAC 常量时间
   * 比较 → 解析路径必须仍在存储根内。任一失败抛 Error（经全局过滤器转
   * 错误信封；<img>/fetch 消费方按非图像响应自然失败）。
   */
  verifySigned(storageKey: string, expires: string, sign: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error('素材访问 storageKey 非白名单格式（疑似路径穿越）');
    }
    const exp = Number.parseInt(String(expires ?? ''), 10);
    if (!Number.isInteger(exp) || exp <= 0) {
      throw new Error('素材访问凭证无效');
    }
    if (exp * 1000 < Date.now()) {
      throw new Error('素材访问凭证已过期');
    }
    const expected = Buffer.from(this.hmacHex(`${storageKey}:${exp}`), 'utf8');
    const actual = Buffer.from(String(sign ?? ''), 'utf8');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('素材访问签名不匹配');
    }
    const rootDir = resolve(this.localDir);
    const target = join(rootDir, storageKey);
    if (!target.startsWith(rootDir + sep)) {
      throw new Error('素材访问路径越界');
    }
    return target;
  }

  private hmacHex(data: string): string {
    return createHmac('sha256', this.signKey).update(data, 'utf8').digest('hex');
  }
}
