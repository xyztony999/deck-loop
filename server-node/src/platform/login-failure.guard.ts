import { Injectable } from '@nestjs/common';

/**
 * 登录失败锁定守卫（api-platform §4.4 login：失败 5 次锁 10 分钟；
 * v1 LoginFailureGuard 平移）。内存实现（单服务部署，ADR-006 云端单服务）；
 * 重启清零可接受（NR-13 单实例假设）。
 */
@Injectable()
export class LoginFailureGuard {
  /** 连续失败锁定阈值 */
  private static readonly MAX_FAILS = 5;

  /** 锁定时长（分钟） */
  private static readonly LOCK_MINUTES = 10;

  private readonly states = new Map<string, FailureState>();

  /** 登录前检查：锁定中返回 true */
  isLocked(email: string): boolean {
    const state = this.states.get(email);
    return state !== undefined && state.lockedUntil > Date.now();
  }

  /** 剩余锁定毫秒（未锁定返回 0） */
  lockedRemainMillis(email: string): number {
    const state = this.states.get(email);
    if (state === undefined) {
      return 0;
    }
    return Math.max(0, state.lockedUntil - Date.now());
  }

  /** 记录一次失败；触发阈值时锁定（计数归零，锁后再失败重新累计） */
  recordFail(email: string): void {
    const previous = this.states.get(email);
    const state: FailureState =
      previous === undefined ? { fails: 0, lockedUntil: 0 } : previous;
    state.fails += 1;
    if (state.fails >= LoginFailureGuard.MAX_FAILS) {
      state.lockedUntil = Date.now() + LoginFailureGuard.LOCK_MINUTES * 60 * 1000;
      state.fails = 0;
    }
    this.states.set(email, state);
  }

  /** 登录成功清除计数 */
  clear(email: string): void {
    this.states.delete(email);
  }
}

interface FailureState {
  fails: number;
  lockedUntil: number;
}
