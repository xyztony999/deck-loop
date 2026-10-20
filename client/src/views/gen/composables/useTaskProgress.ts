/**
 * 任务进度跟踪组合式（gen 模块专属）。
 *
 * 双通道策略（api-generation.md §3.1 / api-platform.md D4）：
 * - 基线：批量轮询 POST /gen/task/progress（2s 间隔，taskIds ≤20）；
 * - 增强：GET /gw/task/stream SSE（原生 EventSource，token 走 query ——
 *   EventSource 无法自定义 X-Auth-Token 头）。SSE 连接健康时停轮询。
 *
 * 降级铁律：SSE 建立/解析/连断失败一律静默回退轮询，不打扰用户
 * （连续失败 3 次后彻底放弃重连，避免 EventSource 无限重试噪音）。
 */
import { onBeforeUnmount, reactive, ref } from 'vue'

import { executeAction } from '@/engine/actionExecutor'
import { useAuthStore } from '@/stores/auth'
import type { TaskProgressItem } from '../types'
import { TASK_STATUS, isTerminalTaskStatus } from '../types'

/** 轮询间隔（api-generation §3.1：客户端 2s） */
const POLL_INTERVAL_MS = 2000
/** progress 批量上限（api-generation §4.4：taskIds ≤20） */
const POLL_BATCH_LIMIT = 20
/** SSE 连续出错多少次后放弃（静默转纯轮询） */
const SSE_MAX_ERRORS = 3

/** 单个任务的进度快照 */
export interface TaskProgressInfo extends TaskProgressItem {
  taskId: string
  taskStatus: string
  progressPercent: number
  stageText: string
  /** 失败摘要（终态 FAILED 时由 task/detail 回填） */
  errorMsg?: string
}

/** 进度更新输入：轮询 VO 形态或 SSE 载荷形态（percent） */
type ProgressInput = Partial<Omit<TaskProgressItem, 'taskId'>> & {
  taskId: string
  percent?: number
}

export interface UseTaskProgressOptions {
  /** SSE 订阅按 deck 过滤（可选，GET /gw/task/stream Query deckId） */
  deckId?: () => string | undefined
  /** 任务到终态回调（每个 taskId 至多触发一次；含 SUCCEEDED/FAILED/CANCELLED） */
  onFinished?: (info: TaskProgressInfo) => void
}

export function useTaskProgress(options: UseTaskProgressOptions = {}) {
  const auth = useAuthStore()

  /** taskId → 进度快照（reactive Map，模板可直接遍历） */
  const tasks = reactive(new Map<string, TaskProgressInfo>())
  /** SSE 通道是否健康（健康时轮询让位） */
  const sseHealthy = ref(false)

  const finishedFired = new Set<string>()
  let pollTimer: number | undefined
  let source: EventSource | null = null
  let sseErrorCount = 0
  let sseAbandoned = false

  // -------------------------------------------------------------
  // 状态合并（轮询 VO 与 SSE 载荷在此归一：percent/progressPercent）
  // -------------------------------------------------------------

  function applyUpdate(next: ProgressInput): void {
    const cur = tasks.get(next.taskId)
    if (!cur) return
    if (next.taskStatus) cur.taskStatus = next.taskStatus
    if (typeof next.progressPercent === 'number') {
      cur.progressPercent = clampPercent(next.progressPercent)
    }
    if (next.stageText) cur.stageText = next.stageText

    if (isTerminalTaskStatus(cur.taskStatus) && !finishedFired.has(cur.taskId)) {
      finishedFired.add(cur.taskId)
      options.onFinished?.({ ...cur, errorMsg: cur.errorMsg })
      maybeReleaseSse()
    }
  }

  function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)))
  }

  // -------------------------------------------------------------
  // 基线：批量轮询（SSE 健康时跳过）
  // -------------------------------------------------------------

  function activeTaskIds(): string[] {
    return [...tasks.entries()]
      .filter(([, t]) => !isTerminalTaskStatus(t.taskStatus))
      .map(([id]) => id)
  }

  async function pollOnce(): Promise<void> {
    if (sseHealthy.value) return // SSE 连接成功停轮询（adjustment.md 同款策略）
    const ids = activeTaskIds().slice(0, POLL_BATCH_LIMIT)
    if (ids.length === 0) return
    try {
      const items = await executeAction<TaskProgressItem[]>('gen.taskProgress', {
        taskIds: ids,
      })
      for (const it of items ?? []) {
        if (it && typeof it.taskId === 'string') applyUpdate(it)
      }
    } catch {
      // 弱网容忍：本轮失败静默，下一轮重试（不 message 打扰）
    }
  }

  function ensurePolling(): void {
    if (pollTimer != null) return
    pollTimer = window.setInterval(() => {
      void pollOnce()
    }, POLL_INTERVAL_MS)
  }

  // -------------------------------------------------------------
  // 增强：SSE（GET /gw/task/stream?token=..&deckId=..）
  // -------------------------------------------------------------

  function connectSse(): void {
    if (source || sseAbandoned || typeof EventSource === 'undefined') return
    const token = auth.token
    if (!token) return // 未登录：纯轮询兜底

    const params = new URLSearchParams({ token })
    const deckId = options.deckId?.()
    if (deckId) params.set('deckId', deckId)

    try {
      source = new EventSource(`/api/gw/task/stream?${params.toString()}`)
    } catch {
      sseAbandoned = true // 环境不支持：静默降级
      return
    }

    source.onopen = () => {
      sseHealthy.value = true
      sseErrorCount = 0
    }
    source.onerror = () => {
      // 静默降级：标记不健康让轮询接管；连续失败后彻底关闭
      sseHealthy.value = false
      sseErrorCount += 1
      if (sseErrorCount >= SSE_MAX_ERRORS) {
        source?.close()
        source = null
        sseAbandoned = true
      }
    }
    source.addEventListener('task-progress', (ev: MessageEvent) => {
      // 载荷 {taskId,percent,stageText}（api-platform.md §4.4）
      const parsed = parseEvent(ev)
      if (parsed) applyUpdate({ ...parsed, progressPercent: parsed.percent })
    })
    source.addEventListener('task-finished', (ev: MessageEvent) => {
      // 载荷 {taskId,taskStatus}
      const parsed = parseEvent(ev)
      if (parsed) applyUpdate(parsed)
    })
  }

  function parseEvent(ev: MessageEvent): ProgressInput | null {
    try {
      const raw = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
      if (
        raw &&
        typeof raw === 'object' &&
        typeof (raw as { taskId?: unknown }).taskId === 'string' &&
        (raw as { taskId?: unknown }).taskId !== ''
      ) {
        return raw as ProgressInput
      }
      return null
    } catch {
      return null // 脏载荷静默丢弃
    }
  }

  /** 全部任务终态后释放 SSE 连接（下次 track 重连） */
  function maybeReleaseSse(): void {
    if (activeTaskIds().length === 0 && source) {
      source.close()
      source = null
      sseHealthy.value = false
    }
  }

  // -------------------------------------------------------------
  // 对外句柄
  // -------------------------------------------------------------

  function dispose(): void {
    if (pollTimer != null) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
    source?.close()
    source = null
    sseHealthy.value = false
  }

  // 组件卸载统一清理（轮询定时器 + SSE 连接）
  onBeforeUnmount(dispose)

  return {
    tasks,
    sseHealthy,
    /** 取某任务进度快照 */
    info(taskId: string | undefined): TaskProgressInfo | undefined {
      return taskId ? tasks.get(taskId) : undefined
    },
    has(taskId: string): boolean {
      return tasks.has(taskId)
    },
    /**
     * 开始跟踪一个任务（outline/full/retry 返回的 taskId，或任务列表
     * 扫描出的在途任务）。跟踪即启动轮询并尝试 SSE 增强。
     */
    track(taskId: string, taskStatus: string = TASK_STATUS.QUEUED): void {
      if (!taskId) return
      const prev = tasks.get(taskId)
      tasks.set(taskId, {
        taskId,
        taskStatus: taskStatus || TASK_STATUS.QUEUED,
        progressPercent: prev?.progressPercent ?? 0,
        stageText: prev?.stageText ?? '',
        errorMsg: prev?.errorMsg,
      })
      ensurePolling()
      connectSse()
    },
    /** 终态失败摘要回填（task/detail errorMsg） */
    setErrorMsg(taskId: string, errorMsg: string): void {
      const cur = tasks.get(taskId)
      if (cur) cur.errorMsg = errorMsg
    },
    /** 清空跟踪集（切换 deck 时重置） */
    clear(): void {
      tasks.clear()
      finishedFired.clear()
    },
    /** 立即触发一次轮询（操作后主动刷新用） */
    pollNow: pollOnce,
    dispose,
  }
}

export type UseTaskProgressReturn = ReturnType<typeof useTaskProgress>
