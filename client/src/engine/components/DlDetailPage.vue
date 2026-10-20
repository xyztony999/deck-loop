<script setup lang="ts">
/**
 * DlDetailPage — 详情页引擎（描述列表 + 锚点区块）。
 *
 * 规约（frontend-specs §5.9 / D-01~03）：
 * - sticky 标题栏 + 右侧关闭按钮（type=default）
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
    <!-- sticky 标题栏 + 关闭按钮（D-01） -->
    <div class="dl-sticky-bar dl-detail-bar">
      <span class="dl-bar-title">{{ config.title }}</span>
      <a-button type="default" @click="emit('close')">
        <CloseOutlined />
        关闭
      </a-button>
    </div>

    <a-skeleton :loading="loading" active :paragraph="{ rows: 6 }">
      <div
        v-for="block in blocks"
        :id="`dl-detail-${block.key}`"
        :key="block.key"
        class="dl-page-card"
      >
        <div class="dl-card-title">{{ block.title }}</div>
        <a-descriptions :column="3" size="small">
          <a-descriptions-item
            v-for="f in block.fields"
            :key="f.field"
            :label="f.label"
            :span="1"
          >
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
          </a-descriptions-item>
        </a-descriptions>
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
.dl-detail-bar {
  margin-bottom: 12px;
}

.dl-bar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--dl-title-color);
}
</style>
