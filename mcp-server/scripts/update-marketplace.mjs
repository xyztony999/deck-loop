/**
 * 市场清单回写（CI release 后）：读 dist-market/manifest.json，更新根
 * marketplace.json 与 .claude-plugin/marketplace.json 的 url/sha256/version。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const manifest = JSON.parse(readFileSync(join(root, 'dist-market/manifest.json'), 'utf8'));

const entry = {
  name: 'deck-loop',
  source: {
    source: 'url',
    type: 'zip',
    url: manifest.url,
    sha256: manifest.sha256,
  },
  description:
    'Agent-driven deck creation: local (zero-server) or remote (login to your deck-loop account). Immutable version tree, targeted-adjust invariance, headless PDF/PNG/PPTX export. No API key — reasoning runs on your coding plan.',
  description_i18n: {
    en: 'Agent-driven deck creation: local (zero-server) or remote (login to your deck-loop account). Immutable version tree, targeted-adjust invariance, headless PDF/PNG/PPTX export. No API key — reasoning runs on your coding plan.',
    'zh-CN': 'agent 驱动幻灯片创作：本地开箱即用或登录你的 deck-loop 账号远程同库。不可变版本树、定向调整不变性、headless PDF/PNG/PPTX 导出。零 API key——推理消耗你的 coding plan。',
  },
  version: manifest.version,
  author: { name: 'deck-loop' },
  license: 'AGPL-3.0-only',
  category: 'productivity',
  keywords: ['deck', 'presentation', 'slides', 'mcp', 'pptx', '幻灯片', '演示文稿'],
};

for (const file of ['marketplace.json', '.claude-plugin/marketplace.json']) {
  const path = join(repo, file);
  mkdirSync(dirname(path), { recursive: true });
  const doc = {
    name: 'deck-loop',
    owner: { name: 'xyztony999' },
    metadata: { description: 'deck-loop plugin marketplace (main repo as marketplace)', version: manifest.version },
    plugins: [entry],
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  console.log(`[marketplace] updated ${file} → v${manifest.version} sha256=${manifest.sha256.slice(0, 12)}...`);
}