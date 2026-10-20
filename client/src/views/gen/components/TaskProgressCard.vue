<script setup lang="ts">
/**
 * 任务进度卡（PageSpec generation.md §4 步骤①/③ 任务进度条；
 * adjustment.md §4.3 同款形态）。
 *
 * 状态渲染：
 * - 未发起：提示 + [发起] 按钮（startLabel）
 * - QUEUED/RUNNING：进度条 + 阶段文案 + [取消]
 * - SUCCEEDED：成功提示
 * - FAILED：错误摘要透传（含网关 BIZ_GW_* 后端 msg 回填）+ [重试]
 * - CANCELLED：已取消提示
 * 状态文案/颜色由父页面经 dict（task.TaskStatus）传入，本组件不感知字典。
 */
import { computed } from 'vue'
import { CloseOutlined, RedoOutlined } from '@ant-design/icons-vue'

import { TASK_STATUS, isTerminalTaskStatus } from '../types'
import type { TaskProgressInfo } from '../composables/useTaskProgress'

type CardPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'

const props = defineProps<{
  task?: TaskProgressInfo
  /** 字典反查的状态文案（task.TaskStatus） */
  statusLabel?: string
  /** idle 态发起按钮文案（如「生成大纲」「发起整稿生成」） */
  startLabel?: string
  startLoading?: boolean
  /** idle 态提示文案 */
  hint?: string
}>()

const emit = defineEmits<{
  (e: 'start'): void
  (e: 'cancel'): void
  (e: 'retry'): void
}>()

const phase = computed<CardPhase>(() => {
  if (!props.task) return 'idle'
  const s = props.task.taskStatus
  if (s === TASK_STATUS.SUCCEEDED) return 'succeeded'
  if (s === TASK_STATUS.FAILED) return 'failed'
  if (s === TASK_STATUS.CANCELLED) return 'cancelled'
  if (isTerminalTaskStatus(s)) return 'cancelled'
  return 'running'
})

const percent = computed(() => props.task?.progressPercent ?? 0)
const stageText = computed(() => {
  const t = props.task
  if (!t) return ''
  if (t.stageText) return t.stageText
  return t.taskStatus === TASK_STATUS.QUEUED ? '排队中…' : '处理中…'
})

const failText = computed(
  () => props.task?.errorMsg || '任务失败，请重试或查看任务记录',
)
</script>

<template>
  <div class="task-card">
    <!-- 未发起 -->
    <template v-if="phase === 'idle'">
      <div class="task-idle">
        <span class="task-hint">{{ hint ?? '尚未发起任务' }}</span>
        <a-button
          v-if="startLabel"
          type="primary"
          :loading="startLoading"
          @click="emit('start')"
        >
          {{ startLabel }}
        </a-button>
      </div>
    </template>

    <!-- 进行中：进度条 + 阶段文案 + 取消 -->
    <template v-else-if="phase === 'running'">
      <div class="task-running">
        <div class="task-line">
          <span class="task-stage">{{ stageText }}</span>
          <span class="task-status">{{ statusLabel ?? '' }}</span>
        </div>
        <a-progress
          :percent="percent"
          status="active"
          size="small"
          :show-info="true"
        />
        <div class="task-actions">
          <a-button size="small" danger @click="emit('cancel')">
            <CloseOutlined />
            取消任务
          </a-button>
        </div>
      </div>
    </template>

    <!-- 成功 -->
    <a-alert
      v-else-if="phase === 'succeeded'"
      type="success"
      show-icon
      :message="`${statusLabel ?? '已成功'} · 已完成`"
    />

    <!-- 失败：错误摘要透传 + 重试 -->
    <div v-else-if="phase === 'failed'" class="task-failed">
      <a-alert type="error" show-icon :message="`${statusLabel ?? '失败'} · 任务失败`" :description="failText" />
      <div class="task-actions">
        <a-button size="small" type="primary" @click="emit('retry')">
          <RedoOutlined />
          重试
        </a-button>
      </div>
    </div>

    <!-- 已取消 -->
    <a-alert
      v-else
      type="info"
      show-icon
      :message="`${statusLabel ?? '已取消'} · 任务已取消`"
    />
  </div>
</template>

<style scoped>
.task-idle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-hint {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.task-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.task-stage {
  color: var(--dl-title-color);
}

.task-status {
  color: var(--dl-text-secondary);
  font-size: 13px;
}

.task-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.task-failed .task-actions {
  margin-top: 8px;
}
</style>
