/**
 * 市场包构建（ADR-019）：esbuild 单文件 bundle（plugin-main，双模式）+
 * 自包含 plugin 目录 + zip + sha256。产物供 GitHub Release 资产 + marketplace.json。
 *
 * 用法：node scripts/build-marketplace.mjs [--version 0.2.0]
 * 产物：dist-market/{server.cjs, sql-wasm.wasm, node_modules/playwright-core,
 *       .zcode-plugin/, .claude-plugin/, skills/, commands/, README.md,
 *       deck-loop-plugin-<v>.zip, manifest.json}
 *
 * external：playwright-core（浏览器驱动，随包 node_modules）、better-sqlite3
 * （native，市场包默认 sqljs 不加载；仓库开发态才用）。
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const versionArg = process.argv.indexOf('--version');
const version = versionArg > -1 ? process.argv[versionArg + 1] : pkg.version;
const out = join(root, 'dist-market');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. bundle（双模式入口；sql.js 内联，wasm 随包）
await build({
  entryPoints: [join(root, 'src/plugin-main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(out, 'server.cjs'),
  external: [
    'playwright-core',
    'better-sqlite3',
    // Nest core 可选模块（运行时 try/catch 懒加载，未安装亦正常）
    '@nestjs/websockets',
    '@nestjs/websockets/socket-module',
    '@nestjs/microservices',
    '@nestjs/microservices/microservices-module',
  ],
  logLevel: 'info',
});

// 2. wasm + playwright-core + web 管理站前端随包
cpSync(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), join(out, 'sql-wasm.wasm'));
cpSync(join(root, 'node_modules/playwright-core'), join(out, 'node_modules/playwright-core'), {
  recursive: true,
  filter: (src) => !src.includes('.map') && !src.includes('README'),
});
const webDist = join(repo, 'web/dist');
if (existsSync(webDist)) {
  cpSync(webDist, join(out, 'web'), { recursive: true });
} else {
  console.warn('[marketplace] web/dist 不存在——manage_open 将不可用（先 cd web && pnpm build）');
}

// 3. plugin 清单（ZCode + Claude 双兼容）
const pluginJson = {
  name: 'deck-loop',
  version,
  description:
    'Agent-driven deck creation: local (zero-server, sql.js) or remote (login to your deck-loop account, same DB as the web UI). Immutable version tree, targeted-adjust invariance, headless PDF/PNG/PPTX export.',
  description_i18n: {
    en: 'Agent-driven deck creation: local (zero-server, sql.js) or remote (login to your deck-loop account, same DB as the web UI). Immutable version tree, targeted-adjust invariance, headless PDF/PNG/PPTX export.',
    'zh-CN': 'agent 驱动幻灯片创作：本地开箱即用（sql.js）或登录你的 deck-loop 账号远程同库（与网站实时一致）。不可变版本树、定向调整不变性、headless PDF/PNG/PPTX 导出。',
  },
  author: { name: 'deck-loop' },
  license: 'AGPL-3.0-only',
  skills: 'skills',
  commands: 'commands',
  mcpServers: {
    'deck-loop': {
      type: 'stdio',
      command: 'node',
      args: ['${ZCODE_PLUGIN_ROOT}/server.cjs'],
    },
  },
};
mkdirSync(join(out, '.zcode-plugin'), { recursive: true });
writeFileSync(join(out, '.zcode-plugin/plugin.json'), JSON.stringify(pluginJson, null, 2));
mkdirSync(join(out, '.claude-plugin'), { recursive: true });
writeFileSync(join(out, '.claude-plugin/plugin.json'), JSON.stringify(pluginJson, null, 2));
// Claude Code MCP 配置（${CLAUDE_PLUGIN_ROOT}）
writeFileSync(
  join(out, '.mcp.json'),
  JSON.stringify({ mcpServers: { 'deck-loop': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.cjs'] } } }, null, 2),
);

// 4. skills / commands / README
cpSync(join(repo, 'plugin/skills'), join(out, 'skills'), { recursive: true });
cpSync(join(repo, 'plugin/commands'), join(out, 'commands'), { recursive: true });
cpSync(join(repo, 'plugin/README.md'), join(out, 'README.md'));

// 5. zip + sha256 + manifest
const zip = new JSZip();
function addDir(dir, prefix = '') {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) addDir(full, rel);
    else zip.file(rel, readFileSync(full));
  }
}
addDir(out);
const zipName = `deck-loop-plugin-${version}.zip`;
const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(join(out, zipName), zipBytes);
const sha256 = createHash('sha256').update(zipBytes).digest('hex');

// 5.5 npm 发布面（zip 之后写，避免进插件包）：bin + playwright-core 转正依赖，
// npm pack 自动排除 node_modules（playwright-core 从 registry 拉）
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'deck-loop-mcp',
      version,
      description: 'deck-loop MCP server — dual-mode (local sql.js / remote login), agent-driven deck creation (ADR-017/018/019)',
      license: 'AGPL-3.0-only',
      bin: { 'deck-loop-mcp': './server.cjs' },
      files: ['server.cjs', 'sql-wasm.wasm', 'web/', 'README.md'],
      dependencies: { 'playwright-core': '^1.49.0' },
      engines: { node: '>=20' },
      keywords: ['mcp', 'deck', 'presentation', 'pptx', 'slides', '幻灯片', '演示文稿'],
    },
    null,
    2,
  ) + '\n',
);
const manifest = {
  name: 'deck-loop',
  version,
  zip: zipName,
  sha256,
  size: zipBytes.length,
  url: `https://github.com/xyztony999/deck-loop/releases/download/v${version}/${zipName}`,
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[marketplace] ${zipName} (${zipBytes.length} bytes) sha256=${sha256}`);