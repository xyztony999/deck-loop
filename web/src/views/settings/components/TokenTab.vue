<script setup lang="ts">
/**
 * API token Tab（PageSpec settings.md §4，新增）。
 *
 * - 列表：tokenName · tokenPrefix（等宽）· status tag · createdTime · expiresAt
 *   （永久「长期」）· lastUsedAt（从未「—」）· 操作（revoke，status≠REVOKED）；
 * - 签发弹层（480px）：tokenName✅≤50 · 有效期 radio（90 天默认/自定义 1~365/永久）；
 *   成功态切换为明文展示（等宽只读 + 复制 + 警示「仅显示这一次」INV-28，无再次查看路径）；
 * - 吊销强确认（即时生效，不可恢复）；错误透传 BIZ_*（BIZ_AUTH_TOKEN_INVALID 引导重新签发）。
 */
import { computed, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { CopyOutlined, PlusOutlined } from '@ant-design/icons-vue'

import { executeAction, formatDatetime, useListPage } from '@/engine'
import {
  TOKEN_EXPIRES_DAYS_DEFAULT,
  TOKEN_EXPIRES_DAYS_MAX,
  TOKEN_EXPIRES_DAYS_MIN,
  TOKEN_NAME_MAX,
  TOKEN_STATUS,
  type TokenIssueVO,
  type TokenListRow,
} from '../types'

// ---------------------------------------------------------------
// 列表（auth.tokenList 分页）
// ---------------------------------------------------------------

const list = useListPage<TokenListRow>({ listAction: 'auth.tokenList' })

const columns = [
  { key: 'tokenName', dataIndex: 'tokenName', title: '名称', width: 180, ellipsis: true },
  { key: 'tokenPrefix', dataIndex: 'tokenPrefix', title: 'Token 前缀', width: 180 },
  { key: 'status', dataIndex: 'status', title: '状态', width: 100, align: 'center' as const },
  { key: 'createdTime', dataIndex: 'createdTime', title: '创建时间', width: 170 },
  { key: 'expiresAt', dataIndex: 'expiresAt', title: '有效期', width: 170 },
  { key: 'lastUsedAt', dataIndex: 'lastUsedAt', title: '最近使用', width: 170 },
  { key: '__action__', dataIndex: '__action__', title: '操作', width: 100, align: 'center' as const },
]

function statusColor(status: string): string {
  return status === TOKEN_STATUS.ACTIVE ? 'green' : 'default'
}

function statusLabel(status: string): string {
  if (status === TOKEN_STATUS.ACTIVE) return '生效中'
  if (status === TOKEN_STATUS.EXPIRED) return '已过期'
  if (status === TOKEN_STATUS.REVOKED) return '已吊销'
  return status
}

function expiresText(row: TokenListRow): string {
  return row.expiresAt ? formatDatetime(row.expiresAt) : '长期'
}

function lastUsedText(row: TokenListRow): string {
  return row.lastUsedAt ? formatDatetime(row.lastUsedAt) : '—'
}

function canRevoke(row: TokenListRow): boolean {
  return row.status !== TOKEN_STATUS.REVOKED
}

function revoke(row: TokenListRow): void {
  Modal.confirm({
    title: `吊销「${row.tokenName}」？`,
    content: '吊销后使用该 token 的 MCP 立即失效，不可恢复。',
    okText: '吊销',
    cancelText: '取消',
    okButtonProps: { danger: true },
    maskClosable: false,
    async onOk() {
      await executeAction('auth.tokenRevoke', { tokenId: row.tokenId })
      message.success('已吊销')
      await list.refresh()
    },
  })
}

// ---------------------------------------------------------------
// 签发弹层（表单态 → 成功态明文展示）
// ---------------------------------------------------------------

const issueOpen = ref(false)
const issuing = ref(false)
const issuedToken = ref<TokenIssueVO | null>(null)

type ExpiresMode = 'default' | 'custom' | 'permanent'

const form = reactive({
  tokenName: '',
  expiresMode: 'default' as ExpiresMode,
  customDays: TOKEN_EXPIRES_DAYS_DEFAULT,
})

const expiresModeOptions = [
  { label: `90 天（默认）`, value: 'default' },
  { label: '自定义', value: 'custom' },
  { label: '永久', value: 'permanent' },
]

function openIssue(): void {
  form.tokenName = ''
  form.expiresMode = 'default'
  form.customDays = TOKEN_EXPIRES_DAYS_DEFAULT
  issuedToken.value = null
  issueOpen.value = true
}

const nameError = computed(() => {
  const name = form.tokenName.trim()
  if (!name) return '请填写用途名'
  if (name.length > TOKEN_NAME_MAX) return `用途名不能超过 ${TOKEN_NAME_MAX} 字`
  return ''
})

async function submitIssue(): Promise<void> {
  if (nameError.value) {
    message.warning(nameError.value)
    return
  }
  if (
    form.expiresMode === 'custom' &&
    (form.customDays < TOKEN_EXPIRES_DAYS_MIN || form.customDays > TOKEN_EXPIRES_DAYS_MAX)
  ) {
    message.warning(`自定义有效期须在 ${TOKEN_EXPIRES_DAYS_MIN}~${TOKEN_EXPIRES_DAYS_MAX} 天`)
    return
  }
  issuing.value = true
  try {
    const payload: Record<string, unknown> = { tokenName: form.tokenName.trim() }
    if (form.expiresMode === 'permanent') {
      payload.permanent = true
    } else if (form.expiresMode === 'custom') {
      payload.expiresDays = form.customDays
    } else {
      payload.expiresDays = TOKEN_EXPIRES_DAYS_DEFAULT
    }
    const vo = await executeAction<TokenIssueVO>('auth.tokenIssue', payload)
    issuedToken.value = vo
    await list.refresh()
  } catch {
    // BIZ_* 文案由 request 层透传
  } finally {
    issuing.value = false
  }
}

async function copyToken(): Promise<void> {
  if (!issuedToken.value?.token) return
  try {
    await navigator.clipboard.writeText(issuedToken.value.token)
    message.success('已复制')
  } catch {
    message.error('复制失败，请手动选择复制')
  }
}

function closeIssue(): void {
  issueOpen.value = false
  issuedToken.value = null
}
</script>

<template>
  <div class="dl-tab-section token-tab">
    <div class="dl-section-title">API token</div>
    <p class="token-desc">
      个人 API token 供 coding agent 的 deck-loop MCP 远程模式鉴权（环境变量
      DECK_LOOP_API_TOKEN）。token 等价你的账号权限，泄露请立即吊销。
    </p>

    <div class="token-toolbar">
      <a-button type="primary" size="small" @click="openIssue">
        <PlusOutlined />
        签发 token
      </a-button>
    </div>

    <a-table
      class="dl-table"
      :columns="columns"
      :data-source="list.records.value"
      :loading="list.loading.value"
      row-key="tokenId"
      :pagination="false"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'tokenPrefix'">
          <span class="token-prefix">{{ record.tokenPrefix }}…</span>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'createdTime'">
          {{ formatDatetime(record.createdTime) }}
        </template>
        <template v-else-if="column.key === 'expiresAt'">
          {{ expiresText(record as TokenListRow) }}
        </template>
        <template v-else-if="column.key === 'lastUsedAt'">
          {{ lastUsedText(record as TokenListRow) }}
        </template>
        <template v-else-if="column.key === '__action__'">
          <a-button
            v-if="canRevoke(record as TokenListRow)"
            type="link"
            size="small"
            danger
            @click="revoke(record as TokenListRow)"
          >
            吊销
          </a-button>
          <span v-else class="dl-empty-value">—</span>
        </template>
      </template>
      <template #emptyText>
        <a-empty description="暂无 token，点击「签发 token」创建" />
      </template>
    </a-table>

    <div class="token-footer">
      <span class="dl-footer-total">共 {{ list.total.value }} 条</span>
      <a-pagination
        size="small"
        :current="list.pageNum.value"
        :page-size="list.pageSize.value"
        :total="list.total.value"
        @change="list.handlePageChange"
      />
    </div>

    <!-- 签发弹层（浮层 480px） -->
    <a-modal
      :open="issueOpen"
      :title="issuedToken ? 'token 已签发' : '签发 token'"
      :width="480"
      :mask-closable="false"
      :destroy-on-close="true"
      :footer="null"
      @update:open="(v: boolean) => (v ? null : closeIssue())"
    >
      <!-- 成功态：明文仅此次（INV-28） -->
      <div v-if="issuedToken" class="token-issued">
        <a-alert
          type="warning"
          show-icon
          message="token 仅显示这一次，关闭后无法再次查看。请配置到 MCP 环境变量 DECK_LOOP_API_TOKEN。"
          class="token-issued-warn"
        />
        <div class="token-issued-row">
          <a-input class="token-plaintext" :value="issuedToken.token" readonly />
          <a-button type="primary" @click="copyToken">
            <CopyOutlined />
            复制
          </a-button>
        </div>
        <div class="token-issued-foot">
          <a-button @click="closeIssue">关闭</a-button>
        </div>
      </div>

      <!-- 表单态 -->
      <a-form v-else layout="vertical">
        <a-form-item label="用途名" required>
          <a-input
            v-model:value="form.tokenName"
            :maxlength="TOKEN_NAME_MAX"
            show-count
            placeholder="如：ZCode 桌面"
          />
        </a-form-item>
        <a-form-item label="有效期">
          <a-radio-group
            v-model:value="form.expiresMode"
            :options="expiresModeOptions"
            option-type="button"
            button-style="solid"
          />
          <a-input-number
            v-if="form.expiresMode === 'custom'"
            v-model:value="form.customDays"
            class="token-custom-days"
            :min="TOKEN_EXPIRES_DAYS_MIN"
            :max="TOKEN_EXPIRES_DAYS_MAX"
            :precision="0"
            addon-after="天"
          />
        </a-form-item>
        <div class="token-form-foot">
          <a-button @click="closeIssue">取消</a-button>
          <a-button type="primary" :loading="issuing" @click="submitIssue">签发</a-button>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.token-tab {
  max-width: 1080px;
}

.token-desc {
  color: var(--dl-text-secondary);
  font-size: 12px;
  line-height: 1.7;
  margin: 0 0 16px;
}

.token-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.token-prefix {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  color: var(--dl-title-color);
}

.token-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0 0;
}

.token-issued-warn {
  margin-bottom: 16px;
}

.token-issued-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.token-plaintext {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
}

.token-issued-foot {
  display: flex;
  justify-content: flex-end;
}

.token-custom-days {
  margin-top: 8px;
  width: 160px;
}

.token-form-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>