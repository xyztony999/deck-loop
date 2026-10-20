import { ref } from 'vue'
import { defineStore } from 'pinia'
import { executeAction } from '@/engine/actionExecutor'
import { clearDictCache } from '@/engine/dict'
import { consumeSync, emptySyncSnapshot, readSyncSnapshot, type SyncPage } from '@/services/syncCore'

export const useSyncStore = defineStore('sync', () => {
  const accountId = ref('')
  const snapshot = ref(emptySyncSnapshot())
  const revision = ref(0)
  const syncing = ref(false)
  let generation = 0
  let pending: Promise<number> | undefined

  function bindAccount(id: string): void {
    if (id === accountId.value) return
    reset()
    accountId.value = id
    snapshot.value = readSyncSnapshot(localStorage, id)
  }

  function reset(): void {
    generation++
    accountId.value = ''
    snapshot.value = emptySyncSnapshot()
    syncing.value = false
    pending = undefined
  }

  function pull(): Promise<number> {
    if (pending) return pending
    if (!accountId.value) return Promise.reject(new Error('账户信息尚未加载，请稍后同步'))
    const id = accountId.value
    const run = generation
    let changes = 0
    syncing.value = true
    const current = () => generation === run && accountId.value === id
    pending = consumeSync({
      accountId: id,
      storage: localStorage,
      isCurrent: current,
      pull: (payload) => executeAction<SyncPage>('auth.syncPull', payload),
      onCommit: (next, count) => { snapshot.value = next; changes += count },
    }).finally(() => {
      if (!current()) return
      // Also refresh after partial progress followed by an error, since those pages were committed.
      if (changes > 0) { clearDictCache(); revision.value++ }
      syncing.value = false
      pending = undefined
    })
    return pending
  }

  return { accountId, snapshot, revision, syncing, bindAccount, reset, pull }
})
