import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

// 规约（frontend-specs 02-mandatory 规则 8）：业务代码 URL 不含 /api 前缀，
// 由这里的代理层统一承担前缀剥离 → 后端 8080 直挂 /{domain}/{resource}/{action}。
export default defineConfig({
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
        // 默认连本地后端；连部署环境时：DECK_API_TARGET=https://<你的域名> pnpm dev
        target: process.env.DECK_API_TARGET || 'http://localhost:8080',
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
})
