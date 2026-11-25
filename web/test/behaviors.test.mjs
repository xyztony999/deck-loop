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

// ADR-018 退役面适配：syncCore（网站不经同步）/ exportSubmit（网站无导出发起）/
// logoutGuard（任务模块退役）随模块移除，其行为测试一并退役。保留 batches
//（素材签名分批）与 outline（DRAFT 大纲保存链路）两组纯函数行为测试。
const { mapBatches } = await load('batches')
const { normalizePageHint, sanitizeOutline, validateOutline } = await load('outline')

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

test('mapBatches rejects invalid batch size', async () => {
  await assert.rejects(mapBatches([1], 0, async (b) => b), /Invalid batch size/)
  await assert.rejects(mapBatches([1], 1.5, async (b) => b), /Invalid batch size/)
})

// 大纲保存链路（api-web-agent §4.3 outline-save 迁移端点：pageHint 整数契约）
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