import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

// 规约（frontend-specs 02-mandatory 规则 8）：业务代码 URL 不含 /api 前缀，
// baseURL '/api' 由请求层统一补齐。代理层**不剥前缀**直传：目标网关
// （Nginx location /api/）自带前缀剥离 → Node 直挂 /{domain}/{resource}/{action}。
// （2026-10-21 教训：代理曾自剥 /api 适配旧"全量反代"网关；网关改为仅认
// /api/ 前缀后双剥失配，全接口 404）
export default defineConfig(({ mode }) => {
  // 代理目标三优先级：进程 env > web/.env.local（gitignore，写 DECK_API_TARGET=https://<你的域名>）> 本地后端
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
      // ADR-018 §4.6：浏览器侧预览/放映共享 mcp-server 的纯 TS 渲染模板
      // （parseSlides/slidesHtml/renderDocument/previewDocument，零 node 依赖，
      // 单一源零复制）。严禁指向 export-renderer.ts（含 playwright/pptxgenjs node 依赖）。
      '@render': fileURLToPath(new URL('../mcp-server/src/render', import.meta.url)),
    },
  },
  server: {
    // 5390：避开 Windows Hyper-V/WinNAT 动态端口排除段（5146-5245 吞掉默认 5173，
    // 报 EACCES ::1:5173；排除段随重启漂移，改用 5358-5457 空档）。strictPort
    // 让落段时立刻显式报错而不是静默换端口。
    port: 5390,
    strictPort: true,
    fs: {
      // @render 别名指向仓库内 mcp-server/src/render（web/ 之外）——vite 默认
      // allow list 搜到 web/ 自身（有 pnpm-lock）即止，dev 下 /@fs/ 取共享渲染
      // 模板会 403。放开到仓库根（'..' 相对 web/），仅开发态生效，build 不受影响。
      allow: ['..'],
    },
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