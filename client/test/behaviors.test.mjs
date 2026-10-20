import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Compile dependency-free production logic with the project's existing TypeScript dependency.
async function load(name) {
  const source = await readFile(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

const { consumeSync, readSyncSnapshot, syncStorageKey } = await load('syncCore')
const { submitWithConfirmation } = await load('exportSubmit')
const { mapBatches } = await load('batches')
const { canLogout } = await load('logoutGuard')
const { normalizePageHint, sanitizeOutline, validateOutline } = await load('outline')

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

function change(id, op = 'UPSERT') {
  return { aggregate: 'DECK', id, cursor: 100, op, payload: JSON.stringify({ deckName: id }) }
}

test('PPTX cancellation never sends; acceptance sends confirm=true once', async () => {
  const sends = []
  const send = async (confirm) => { sends.push(confirm); return { exportId: 'export' } }
  assert.equal(await submitWithConfirmation('PPTX', send, async () => false), false)
  assert.deepEqual(sends, [])
  assert.equal(await submitWithConfirmation('PPTX', send, async () => true), true)
  assert.deepEqual(sends, [true])
})

test('PDF sends without beta confirmation, business failures propagate', async () => {
  assert.equal(await submitWithConfirmation('PDF', async (confirm) => {
    assert.equal(confirm, undefined)
    return { exportId: 'pdf' }
  }, () => { throw new Error('Unexpected confirmation') }), true)
  await assert.rejects(submitWithConfirmation('PPTX', async () => { throw new Error('network') }, async () => true), /network/)
})

test('image signing batches 123 unique IDs into legal requests with all results', async () => {
  const ids = Array.from({ length: 123 }, (_, i) => `asset-${i}`)
  const sizes = []
  const result = await mapBatches(ids, 50, async (batch) => {
    assert.ok(batch.length <= 50)
    sizes.push(batch.length)
    return batch.map((assetId) => ({ assetId, fileUrl: `https://files/${assetId}` }))
  })
  assert.deepEqual(sizes, [50, 50, 23])
  assert.deepEqual(result.map((row) => row.assetId), ids)
})

test('logout blocks either active state, allows empty lists, fails closed on request failure', async () => {
  for (const active of ['QUEUED', 'RUNNING']) {
    assert.equal(await canLogout(async (status) => ({ total: status === active ? 1 : 0 })), false)
  }
  assert.equal(await canLogout(async () => ({ total: 0 })), true)
  await assert.rejects(canLogout(async () => { throw new Error('unreachable') }), /unreachable/)
})

test('same-millisecond pagination persists opaque position, applies UPSERT/DELETE, resumes per account', async () => {
  const storage = memoryStorage()
  const requests = []
  const pages = [
    { changes: [change('a'), change('b')], newCursor: 100, newPosition: 'position-1', hasMore: true },
    { changes: [change('a', 'DELETE'), change('c')], newCursor: 100, newPosition: 'position-2', hasMore: false },
  ]
  let commits = 0
  const total = await consumeSync({ accountId: 'first', storage, isCurrent: () => true,
    pull: async (request) => { requests.push(request); return pages.shift() },
    onCommit: () => { commits++ },
  })
  assert.equal(total, 4)
  assert.equal(commits, 2)
  assert.deepEqual(requests[1], { lastCursor: 100, lastPosition: 'position-1' })
  const saved = readSyncSnapshot(storage, 'first')
  assert.equal(saved.position, 'position-2')
  assert.equal(saved.summaries['["DECK","a"]'], undefined)
  assert.deepEqual(saved.summaries['["DECK","c"]'].payload, { deckName: 'c' })
  assert.equal(readSyncSnapshot(storage, 'second').cursor, 0)
  await consumeSync({ accountId: 'first', storage, isCurrent: () => true,
    pull: async (request) => {
      assert.deepEqual(request, { lastCursor: 100, lastPosition: 'position-2' })
      return { changes: [], newCursor: 100, newPosition: 'position-2', hasMore: false }
    }, onCommit() {},
  })
})

test('partial failure preserves committed checkpoint for retry; no cursor advancement on failed storage', async () => {
  const storage = memoryStorage()
  let requests = 0
  await assert.rejects(consumeSync({ accountId: 'first', storage, isCurrent: () => true,
    pull: async () => {
      if (requests++) throw new Error('offline')
      return { changes: [change('a')], newCursor: 100, newPosition: 'a', hasMore: true }
    }, onCommit() {},
  }), /offline/)
  assert.equal(readSyncSnapshot(storage, 'first').position, 'a')
  await assert.rejects(consumeSync({ accountId: 'first', storage: { ...storage, setItem() { throw new Error('quota') } },
    isCurrent: () => true,
    pull: async () => ({ changes: [change('b')], newCursor: 101, newPosition: 'b', hasMore: false }),
    onCommit() { assert.fail('A failed checkpoint must not be published') },
  }), /quota/)
  assert.equal(readSyncSnapshot(storage, 'first').position, 'a')
})

test('account switch rejects late responses without caching or applying another account data', async () => {
  const storage = memoryStorage()
  let current = true
  await assert.rejects(consumeSync({ accountId: 'first', storage, isCurrent: () => current,
    pull: async () => { current = false; return { changes: [change('private')], newCursor: 100, hasMore: false } },
    onCommit() { assert.fail('Stale session must not commit') },
  }), /会话已变更/)
  assert.equal(storage.getItem(syncStorageKey('first')), null)
})

test('sync detects stalled positions and completes more than 50 pages without false success', async () => {
  const storage = memoryStorage()
  await assert.rejects(consumeSync({ accountId: 'first', storage, isCurrent: () => true,
    pull: async () => ({ changes: [], newCursor: 0, hasMore: true }), onCommit() {},
  }), /未推进/)
  let count = 0
  const total = await consumeSync({ accountId: 'first', storage, isCurrent: () => true,
    pull: async () => ({ changes: [change(String(++count))], newCursor: 100, newPosition: String(count), hasMore: count < 51 }),
    onCommit() {},
  })
  assert.equal(count, 51)
  assert.equal(total, 51)
})

// 大纲保存链路（api-generation §4.4：pageHint 整数契约）
// 2026-10-20 教训：MOCK 产物 pageHint 为 number，旧 sanitize 按 string .trim()
// 抛 TypeError → beforeNext 未捕获 → 向导「下一步」静默卡死
test('sanitizeOutline accepts contract-numeric pageHint from MOCK results without throwing', () => {
  const out = sanitizeOutline([
    { nodeId: 'n1', title: ' 模拟大纲章节 ', points: [' 要点一 ', '', '要点二'], note: ' MOCK 渠道生成 ', pageHint: 1 },
  ])
  assert.deepEqual(out, [
    { nodeId: 'n1', title: '模拟大纲章节', points: ['要点一', '要点二'], note: 'MOCK 渠道生成', pageHint: 1 },
  ])
})

test('normalizePageHint coerces digits/strings and drops junk to undefined', () => {
  assert.equal(normalizePageHint(1), 1)
  assert.equal(normalizePageHint(2.4), 2)
  assert.equal(normalizePageHint('3'), 3)
  assert.equal(normalizePageHint(''), undefined)
  assert.equal(normalizePageHint('abc'), undefined)
  assert.equal(normalizePageHint(0), undefined)
  assert.equal(normalizePageHint(null), undefined)
})

test('validateOutline still enforces node count and title rules', () => {
  assert.match(validateOutline([]), /大纲不能为空/)
  assert.match(validateOutline([{ nodeId: 'n1', title: 'x'.repeat(51), points: [] }]), /50/)
  assert.equal(validateOutline([{ nodeId: 'n1', title: 'ok', points: [] }]), null)
})
