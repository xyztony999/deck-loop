import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { setAuthBridge } from './engine/request'
import { registerAllActions } from './api/actions'
import { useAuthStore } from './stores/auth'
import './styles/global.less'

const app = createApp(App)

// pinia 先装（守卫/store 依赖）
app.use(createPinia())

// action 注册表装配（dict / auth 模块）
registerAllActions()

// 认证桥：request.ts 的 X-Auth-Token 注入与 401 清态都走 auth store
const auth = useAuthStore()
setAuthBridge({
  getToken: () => auth.token,
  onUnauthorized: () => {
    auth.forceLogout()
    if (router.currentRoute.value.path !== '/auth') {
      void router.push('/auth')
    }
  },
})

app.use(router)

app.mount('#app')

if (auth.isLoggedIn) void auth.initialSync()
