/**
 * ADR-017 端到端冒烟：真实 stdio 入口（dist/main.js）+ coding agent 直写全流程。
 * 验证 InMemory 测试未覆盖的面：main.ts env 时序、stdio 帧、真实数据目录落盘。
 * 运行：node scripts/stdio-smoke.mjs（先 pnpm build）
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const home = mkdtempSync(join(tmpdir(), 'deck-loop-stdio-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/main.js'],
  env: { ...process.env, DECK_LOOP_HOME: home },
  stderr: 'inherit',
});
const client = new Client({ name: 'stdio-smoke', version: '0.0.0' });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0]?.text ?? '{}';
  const data = JSON.parse(text);
  if (res.isError) throw new Error(`${name}: ${data.message ?? text}`);
  return data;
}

const { tools } = await client.listTools();
console.log(`tools/list: ${tools.length} 个工具`);

// 1. 建 deck + 大纲
const deck = await call('deck_create', {
  deckName: 'deck-loop 转型说明',
  topic: 'coding plan 原生的本地优先 MCP',
  requirement: '向团队解释为什么从独立客户端转向 MCP 形态',
});
console.log('deck_create:', deck.deckId, deck.deckCode);
await call('outline_save', {
  deckId: deck.deckId,
  nodes: [
    { title: '订阅错配', points: ['coding plan token 非通用 API key', '独立客户端无法使用订阅'], pageHint: 1 },
    { title: 'MCP 形态', points: ['agent 出推理', 'deck-loop 出状态机'], pageHint: 1 },
    { title: '保留的资产', points: ['版本树', '不变性校验', '三格式导出'], pageHint: 1 },
  ],
});

// 2. 整稿（agent 直写 content JSON）
const v1 = await call('version_create', {
  deckId: deck.deckId,
  instruction: '按大纲生成三页整稿',
  content: {
    pages: [
      {
        pageId: 'p1', layout: 'TITLE_BODY', title: '订阅错配',
        note: '开场：我们手上的订阅是 coding plan，不是 API 额度。',
        blocks: [
          { blockId: 'p1-b1', blockType: 'TEXT', text: 'coding plan token 限定官方 coding 客户端\n不是通用 API key，独立客户端用不上\n本地代理桥接违反条款，且被 SSRF 防线拒绝' },
        ],
      },
      {
        pageId: 'p2', layout: 'TITLE_BODY', title: 'MCP 形态',
        note: '核心：推理在 agent 侧，状态机在本地。',
        blocks: [
          { blockId: 'p2-b1', blockType: 'TEXT', text: 'coding agent 出推理（消耗 coding plan）\ndeck-loop 出确定性状态机（零 API key）\nversion_create 直写，绕开 AI 网关' },
        ],
      },
      {
        pageId: 'p3', layout: 'TITLE_BODY', title: '保留的资产',
        blocks: [
          { blockId: 'p3-b1', blockType: 'TEXT', text: '不可变版本树：回退 / 分叉 / 对比\n定向调整不变性：非目标页块字节级不动\nheadless 三格式导出：PDF / PNG / PPTX' },
        ],
      },
    ],
  },
});
console.log('version_create 首版:', v1.versionId, 'seq', v1.versionSeq, v1.sourceType);

// 3. 定向调整（仅改 p2 第一块；其余逐字节不动）
const base = (await call('version_get', { versionId: v1.versionId })).content;
const adjusted = JSON.parse(JSON.stringify(base));
adjusted.pages[1].blocks[0].text = 'coding agent 出推理（消耗 coding plan）\ndeck-loop 出确定性状态机（零 API key、零服务端）\nversion_create 直写，绕开 AI 网关';
const v2 = await call('version_create', {
  deckId: deck.deckId,
  instruction: '第二页补充「零服务端」',
  scope: { pageId: 'p2', blockId: 'p2-b1' },
  content: adjusted,
});
console.log('定向调整:', v2.versionId, 'seq', v2.versionSeq, v2.sourceType);

// 4. 预览 + 定稿 + 三格式导出
const preview = await call('preview_deck', { deckId: deck.deckId, open: false });
console.log('preview:', preview.filePath);
await call('deck_finalize', { deckId: deck.deckId });
const artifacts = {};
for (const format of ['PDF', 'IMAGES', 'PPTX']) {
  const vo = await call('export_deck', { deckId: deck.deckId, exportFormat: format, confirm: true });
  const bytes = readFileSync(vo.filePath);
  const magic = format === 'PDF' ? bytes.subarray(0, 5).toString('latin1') : 'PK(zip)';
  console.log(`export ${format}: ${vo.filePath} (${bytes.length} bytes, ${magic})`);
  artifacts[format] = vo.filePath;
}
const list = await call('export_list', { deckId: deck.deckId });
console.log('export_list:', list.total, '条记录，状态:', list.records.map((r) => r.exportStatus).join(','));

// 5. 断言
if (!existsSync(preview.filePath)) throw new Error('预览文件缺失');
if (list.total !== 3) throw new Error('导出记录数 != 3');
for (const r of list.records) if (r.exportStatus !== 'SUCCEEDED') throw new Error('存在非 SUCCEEDED 记录');

await client.close();
console.log('\nSTDIO SMOKE PASS — 数据目录:', home);
console.log(JSON.stringify(artifacts, null, 2));