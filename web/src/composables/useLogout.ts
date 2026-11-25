import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'
import { useAuthStore } from '@/stores/auth'

/**
 * 统一退出确认（ADR-018：生成/调整任务模块退役，无进行中任务守卫；
 * 网站直读 PG 单源，退出仅清会话态）。
 */
export function useLogout() {
  const auth = useAuthStore()
  const router = useRouter()
  const loggingOut = ref(false)
  let confirming = false

  function confirmLogout(): void {
    if (confirming || loggingOut.value) return
    confirming = true
    const clear = () => { confirming = false }
    Modal.confirm({
      title: '退出登录',
      content: '退出后需重新登录才能继续使用，确定退出？',
      okText: '退出登录',
      cancelText: '取消',
      maskClosable: false,
      okButtonProps: { danger: true },
      onCancel: clear,
      async onOk() {
        loggingOut.value = true
        try {
          await auth.logout()
          await router.push('/auth')
        } finally {
          loggingOut.value = false
          clear()
        }
      },
    })
  }

  return { loggingOut, confirmLogout }
}