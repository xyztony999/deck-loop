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
  <div v-else class="dl-page dl-page-card">
    <a-alert type="warning" message="缺少对比版本，请从版本树选择两个版本后对比" show-icon />
    <a-button @click="close">返回迭代工作台</a-button>
  </div>
</template>
