import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

// 规约（frontend-specs 02-mandatory 规则 8）：业务代码 URL 不含 /api 前缀，
// baseURL '/api' 由请求层统一补齐。代理层**不剥前缀**直传：目标网关
// （Nginx location /api/）自带前缀剥离 → Node 直挂 /{domain}/{resource}/{action}。
// （2026-10-21 教训：代理曾自剥 /api 适配旧"全量反代"网关；网关改为仅认
// /api/ 前缀后双剥失配，客户端全接口 404）
export default defineConfig(({ mode }) => {
  // 代理目标三优先级：进程 env > client/.env.local（gitignore，写 DECK_API_TARGET=https://<你的域名>）> 本地后端
  const env = loadEnv(mode, process.cwd(), '')
  // 域名网关（Nginx location /api/）自带前缀剥离 → 直传 /api/*；
  // 本地直连后端（无网关）→ 仍由代理剥 /api。判定按目标是否本机地址
  const apiTarget = process.env.DECK_API_TARGET || env.DECK_API_TARGET || 'http://localhost:8080'
  const isLocalBackend = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(apiTarget)
  return {
  plugins: [
    vue(),
    // AntdV 4 按需引入（cssinjs 方案，无需引入样式文件）
    Components({
      resolvers: [
        AntDesignVueResolver({
          importStyle: false,
        }),
      ],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
        ...(isLocalBackend ? { rewrite: (path: string) => path.replace(/^\/api/, '') } : {}),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  }
})
