<script setup lang="ts">
/**
 * 内容预览画布（PageSpec adjustment.md §4 左区，hybrid 的 code 部分）。
 *
 * - 渲染当前（或树节点预览）版本 content：pages[] → blocks[]，
 *   TEXT 直出文本 / IMAGE 走限时签发 URL（父级注入 fileUrls 映射）/
 *   PLACEHOLDER 占位框；
 * - 可选中定位（TargetKind 作用域）：单击页面 → PAGE，单击文本/图片块 →
 *   TEXT_BLOCK / IMAGE_BLOCK；再次点击或「清除选择」回整稿模式；
 * - 任务进行中：骨架屏 + 阶段文案；FAILED：错误条 + 重试；
 * - 预览非当前版本时顶部提示「调整将产生分叉」（§4.1 版本切换行）。
 */
import { computed } from 'vue'
import { ClearOutlined, RedoOutlined } from '@ant-design/icons-vue'

import {
  BLOCK_TARGET_KIND,
  type AdjustTarget,
  type VersionBlock,
  type VersionPage,
} from '../types'

const props = defineProps<{
  pages: VersionPage[]
  /** assetId → 限时签发 URL（useVersionContent 批量签发结果） */
  fileUrls?: Record<string, string>
  selected?: AdjustTarget | null
  /** scope/validate 结果：false 时选中态红色虚线提示 */
  targetValid?: boolean
  /** 只读/禁选（Deck FINALIZED/ARCHIVED 或任务进行中） */
  disabled?: boolean
  loading?: boolean
  taskRunning?: boolean
  taskStage?: string
  /** 任务终态失败：错误条 + 重试（§4 画布区） */
  taskFailed?: boolean
  taskError?: string
  /** 版本头标签（v{seq} · branch） */
  versionLabel?: string
  /** 正在预览的是否当前版本（false → 分叉提示） */
  baselineIsCurrent?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', target: AdjustTarget | null): void
  (e: 'retry'): void
}>()

const pagesSafe = computed(() => props.pages ?? [])

function isPageSelected(page: VersionPage): boolean {
  return !!props.selected && props.selected.pageId === page.pageId
}

/** 选中块所在页（弱高亮定位） */
function isPageOfSelectedBlock(page: VersionPage): boolean {
  const s = props.selected
  return !!s && !!s.blockId && s.pageId === page.pageId
}

function isBlockSelected(block: VersionBlock): boolean {
  const s = props.selected
  return !!s && !!s.blockId && s.blockId === block.blockId
}

function onPageClick(page: VersionPage): void {
  if (props.disabled) return
  // 再次点击已选页 → 清除选择（回整稿模式）
  if (isPageSelected(page) && !props.selected?.blockId) {
    emit('select', null)
    return
  }
  emit('select', { kind: 'PAGE', pageId: page.pageId })
}

function onBlockClick(page: VersionPage, block: VersionBlock): void {
  if (props.disabled) return
  const kind = BLOCK_TARGET_KIND[block.blockType]
  if (!kind) return // PLACEHOLDER 不可选中定位
  if (isBlockSelected(block)) {
    emit('select', null)
    return
  }
  emit('select', {
    kind,
    pageId: page.pageId,
    blockId: block.blockId,
    blockType: block.blockType === 'IMAGE' ? 'IMAGE' : 'TEXT',
  })
}

function imageUrl(block: VersionBlock): string | undefined {
  return block.assetId ? props.fileUrls?.[block.assetId] : undefined
}

function clearSelection(): void {
  emit('select', null)
}
</script>

<template>
  <div class="dl-canvas">
    <!-- 画布头：版本标签 + 选取提示 + 清除选择 -->
    <div class="dl-canvas-head">
      <div class="dl-canvas-head-left">
        <a-tag v-if="versionLabel" color="blue">{{ versionLabel }}</a-tag>
        <a-tag v-if="baselineIsCurrent === false" color="orange">预览 · 非当前版本</a-tag>
        <span class="dl-canvas-tip">单击页面或文本/图片块选中为定向目标</span>
      </div>
      <a-button
        v-if="selected && !disabled"
        type="link"
        size="small"
        @click="clearSelection"
      >
        <ClearOutlined />
        清除选择（回整稿）
      </a-button>
    </div>

    <!-- 预览非当前版本：调整将产生分叉（§4.1） -->
    <a-alert
      v-if="baselineIsCurrent === false"
      class="dl-canvas-fork-tip"
      type="warning"
      show-icon
      message="正在预览非当前版本：基于该基线发起调整将产生分叉分支"
    />

    <!-- 任务终态失败：错误条 + 重试（§4 画布区） -->
    <a-alert
      v-if="taskFailed"
      class="dl-canvas-fork-tip"
      type="error"
      show-icon
      message="调整任务失败"
      :description="taskError || '任务失败，可重试或前往任务记录查看详情'"
    >
    </a-alert>
    <div v-if="taskFailed" class="dl-canvas-retry">
      <a-button size="small" type="primary" @click="emit('retry')">
        <RedoOutlined />
        重试任务
      </a-button>
    </div>

    <!-- 任务进行中：骨架屏 + 进度阶段（§4 画布区） -->
    <div v-if="taskRunning" class="dl-canvas-task">
      <a-skeleton active :paragraph="{ rows: 6 }" />
      <div class="dl-canvas-stage">{{ taskStage || '调整任务进行中…' }}</div>
    </div>

    <!-- 版本加载中 -->
    <div v-else-if="loading" class="dl-canvas-task">
      <a-skeleton active :paragraph="{ rows: 6 }" />
      <div class="dl-canvas-stage">正在加载版本内容…</div>
    </div>

    <!-- 页面流 -->
    <div v-else-if="pagesSafe.length > 0" class="dl-canvas-pages">
      <div
        v-for="(page, pi) in pagesSafe"
        :key="page.pageId"
        class="dl-canvas-page"
        :class="{
          'is-selected': isPageSelected(page) && !selected?.blockId,
          'is-host': isPageOfSelectedBlock(page),
          'is-invalid': isPageSelected(page) && targetValid === false,
          'is-disabled': disabled,
        }"
        @click="onPageClick(page)"
      >
        <div class="dl-canvas-page-head">
          <span class="dl-canvas-page-no">第 {{ pi + 1 }} 页</span>
          <span class="dl-canvas-page-title">{{ page.title || '未命名页' }}</span>
          <a-tag v-if="isPageSelected(page) && !selected?.blockId" color="blue">定向目标</a-tag>
        </div>

        <div class="dl-canvas-blocks">
          <template v-for="block in page.blocks" :key="block.blockId">
            <div
              v-if="block.blockType === 'TEXT'"
              class="dl-blk dl-blk-text"
              :class="{
                'is-selected': isBlockSelected(block),
                'is-invalid': isBlockSelected(block) && targetValid === false,
              }"
              @click.stop="onBlockClick(page, block)"
            >
              {{ block.text || '（空文本块）' }}
            </div>

            <div
              v-else-if="block.blockType === 'IMAGE'"
              class="dl-blk dl-blk-image"
              :class="{
                'is-selected': isBlockSelected(block),
                'is-invalid': isBlockSelected(block) && targetValid === false,
              }"
              @click.stop="onBlockClick(page, block)"
            >
              <img v-if="imageUrl(block)" :src="imageUrl(block)" alt="图片块" />
              <div v-else class="dl-blk-image-ph">图片素材加载中或不可用</div>
            </div>

            <div v-else class="dl-blk dl-blk-placeholder">占位块（不可选中）</div>
          </template>
          <a-empty
            v-if="page.blocks.length === 0"
            :image-style="{ height: '40px' }"
            description="本页无内容块"
          />
        </div>
      </div>
    </div>

    <!-- 空版本 -->
    <a-empty v-else description="该版本暂无内容" />
  </div>
</template>

<style scoped>
/* 画布根 = 单盒台面（07 v2.0）：表面色板 + 描边 + 圆角，坐页面底的工作台上；
 * 版本行与白纸页卡同坐台面，不再 wrapper+内层双层盒 */
.dl-canvas {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--dl-card-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 8px;
  padding: 12px 16px;
}

.dl-canvas-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.dl-canvas-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dl-canvas-tip {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.dl-canvas-fork-tip {
  margin-bottom: 8px;
}

.dl-canvas-task {
  padding: 8px 0;
}

.dl-canvas-stage {
  margin-top: 8px;
  color: var(--dl-text-secondary);
  font-size: 13px;
}

/* 页卡滚动区（台面色由根节点承担，此处仅滚动布局） */
.dl-canvas-pages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 07-ui-design-language.md：页卡 = 文档表面（--dl-doc-bg 永远白纸，内容/状态色
 * 属文档域白名单）；选中描边用唯一主色。 */
.dl-canvas-page {
  border: 2px solid var(--dl-border-light);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  padding: 12px;
  background: var(--dl-doc-bg);
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
}

.dl-canvas-page:hover {
  border-color: #93c5fd;
}

.dl-canvas-page.is-host {
  border-color: #bfdbfe;
}

.dl-canvas-page.is-selected {
  border-color: var(--dl-primary);
  background: #f0f7ff;
}

.dl-canvas-page.is-invalid {
  border-style: dashed;
  border-color: #ff4d4f;
  background: #fff2f0;
}

.dl-canvas-page.is-disabled {
  cursor: not-allowed;
}

.dl-canvas-page-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.dl-canvas-page-no {
  color: var(--dl-text-secondary);
  font-size: 13px;
  flex: none;
}

.dl-canvas-page-title {
  font-weight: 600;
  color: var(--dl-title-color);
}

.dl-canvas-blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dl-blk {
  border: 1.5px solid transparent;
  border-radius: 4px;
  padding: 8px;
  font-size: 13px;
  line-height: 1.6;
  transition: border-color 0.2s, background-color 0.2s;
}

.dl-blk-text {
  background: #fafafa;
  color: #374151;
  white-space: pre-wrap;
  word-break: break-word;
}

.dl-blk-text:hover {
  border-color: #fdba74;
}

.dl-blk-image {
  background: #f9fafb;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dl-blk-image img {
  max-width: 100%;
  max-height: 220px;
  border-radius: 4px;
  object-fit: contain;
}

.dl-blk-image-ph {
  color: #9ca3af;
  font-size: 13px;
  border: 1px dashed #d1d5db;
  border-radius: 4px;
  padding: 12px 16px;
}

.dl-blk-placeholder {
  border: 1px dashed #d1d5db;
  color: #9ca3af;
  text-align: center;
}

.dl-blk.is-selected {
  border-color: #fa8c16;
  background: #fff7e6;
}

.dl-blk.is-invalid {
  border-style: dashed;
  border-color: #ff4d4f;
  background: #fff2f0;
}

.dl-canvas-retry {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
</style>
