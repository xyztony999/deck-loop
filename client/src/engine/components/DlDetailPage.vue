<script setup lang="ts">
/**
 * DlDetailPage v2 — 详情页引擎（07-ui-design-language.md §3.4 单表面形态）。
 *
 * 粘顶页头行（标题 + 关闭）→ 860 居中小节流。规约（D-01~03）保持：
 * - 空值统一 '-'；日期 YYYY-MM-DD HH:mm；金额按规范；字典 colorTag
 * - 区块 >=3 自动启用悬浮锚点（§5.8，Teleport body）
 */
import { computed, ref } from 'vue'
import { MenuOutlined, CloseOutlined } from '@ant-design/icons-vue'

import type { DlDetailBlock, DlDetailField, DlDetailPageConfig } from '../pageSchemas'
import { useDict } from '../dict'
import { displayValue, formatAmount, formatDatetime, formatUnitPrice } from '../format'

const props = defineProps<{
  config: DlDetailPageConfig
  /** 详情数据（DetailVO）；null 时展示骨架 */
  data?: Record<string, unknown> | null
  /** 字典接口域（dict 字段渲染需要） */
  domain?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'link-click', field: DlDetailField, data: Record<string, unknown>): void
}>()

const blocks = computed<DlDetailBlock[]>(() => props.config.blocks)

const dictKeys = computed(() => {
  const keys = new Set<string>()
  blocks.value.forEach((b) =>
    b.fields.forEach((f) => {
      if (f.type === 'dict' && f.dictKey) keys.add(f.dictKey)
    }),
  )
  return [...keys]
})

const dict = useDict(props.domain ?? '', dictKeys.value)

function text(f: DlDetailField): string {
  const raw = props.data?.[f.field]
  switch (f.type) {
    case 'dict': {
      const nameField = `${f.field}Name`
      const name = props.data?.[nameField]
      if (typeof name === 'string' && name) return name
      return dict.label(f.dictKey ?? '', String(raw ?? '')) || displayValue(raw)
    }
    case 'amount':
      return formatAmount(raw as number | string | null) || '-'
    case 'unitPrice':
      return formatUnitPrice(raw as number | string | null) || '-'
    case 'datetime':
      return formatDatetime(raw as string | null) || '-'
    default:
      return displayValue(raw)
  }
}

function tagColor(f: DlDetailField): string | undefined {
  if (f.type !== 'dict') return undefined
  return dict.color(f.dictKey ?? '', String(props.data?.[f.field] ?? ''))
}

function isEmpty(f: DlDetailField): boolean {
  return text(f) === '-'
}

// 悬浮锚点（§5.8）
const anchorOpen = ref(false)
const showAnchor = computed(() => blocks.value.length >= 3)
</script>

<template>
  <div class="dl-page">
    <!-- 粘顶页头行 + 动作槽 + 关闭按钮（D-01；关闭与动作按钮同容器对齐） -->
    <div class="dl-page-header dl-sticky">
      <h1 class="dl-page-title">{{ config.title }}</h1>
      <div class="dl-page-header-right">
        <a-space :size="8" wrap>
          <slot name="header-actions" />
          <a-button @click="emit('close')">关闭</a-button>
        </a-space>
      </div>
    </div>

    <!-- 注意：a-skeleton 非加载态直接渲染插槽内容（无包装元素），
         居中容器必须自建在插槽内而非挂在 a-skeleton 上 -->
    <a-skeleton :loading="loading" active :paragraph="{ rows: 6 }">
      <div class="dl-detail-body">
        <div
          v-for="block in blocks"
          :id="`dl-detail-${block.key}`"
          :key="block.key"
          class="dl-section"
        >
          <h3 class="dl-section-title">{{ block.title }}</h3>
          <!-- 属性网格（07 v2.0 §3.4：标签上值下 2 列，无冒号通栏行） -->
          <div class="dl-prop-grid">
            <div v-for="f in block.fields" :key="f.field" class="dl-prop">
              <div class="dl-prop-label">{{ f.label }}</div>
              <div class="dl-prop-value">
                <!-- 字典 Tag（§5.4） -->
                <template v-if="f.type === 'dict' && !isEmpty(f)">
                  <a-tag v-if="tagColor(f)" :color="tagColor(f)">{{ text(f) }}</a-tag>
                  <span v-else>{{ text(f) }}</span>
                </template>
                <!-- 金额（§5.3） -->
                <span v-else-if="f.type === 'amount'" class="dl-amount">{{ text(f) }}</span>
                <span v-else-if="f.type === 'unitPrice'" class="dl-unit-price">{{ text(f) }}</span>
                <template v-else>
                  <slot
                    :name="`field-${f.field}`"
                    :field="f"
                    :data="data"
                  >
                    <span :class="{ 'dl-empty-value': isEmpty(f) }">{{ text(f) }}</span>
                  </slot>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </a-skeleton>

    <!-- 悬浮锚点（区块 >=3，§5.8） -->
    <teleport v-if="showAnchor" to="body">
      <div class="dl-anchor-float">
        <div v-if="anchorOpen" class="dl-anchor-float-panel">
          <div class="dl-anchor-float-header">
            <span>导航</span>
            <a-button type="text" size="small" @click="anchorOpen = false">
              <CloseOutlined />
            </a-button>
          </div>
          <a-anchor :offset-top="80" :affix="false">
            <a-anchor-link
              v-for="b in blocks"
              :key="b.key"
              :href="`#dl-detail-${b.key}`"
              :title="b.title"
            />
          </a-anchor>
        </div>
        <a-button
          v-else
          type="primary"
          shape="circle"
          size="large"
          @click="anchorOpen = true"
        >
          <MenuOutlined />
        </a-button>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.dl-detail-body {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 24px 32px;
}

/* 属性网格（07 v2.0 §3.4）：2 列、标签上值下、行距 20 列距 32 */
.dl-prop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 32px;
}

.dl-prop {
  min-width: 0;
}

.dl-prop-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--dl-text-secondary);
}

.dl-prop-value {
  font-size: 14px;
  color: var(--dl-title-color);
  overflow-wrap: anywhere;
}
</style>
