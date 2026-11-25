<script setup lang="ts">
/** 占位页（F2-F4 逐页替换为引擎驱动页面；07 v2.0 单表面形态） */
defineProps<{
  title: string
  note?: string
}>()
</script>

<template>
  <div class="dl-page">
    <div class="dl-page-header">
      <h1 class="dl-page-title">{{ title }}</h1>
    </div>
    <div class="dl-placeholder-body">
      <a-empty :description="note ?? '页面占位 — 由 F2-F4 批次生成正式实现'" />
    </div>
  </div>
</template>

<style scoped>
.dl-placeholder-body {
  padding: 24px;
}
</style>
