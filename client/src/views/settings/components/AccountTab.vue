<script setup lang="ts">
/**
 * Tab3 账户（PageSpec settings.md §6 config 详情卡）。
 *
 * - 账户信息：email / 昵称（auth.profile 读/改昵称，api-platform.md §4.4）；
 *   昵称保存成功后回写 auth store（App.vue 顶栏昵称即时更新）；
 * - 多端同步：当前游标 / 最近同步时间 + [立即同步]（auth.syncPull 游标
 *   拉取，hasMore 分页拉全，结果 toast「更新 n 项」）；「最近同步时间」
 *   后端契约无字段，以本地最近一次成功同步时间展示（TODO 请确认）；
 * - 会话：登录态说明 + [退出登录]（confirm → 有进行中任务则阻断提示
 *   （§8，经 gen.taskList 按 QUEUED/RUNNING 各探测一次）→ auth.logout
 *   → 回 /auth）。
 */
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'

import { executeAction, formatDatetime } from '@/engine'
import { SETTINGS_AUTH_ACTIONS } from '@/api/actions/settings'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { useLogout } from '@/composables/useLogout'
import type {
  AccountProfileVO,
} from '../types'

const auth = useAuthStore()
const sync = useSyncStore()
const { loggingOut, confirmLogout } = useLogout()
const syncing = computed(() => sync.syncing)

// ---------------------------------------------------------------
// 账户信息（auth.profile：空 AO 读、带 nickname 改）
// ---------------------------------------------------------------

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
    await executeAction(SETTINGS_AUTH_ACTIONS.accountProfile, { nickname })
    if (profile.value) profile.value.nickname = nickname
    // 回写 store：App.vue 顶栏昵称即时更新（并持久化 localStorage）
    auth.updateNickname(nickname)
    message.success('昵称已更新')
  } finally {
    savingNickname.value = false
  }
}

function cancelNickname(): void {
  nicknameInput.value = profile.value?.nickname ?? ''
}

// ---------------------------------------------------------------
// 多端同步（auth.syncPull：游标推进 + toast 更新 n 项）
// ---------------------------------------------------------------

const cursorText = computed(() => String(sync.snapshot.cursor))
const lastSyncText = computed(() => sync.snapshot.lastSyncAt ? formatDatetime(sync.snapshot.lastSyncAt) : '-')

async function syncNow(): Promise<void> {
  try {
    const total = await auth.syncNow()
    message.success(`同步完成，更新 ${total} 项`)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '同步未完成，请重试')
  }
}

onMounted(() => {
  void loadProfile()
})
</script>

<template>
  <a-spin :spinning="loading">
    <!-- 账户信息（§6：email/昵称 + 昵称编辑） -->
    <div class="dl-tab-section">
      <div class="dl-card-title">账户信息</div>
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

    <!-- 多端同步（§6：当前游标/最近同步时间 + 立即同步） -->
    <div class="dl-tab-section">
      <div class="dl-card-title">多端同步</div>
      <a-descriptions :column="2" size="small">
        <a-descriptions-item label="当前游标">{{ cursorText }}</a-descriptions-item>
        <a-descriptions-item label="最近同步时间">{{ lastSyncText }}</a-descriptions-item>
      </a-descriptions>
      <div class="account-actions">
        <a-button :loading="syncing" @click="syncNow">立即同步</a-button>
      </div>
    </div>

    <!-- 会话（§6：登录态到期 + 退出登录） -->
    <div class="dl-tab-section">
      <div class="dl-card-title">会话</div>
      <a-descriptions :column="1" size="small">
        <a-descriptions-item label="登录态">
          <!-- TODO 请确认：后端未返回登录态到期时间字段（token 30 天滑动，
               api-platform.md §4.4 login VO），暂以滑动续期说明展示 -->
          已登录，会话 30 天滑动续期（每次使用自动续期）
        </a-descriptions-item>
      </a-descriptions>
      <div class="account-actions">
        <a-button danger :loading="loggingOut" @click="confirmLogout">退出登录</a-button>
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
