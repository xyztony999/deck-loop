/**
 * 雪花 ID 生成器（进程内单例，string 输出）：
 * - 63 位：41 位毫秒时间戳（自定义纪元 2026-01-01）+ 10 位 workerId + 12 位序列
 * - 超过 Number.MAX_SAFE_INTEGER，全程 BigInt 计算，仅 string 输出（业务主键 string 字段，NR-08）
 * - 时钟回拨保护：沿用上次时间戳由序列位推进；同毫秒序列耗尽自旋至下一毫秒
 * - 单实例假设（node-specs 20 §5）；多实例部署时以 SNOWFLAKE_WORKER_ID 区分位段
 */

const EPOCH_MS = 1767225600000n; // 2026-01-01T00:00:00.000Z（Date.UTC(2026,0,1)）
const WORKER_ID_BITS = 10n;
const SEQUENCE_BITS = 12n;
const MAX_WORKER_ID = (1n << WORKER_ID_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095

export class Snowflake {
  private lastTimestamp = -1n;
  private sequence = 0n;

  constructor(readonly workerId: bigint = 1n) {
    if (workerId < 0n || workerId > MAX_WORKER_ID) {
      throw new RangeError(`workerId must be in [0, ${MAX_WORKER_ID.toString()}]`);
    }
  }

  /** 生成下一个 id（十进制字符串） */
  next(): string {
    let timestamp = BigInt(Date.now());
    if (timestamp < this.lastTimestamp) {
      // 时钟回拨：沿用上次时间戳，序列位继续推进保证不重号
      timestamp = this.lastTimestamp;
    }
    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // 本毫秒序列耗尽：自旋到下一毫秒
        do {
          timestamp = BigInt(Date.now());
        } while (timestamp <= this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }
    this.lastTimestamp = timestamp;

    const id =
      ((timestamp - EPOCH_MS) << (WORKER_ID_BITS + SEQUENCE_BITS)) |
      (this.workerId << SEQUENCE_BITS) |
      this.sequence;
    return id.toString();
  }
}

const envWorkerId = Number.parseInt(process.env.SNOWFLAKE_WORKER_ID ?? '1', 10);
const workerId =
  Number.isInteger(envWorkerId) && envWorkerId >= 0 && envWorkerId <= 1023
    ? BigInt(envWorkerId)
    : 1n;

/** 进程内单例 */
const snowflake = new Snowflake(workerId);

/** 生成下一个雪花 id（string） */
export function nextId(): string {
  return snowflake.next();
}
