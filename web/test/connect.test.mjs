import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// 复用 behaviors 的纯函数加载模式（typescript 转译 + data URL import）
async function load(name) {
  const source = await readFile(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

const { resolveConnectTarget, appendTokenParams } = await load('connect')

test('回环 callback 通过（127.0.0.1/localhost/[::1] 任意端口）', () => {
  for (const cb of ['http://127.0.0.1:53421', 'http://localhost:8080', 'http://[::1]:9000/callback']) {
    const r = resolveConnectTarget(cb, '')
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.target.name, 'deck-loop-plugin')
  }
})

test('非回环目标拒绝（防 token 外泄）', () => {
  for (const cb of ['https://evil.example/cb', 'http://192.168.1.1:1', 'http://example.com:8080']) {
    const r = resolveConnectTarget(cb, '')
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /回环/)
  }
})

test('缺失/非法 callback 拒绝', () => {
  assert.equal(resolveConnectTarget(undefined, '').ok, false)
  assert.equal(resolveConnectTarget('', '').ok, false)
  assert.equal(resolveConnectTarget('not a url', '').ok, false)
})

test('名称清洗：空缺省 deck-loop-plugin、超长截断 50', () => {
  const r1 = resolveConnectTarget('http://127.0.0.1:1', '  ')
  assert.equal(r1.ok && r1.target.name, 'deck-loop-plugin')
  const long = 'x'.repeat(80)
  const r2 = resolveConnectTarget('http://127.0.0.1:1', long)
  assert.equal(r2.ok && r2.target.name.length, 50)
})

test('appendTokenParams 追加 token；expiresAt 为空不落参数', () => {
  const withExp = appendTokenParams('http://127.0.0.1:53421', 'dlpat_x', 1799999999999)
  assert.ok(withExp.includes('token=dlpat_x'))
  assert.ok(withExp.includes('expiresAt=1799999999999'))
  const noExp = appendTokenParams('http://127.0.0.1:53421', 'dlpat_x', null)
  assert.ok(noExp.includes('token=dlpat_x'))
  assert.ok(!noExp.includes('expiresAt'))
})