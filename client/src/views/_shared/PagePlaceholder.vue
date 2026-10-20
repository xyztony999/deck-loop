<script setup lang="ts">
/** 占位页（F2-F4 逐页替换为引擎驱动页面） */
defineProps<{
  title: string
  note?: string
}>()
</script>

<template>
  <div class="dl-page">
    <div class="dl-page-card">
      <div class="dl-card-title">{{ title }}</div>
      <a-empty :description="note ?? '页面占位 — 由 F2-F4 批次生成正式实现'" />
    </div>
  </div>
</template>
