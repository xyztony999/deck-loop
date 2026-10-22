<script setup lang="ts">
/**
 * /auth 登录/注册页（PageSpec auth.md v1.0 §3 code 轻表单）。
 *
 * - 登录：email + password；BIZ_AUTH_CREDENTIALS（含失败计数/锁定文案）由
 *   request.ts 统一透传弹出，本页不重复提示
 * - 注册：email + password(≥8) + nickname；BIZ_AUTH_EMAIL_EXISTS 定位到
 *   email 字段级错误（auth.md §3）
 * - 登录成功 → 守卫写入的 redirect 参数（仅站内路径）或默认 /deck，
 *   并触发一次 sync_pull（首次进入，auth.md §3）
 * - 注册成功：VO 无 token（api-platform.md §4.4）无法自动登录 → 切登录
 *   模式并保留 email
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import type { FormInstance, Rule } from 'ant-design-vue/es/form'

import { executeAction } from '@/engine/actionExecutor'
import { useAuthStore } from '@/stores/auth'
import LogoMark from '@/components/LogoMark.vue'

type AuthMode = 'login' | 'register'

/** request.ts reject 的业务错误（Error + 附加 code 字段） */
interface BizError extends Error {
  code?: string
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof Error) {
    const code = (err as BizError).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error && err.message ? err.message : undefined
}

/** 注册 VO（api-platform.md §4.4：accountId、nickname；无 token） */
interface RegisterVO {
  accountId?: string
  nickname?: string
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// 长度上限来源 api-platform.md §5.3 DDL（dl_account.email/nickname）
const EMAIL_MAX = 128
const NICKNAME_MAX = 64

const mode = ref<AuthMode>('login')
const loading = ref(false)
const formRef = ref<FormInstance>()
/** 服务端唯一性冲突（BIZ_AUTH_EMAIL_EXISTS）注入的字段级错误文案 */
const serverEmailError = ref('')

const formState = reactive({
  email: '',
  password: '',
  nickname: '',
})

const isRegister = computed(() => mode.value === 'register')
const passwordPlaceholder = computed(() =>
  isRegister.value ? '请输入密码（至少 8 位）' : '请输入密码',
)

const emailRules: Rule[] = [
  { required: true, message: '请输入邮箱', trigger: 'blur' },
  { type: 'email', message: '邮箱格式不正确', trigger: ['change', 'blur'] },
  {
    // BIZ_AUTH_EMAIL_EXISTS 定位字段错误（auth.md §3）
    validator: () =>
      serverEmailError.value
        ? Promise.reject(new Error(serverEmailError.value))
        : Promise.resolve(),
    trigger: 'change',
  },
]

const registerPasswordRules: Rule[] = [
  { required: true, message: '请输入密码', trigger: 'blur' },
  { min: 8, message: '密码至少 8 位', trigger: ['change', 'blur'] },
]

const loginPasswordRules: Rule[] = [
  { required: true, message: '请输入密码', trigger: 'blur' },
]

const nicknameRules: Rule[] = [
  { required: true, message: '请输入昵称', trigger: 'blur' },
]

const rules = computed<Record<string, Rule[]>>(() => ({
  email: emailRules,
  password: isRegister.value ? registerPasswordRules : loginPasswordRules,
  nickname: isRegister.value ? nicknameRules : [],
}))

// email 一经修改即清除服务端冲突提示（重提交以后端为准）
watch(
  () => formState.email,
  () => {
    serverEmailError.value = ''
  },
)

function switchMode(next: AuthMode): void {
  mode.value = next
  serverEmailError.value = ''
  formRef.value?.clearValidate()
}

async function validateForm(): Promise<boolean> {
  try {
    await formRef.value?.validate()
    return true
  } catch {
    return false
  }
}

/** 登录成功跳转：守卫写入的 redirect 参数（仅站内路径）或默认 /deck */
function resolveRedirect(): string {
  const redirect = route.query.redirect
  if (
    typeof redirect === 'string' &&
    redirect.startsWith('/') &&
    !redirect.startsWith('//') &&
    redirect !== '/auth' &&
    redirect !== '/login'
  ) {
    return redirect
  }
  return '/deck'
}

async function onLogin(): Promise<void> {
  if (!(await validateForm())) return
  loading.value = true
  try {
    await auth.login(formState.email, formState.password)
    void auth.initialSync() // 首次进入触发一次 sync_pull（auth.md §3）
    message.success('登录成功')
    await router.push(resolveRedirect())
  } catch {
    // BIZ_AUTH_CREDENTIALS 等文案已由 request.ts 透传统一弹出
  } finally {
    loading.value = false
  }
}

async function onRegister(): Promise<void> {
  if (!(await validateForm())) return
  loading.value = true
  try {
    await executeAction<RegisterVO>('auth.register', {
      email: formState.email,
      password: formState.password,
      nickname: formState.nickname,
    })
    message.success('注册成功，请登录')
    // VO 无 token，无法自动登录 → 切登录并保留 email 便于直接登录
    formState.password = ''
    formState.nickname = ''
    switchMode('login')
  } catch (err) {
    if (errorCode(err) === 'BIZ_AUTH_EMAIL_EXISTS') {
      serverEmailError.value = errorMessage(err) ?? '该邮箱已被注册'
      void formRef.value?.validateFields('email').catch(() => {})
    }
    // 其余错误文案已由 request.ts 透传统一弹出
  } finally {
    loading.value = false
  }
}

async function onSubmit(): Promise<void> {
  await (isRegister.value ? onRegister() : onLogin())
}
</script>

<template>
  <div class="dl-auth">
    <div class="dl-auth-card">
      <LogoMark :size="40" class="dl-auth-logo" />
      <h2 class="dl-auth-title">Deck-Loop</h2>
      <p class="dl-auth-sub">AI 内容创作工作台</p>
      <a-form
        ref="formRef"
        layout="vertical"
        :model="formState"
        :rules="rules"
        @keyup.enter="onSubmit"
      >
        <a-form-item label="邮箱" name="email">
          <a-input
            v-model:value="formState.email"
            :maxlength="EMAIL_MAX"
            placeholder="请输入邮箱"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="密码" name="password">
          <a-input-password
            v-model:value="formState.password"
            :placeholder="passwordPlaceholder"
          />
        </a-form-item>
        <a-form-item v-if="isRegister" label="昵称" name="nickname">
          <a-input
            v-model:value="formState.nickname"
            :maxlength="NICKNAME_MAX"
            placeholder="请输入昵称"
            allow-clear
          />
        </a-form-item>
        <a-button type="primary" block :loading="loading" @click="onSubmit">
          {{ isRegister ? '注 册' : '登 录' }}
        </a-button>
        <div class="dl-auth-switch">
          <a v-if="!isRegister" @click="switchMode('register')">
            还没有账号？立即注册
          </a>
          <a v-else @click="switchMode('login')">已有账号？返回登录</a>
        </div>
      </a-form>
      <!-- 失败计数提示（auth.md §3：5 次锁 10 分钟） -->
      <p v-if="!isRegister" class="dl-auth-tip">连续失败 5 次将锁定账号 10 分钟</p>
    </div>
  </div>
</template>

<style scoped>
.dl-auth {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dl-bg-page);
}

/* Card 基调（frontend-specs 05 §5.1） */
.dl-auth-card {
  width: 380px;
  background: var(--dl-card-bg);
  border-radius: 10px;
  box-shadow: var(--dl-card-shadow);
  padding: 32px;
}

.dl-auth-logo {
  display: block;
  margin: 0 auto 8px;
}

.dl-auth-title {
  margin: 0 0 4px;
  text-align: center;
  color: var(--dl-title-color);
}

.dl-auth-sub {
  margin: 0 0 20px;
  text-align: center;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.dl-auth-switch {
  margin-top: 12px;
  text-align: center;
  font-size: 13px;
}

.dl-auth-switch a {
  color: var(--dl-title-bar);
  cursor: pointer;
}

.dl-auth-tip {
  margin: 12px 0 0;
  text-align: center;
  color: var(--dl-text-secondary);
  font-size: 12px;
}
</style>
