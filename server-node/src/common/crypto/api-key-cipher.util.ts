/**
 * API Key 加解密工具（渠道管理端，channel-admin-2026-10-23 设计 §2）：
 * AES-256-GCM；密文格式 `v1.<ivB64>.<tagB64>.<dataB64>`。
 *
 * 主密钥 env `CONFIG_ENC_KEY`（缺失时回退派生并告警——生产必配）：
 * - 64 位 hex → 直接 32 字节；
 * - 24 位 base64（解码 32 字节）→ 直接；
 * - 其余任意口令 → sha256 派生 32 字节。
 *
 * 安全约定（INV-26 延续）：明文只出现在调用方内存；密文入库；解密失败一律返回
 * null（按未配置处理），绝不抛出密钥材料相关细节。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER_PREFIX = 'v1';

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey !== null) {
    return cachedKey;
  }
  const raw = process.env.CONFIG_ENC_KEY ?? '';
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    key = Buffer.from(raw, 'base64');
  } else {
    key = createHash('sha256').update(`dl-config:${raw}`).digest();
  }
  cachedKey = key;
  return key;
}

function hasMasterKeyConfigured(): boolean {
  return (process.env.CONFIG_ENC_KEY ?? '').trim().length > 0;
}

/** 加密 API Key（明文非空才加密；空串原样返回空串） */
export function encryptApiKey(plain: string): string {
  if (plain.length === 0) {
    return '';
  }
  if (!hasMasterKeyConfigured()) {
    // 一次性告警（进程级去重由调用方日志频率自然承担）；开发/测试可用
    console.warn('[api-key-cipher] CONFIG_ENC_KEY 未配置，正在使用派生默认密钥（生产必配）');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    data.toString('base64'),
  ].join('.');
}

/** 解密 API Key（格式/密钥/完整性任何异常 → null，按未配置处理） */
export function decryptApiKey(payload: string | null | undefined): string | null {
  if (typeof payload !== 'string' || payload.length === 0) {
    return null;
  }
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== CIPHER_PREFIX) {
    return null;
  }
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 密钥掩码（尾 4 位；不足 4 位全掩码） */
export function maskApiKey(plain: string): string {
  if (plain.length === 0) {
    return '';
  }
  const tail = plain.slice(-4);
  return `●●●●${tail}`;
}
