import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'
import { executeAction } from '@/engine/actionExecutor'
import { useAuthStore } from '@/stores/auth'
import { canLogout } from '@/services/logoutGuard'

/** All user-initiated exits use the same confirmation and running-task guard. */
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
          const allowed = await canLogout((taskStatus) => executeAction('gen.taskList', {
            taskStatus, pageNum: 1, pageSize: 1,
          }))
          if (!allowed) {
            Modal.warning({
              title: '暂不能退出登录',
              content: '存在进行中的生成/调整任务，请等待任务完成或取消后再退出登录。',
              maskClosable: false,
            })
            return
          }
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
