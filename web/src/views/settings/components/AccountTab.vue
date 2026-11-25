<script setup lang="ts">
/**
 * 账户 Tab（PageSpec settings.md §3）。
 *
 * - 账号资料：email 只读 / nickname 编辑保存（auth.profile 读/改昵称）；
 *   昵称保存成功后回写 auth store（App.vue 顶栏昵称即时更新）；
 * - 会话：退出登录（danger ghost → 清态回 /auth）。
 *
 * ADR-018：无同步状态展示（网站直读 PG 单源，无本地副本；同步仅 MCP 本地离线）。
 */
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'

import { executeAction } from '@/engine'
import { useAuthStore } from '@/stores/auth'
import { useLogout } from '@/composables/useLogout'
import type { AccountProfileVO } from '../types'

const auth = useAuthStore()
const { loggingOut, confirmLogout } = useLogout()

const profile = ref<AccountProfileVO | null>(null)
const loading = ref(false)
const nicknameInput = ref('')
const savingNickname = ref(false)

const emailText = computed(() => profile.value?.email || '-')
const nicknameDirty = computed(
  () => nicknameInput.value.trim() !== (profile.value?.nickname ?? ''),
)

async function loadProfile(): Promise<void> {
  loading.value = true
  try {
    profile.value = await auth.loadProfile()
    nicknameInput.value = profile.value.nickname ?? ''
  } finally {
    loading.value = false
  }
}

async function saveNickname(): Promise<void> {
  const nickname = nicknameInput.value.trim()
  if (!nickname) {
    message.warning('昵称不能为空')
    return
  }
  savingNickname.value = true
  try {
    await executeAction('auth.profile', { nickname })
    if (profile.value) profile.value.nickname = nickname
    auth.updateNickname(nickname)
    message.success('昵称已更新')
  } finally {
    savingNickname.value = false
  }
}

function cancelNickname(): void {
  nicknameInput.value = profile.value?.nickname ?? ''
}

onMounted(() => {
  void loadProfile()
})
</script>

<template>
  <a-spin :spinning="loading">
    <!-- 账号资料（§3：email 只读 / nickname 编辑保存） -->
    <div class="dl-tab-section">
      <div class="dl-section-title">账号资料</div>
      <a-descriptions :column="1" size="small">
        <a-descriptions-item label="邮箱">{{ emailText }}</a-descriptions-item>
        <a-descriptions-item label="昵称">
          <div class="account-nickname">
            <a-input
              v-model:value="nicknameInput"
              class="account-nickname-input"
              placeholder="请输入昵称"
            />
            <a-space v-if="nicknameDirty">
              <a-button size="small" type="primary" :loading="savingNickname" @click="saveNickname">
                保存
              </a-button>
              <a-button size="small" :disabled="savingNickname" @click="cancelNickname">
                取消
              </a-button>
            </a-space>
          </div>
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <!-- 会话（§3：退出登录） -->
    <div class="dl-tab-section">
      <div class="dl-section-title">会话</div>
      <a-descriptions :column="1" size="small">
        <a-descriptions-item label="登录态">
          已登录，会话 30 天滑动续期（每次使用自动续期）
        </a-descriptions-item>
      </a-descriptions>
      <div class="account-actions">
        <a-button danger ghost :loading="loggingOut" @click="confirmLogout">退出登录</a-button>
      </div>
    </div>
  </a-spin>
</template>

<style scoped>
.account-nickname {
  display: flex;
  align-items: center;
  gap: 12px;
}

.account-nickname-input {
  max-width: 280px;
}

.account-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>