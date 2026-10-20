/**
 * .env 加载（零依赖；NestJS 不自动读 .env；宝塔 Node 项目/PM2/node 直启统一生效）。
 *
 * 必须以副作用导入且置于 AppModule 之前：app.module.ts 顶层即读
 * process.env.MONGODB_URI（MongooseModule.forRoot），ES import 按序求值——
 * 若加载逻辑写在 main.ts 顶层，import 提升会使 AppModule 先于 loadDotEnv()
 * 求值，进程将永远拿到无凭证的默认连接串（2026-10-20 深夜教训：mongod 开
 * 鉴权后应用连接池恒"requires authentication"，所有部署健康检查连环假败）。
 *
 * 真实进程环境变量优先（override=false）；按 dist/main.js 的上级（工程根）
 * 与 process.cwd() 两处探测，先命中先加载；Node 20+ 的 --env-file 不受影响。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [resolve(__dirname, '../.env'), resolve(process.cwd(), '.env')];
for (const file of candidates) {
  if (!existsSync(file)) continue;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
  break;
}
