/** Incremental change summaries invalidate server-backed views; they are not offline documents. */
export interface SyncChange {
  aggregate: string
  op: string
  id: string
  cursor: number
  payload?: string
}

export interface SyncPage {
  changes: SyncChange[]
  newCursor: number
  newPosition?: string
  hasMore: boolean
}

export interface SyncSnapshot {
  cursor: number
  position?: string
  lastSyncAt: string
  summaries: Record<string, { cursor: number; payload: unknown }>
}

export function emptySyncSnapshot(): SyncSnapshot {
  return { cursor: 0, lastSyncAt: '', summaries: {} }
}

export function syncStorageKey(accountId: string): string {
  return `dl_sync_v1:${encodeURIComponent(accountId)}`
}

export function readSyncSnapshot(storage: Pick<Storage, 'getItem'>, accountId: string): SyncSnapshot {
  try {
    const saved = JSON.parse(storage.getItem(syncStorageKey(accountId)) ?? 'null') as SyncSnapshot | null
    if (saved && Number.isSafeInteger(saved.cursor) && saved.cursor >= 0 &&
        typeof saved.lastSyncAt === 'string' && saved.summaries && typeof saved.summaries === 'object' &&
        !Array.isArray(saved.summaries) && (saved.position === undefined || typeof saved.position === 'string')) {
      return saved
    }
  } catch { /* A damaged cache restarts from the beginning. */ }
  return emptySyncSnapshot()
}

export async function consumeSync(options: {
  accountId: string
  storage: Pick<Storage, 'getItem' | 'setItem'>
  pull: (payload: { lastCursor: number; lastPosition?: string }) => Promise<SyncPage>
  isCurrent: () => boolean
  onCommit: (snapshot: SyncSnapshot, count: number) => void
}): Promise<number> {
  let snapshot = readSyncSnapshot(options.storage, options.accountId)
  let total = 0
  for (;;) {
    if (!options.isCurrent()) throw new Error('同步会话已变更')
    const page = await options.pull({ lastCursor: snapshot.cursor, lastPosition: snapshot.position })
    if (!options.isCurrent()) throw new Error('同步会话已变更')
    if (!Array.isArray(page.changes) || !Number.isSafeInteger(page.newCursor) || page.newCursor < snapshot.cursor) {
      throw new Error('同步响应游标无效')
    }
    if (page.hasMore && page.newCursor === snapshot.cursor && page.newPosition === snapshot.position) {
      throw new Error('同步游标未推进，请稍后重试')
    }
    const summaries = { ...snapshot.summaries }
    for (const change of page.changes) {
      const key = JSON.stringify([change.aggregate, change.id])
      if (change.op === 'DELETE') delete summaries[key]
      else {
        let payload: unknown = change.payload ?? null
        try { payload = JSON.parse(change.payload ?? 'null') } catch { /* Keep unstructured summaries as text. */ }
        summaries[key] = { cursor: change.cursor, payload }
      }
    }
    snapshot = {
      cursor: page.newCursor,
      position: page.newPosition,
      lastSyncAt: new Date().toISOString(),
      summaries,
    }
    // Commit summaries and position together. A failed write never advances the checkpoint.
    options.storage.setItem(syncStorageKey(options.accountId), JSON.stringify(snapshot))
    total += page.changes.length
    options.onCommit(snapshot, page.changes.length)
    if (!page.hasMore) return total
  }
}
