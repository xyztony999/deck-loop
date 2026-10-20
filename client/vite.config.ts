import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

// 规约（frontend-specs 02-mandatory 规则 8）：业务代码 URL 不含 /api 前缀，
// 由这里的代理层统一承担前缀剥离 → 后端 8080 直挂 /{domain}/{resource}/{action}。
export default defineConfig(({ mode }) => {
  // 代理目标三优先级：进程 env > client/.env.local（gitignore，写 DECK_API_TARGET=https://<你的域名>）> 本地后端
  const env = loadEnv(mode, process.cwd(), '')
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
        // 优先级：进程 env DECK_API_TARGET > client/.env.local > 本地后端（8080）
        target: process.env.DECK_API_TARGET || env.DECK_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  }
})
