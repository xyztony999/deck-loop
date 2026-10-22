<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VersionCompareDrawer from './components/VersionCompareDrawer.vue'

const route = useRoute()
const router = useRouter()
const deckId = computed(() => String(route.params.deckId ?? ''))
const target = computed(() => {
  const left = route.query.left
  const right = route.query.right
  return typeof left === 'string' && left && typeof right === 'string' && right
    ? { leftVersionId: left, rightVersionId: right }
    : null
})

function close(): void {
  void router.replace(`/deck/${encodeURIComponent(deckId.value)}/iterate`)
}
</script>

<template>
  <VersionCompareDrawer v-if="target" :open="true" :deck-id="deckId" :target="target" @update:open="close" />
  <div v-else class="dl-page">
    <div class="dl-page-header">
      <h1 class="dl-page-title">版本对比</h1>
    </div>
    <div class="compare-fallback-body">
      <a-alert type="warning" message="缺少对比版本，请从版本树选择两个版本后对比" show-icon />
      <div class="compare-fallback-actions">
        <a-button @click="close">返回迭代工作台</a-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare-fallback-body {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}

.compare-fallback-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
