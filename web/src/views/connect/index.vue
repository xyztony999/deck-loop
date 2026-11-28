<script setup lang="ts">
/**
 * MCP 插件连接授权页（ADR-019 浏览器授权流，PageSpec connect）。
 *
 * 链路：插件侧 remote_connect 起 127.0.0.1 回环监听 → 打开本页（?callback=&name=）→
 * 用户确认 → 会话内签发个人 API token（INV-28：明文仅此一次回执，不落库）→
 * 302 回跳 callback（token 经 query 传本机监听口）→ 插件落盘切远程。
 *
 * 安全线：callback 仅允许 127.0.0.1/localhost/[::1]（resolveConnectTarget 拒绝非本机
 * 目标，防 token 外泄）；未登录由全局守卫重定向 /auth?redirect= 本页（登录后回跳）。
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { ApiOutlined } from '@ant-design/icons-vue'
import { executeAction } from '@/engine'
import { appendTokenParams, resolveConnectTarget } from '@/services/connect'

const route = useRoute()
const resolved = computed(() => resolveConnectTarget(route.query.callback, route.query.name))
const issuing = ref(false)
const redirected = ref(false)

interface TokenIssueVO {
  token: string
  tokenPrefix?: string
  expiresAt?: number | null
}

async function confirmConnect(): Promise<void> {
  if (!resolved.value.ok) return
  issuing.value = true
  try {
    const vo = await executeAction<TokenIssueVO>('auth.tokenIssue', {
      tokenName: resolved.value.target.name,
      expiresDays: 90,
    })
    redirected.value = true
    message.success('已授权连接，正在返回插件…')
    window.location.href = appendTokenParams(resolved.value.target.url, vo.token, vo.expiresAt)
  } catch {
    // BIZ_* 文案由 request 层透传
  } finally {
    issuing.value = false
  }
}
</script>

<template>
  <div class="connect-page">
    <div class="connect-card">
      <template v-if="!resolved.ok">
        <a-alert type="error" show-icon :message="'无法发起连接'" :description="resolved.reason" />
      </template>
      <template v-else-if="redirected">
        <a-result status="success" title="已授权" sub-title="token 已回传本机插件，可关闭此页返回 agent。" />
      </template>
      <template v-else>
        <ApiOutlined class="connect-icon" />
        <h2 class="connect-title">连接请求</h2>
        <p class="connect-desc">
          <strong>{{ resolved.target.name }}</strong> 请求连接你的 deck-loop 账号。
          确认后将为你签发个人 API token（90 天有效，可随时在 设置 → API token 吊销），
          并回传至本机回环地址 <code>{{ resolved.target.url }}</code>。
        </p>
        <a-button type="primary" size="large" :loading="issuing" @click="confirmConnect">
          确认连接
        </a-button>
        <p class="connect-hint">仅本机回环地址可接收 token；如有疑虑请核对上方地址。</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.connect-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dl-bg-layout, #141414);
}
.connect-card {
  width: 480px;
  max-width: calc(100vw - 32px);
  background: var(--dl-bg-container, #1f1f1f);
  border-radius: 8px;
  padding: 40px 32px;
  text-align: center;
}
.connect-icon {
  font-size: 40px;
  color: #6b8ab5;
}
.connect-title {
  margin: 16px 0 8px;
  font-size: 20px;
}
.connect-desc {
  color: var(--dl-text-secondary, rgba(255, 255, 255, 0.65));
  line-height: 1.7;
  margin-bottom: 24px;
}
.connect-hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--dl-text-tertiary, rgba(255, 255, 255, 0.45));
}
code {
  font-family: monospace;
  word-break: break-all;
}
</style>