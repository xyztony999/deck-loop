<script setup lang="ts">
/**
 * Deck-Loop logo mark（品牌标，07 v2.0 设计语言）。
 * 设计源（单一来源）：profiles/deck-loop/workspace/01-solution/common-spec/assets/logo/deck-loop-mark.svg
 * 组件内联以便随主题 token 取色（--dl-primary），亮暗两主题与两个表面域通用；
 * 几何：循环环（270° 环形箭头，右上缺口）环绕错位双层幻灯片（Deck）。
 */
withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    fill="none"
    role="img"
    aria-label="Deck-Loop"
  >
    <!-- 循环环：顺时针 270°，缺口留右上 -->
    <path
      d="M448 256 A192 192 0 1 1 256 64"
      stroke="var(--dl-primary)"
      stroke-width="48"
      stroke-linecap="round"
    />
    <!-- 箭头：接环端点，指入缺口（循环方向） -->
    <path d="M232 16 L328 64 L232 112 Z" fill="var(--dl-primary)" />
    <!-- Deck：后层幻灯片（错位层次） -->
    <rect
      x="170" y="200" width="172" height="112" rx="16"
      fill="var(--dl-primary)" opacity="0.32" transform="translate(20,20)"
    />
    <!-- Deck：前层幻灯片 -->
    <rect x="170" y="200" width="172" height="112" rx="16" fill="var(--dl-primary)" />
  </svg>
</template>
