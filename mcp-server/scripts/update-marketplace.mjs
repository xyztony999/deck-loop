/**
 * 市场清单回写（CI release 后）：读 dist-market/manifest.json，
 * 更新根 marketplace.json（ZCode 格式：url/zip/path 与官方逐字段对齐）的
 * url/sha256/version。.claude-plugin/marketplace.json 为 Claude/Cursor 格式
 * （source=./plugin 仓库内目录 + npx 运行时），静态手维，仅版本号随手同步。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const manifest = JSON.parse(readFileSync(join(root, 'dist-market/manifest.json'), 'utf8'));

const description =
  'Agent-driven slide decks: works locally out of the box, or sign in to your deck-loop account to sync with your website. Version management, asset library, PDF/image/PPT export.';
const descriptionZh =
  'agent 驱动的幻灯片创作：本地开箱即用，或登录你的 deck-loop 账号与网站实时同步。版本管理、素材管理、PDF/图片/PPT 导出。';

// ZCode 市场格式（与 zcode-plugins-official 逐字段对齐：url/zip 必须带 path）
const entry = {
  name: 'deck-loop',
  source: {
    source: 'url',
    type: 'zip',
    url: manifest.url,
    sha256: manifest.sha256,
    path: 'deck-loop',
  },
  description,
  description_i18n: { en: description, 'zh-CN': descriptionZh },
  version: manifest.version,
  author: { name: 'deck-loop' },
  license: 'AGPL-3.0-only',
  category: 'productivity',
  keywords: ['deck', 'presentation', 'slides', 'mcp', 'pptx', '幻灯片', '演示文稿'],
};

const path = join(repo, 'marketplace.json');
writeFileSync(path, JSON.stringify({ name: 'deck-loop', plugins: [entry] }, null, 2) + '\n');
console.log(`[marketplace] updated marketplace.json → v${manifest.version} sha256=${manifest.sha256.slice(0, 12)}...`);