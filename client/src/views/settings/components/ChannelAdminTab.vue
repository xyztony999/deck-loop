<script setup lang="ts">
/**
 * 设置 → 模型渠道管理 Tab（渠道管理端，channel-admin-2026-10-23 §5；
 * 07-ui-design-language v2.0：列表坐表面 + 弹层浮层语言）。
 *
 * - 清单：渠道名/编码/baseUrl/优先级/模型数/密钥掩码/状态/来源/操作（编辑|启停|测试）；
 *   builtin 内置渠道只读（仅可启停）；
 * - 表单弹层：名称/编码（编辑只读）/baseUrl/apiKey（掩码留空保留）/apiKeyEnv/
 *   优先级/启用 + 模型清单行编辑（编码/名称/能力四标签/启停/删行）+ 测试连接；
 * - 保存即热生效（服务端 reload 运行时快照），无需重启。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'

import { executeAction } from '@/engine'

/** 能力标签（与后端 CHANNEL_CAPABILITY_TAGS 契约一致，顺序即展示序） */
const CAPABILITY_OPTIONS = [
  { value: 'OUTLINE', label: '大纲' },
  { value: 'FULL_GENERATE', label: '整稿' },
  { value: 'FULL_ADJUST', label: '整稿调整' },
  { value: 'TARGETED_ADJUST', label: '定向调整' },
] as const

interface ChannelModelItem {
  modelCode: string
  modelName: string
  capabilityTags: string[]
  enabled: boolean
}

interface ChannelRecord {
  channelCode: string
  channelName: string
  apiBaseUrl: string
  priority: number
  enabled: boolean
  builtin: boolean
  source: string
  apiKeyMasked: string
  models: ChannelModelItem[]
}

const SOURCE_LABELS: Record<string, string> = {
  builtin: '内置',
  'env-import': 'env 导入',
  admin: '管理端',
}

const records = ref<ChannelRecord[]>([])
const loading = ref(false)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const data = await executeAction<{ records: ChannelRecord[] }>('channel.adminList', {})
    records.value = data?.records ?? []
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

// ---------------------------------------------------------------
// 启停 / 行内测试
// ---------------------------------------------------------------

async function onToggle(row: ChannelRecord, enabled: boolean): Promise<void> {
  await executeAction('channel.adminSetEnabled', { channelCode: row.channelCode, enabled })
  message.success(enabled ? '已启用并生效' : '已停用并生效')
  await refresh()
}

const testingCode = ref('')

async function onTestRow(row: ChannelRecord): Promise<void> {
  testingCode.value = row.channelCode
  try {
    const vo = await executeAction<{ ok: boolean; latencyMs?: number; errorMsg?: string }>(
      'channel.adminTest',
      { channelCode: row.channelCode },
    )
    if (vo?.ok) {
      message.success(`「${row.channelName}」连通正常（${vo.latencyMs ?? 0}ms）`)
    } else {
      message.error(`连通失败：${vo?.errorMsg ?? '未知原因'}`)
    }
  } finally {
    testingCode.value = ''
  }
}

// ---------------------------------------------------------------
// 表单弹层（新建/编辑）
// ---------------------------------------------------------------

const formOpen = ref(false)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; latencyMs?: number; errorMsg?: string } | null>(null)

interface FormModelRow {
  modelCode: string
  modelName: string
  capabilityTags: string[]
  enabled: boolean
}

const form = reactive({
  creating: false,
  channelCode: '',
  channelName: '',
  apiBaseUrl: '',
  apiKey: '',
  apiKeyEnv: '',
  priority: 100,
  enabled: true,
  models: [] as FormModelRow[],
})

/** 编辑态既有掩码（列表行带入，提示留空保留） */
const editMasked = ref('')

function openCreate(): void {
  form.creating = true
  form.channelCode = ''
  form.channelName = ''
  form.apiBaseUrl = ''
  form.apiKey = ''
  form.apiKeyEnv = ''
  form.priority = 100
  form.enabled = true
  form.models = [{ modelCode: '', modelName: '', capabilityTags: [], enabled: true }]
  editMasked.value = ''
  testResult.value = null
  formOpen.value = true
}

function openEdit(row: ChannelRecord): void {
  form.creating = false
  form.channelCode = row.channelCode
  form.channelName = row.channelName
  form.apiBaseUrl = row.apiBaseUrl
  form.apiKey = ''
  form.apiKeyEnv = row.apiKeyMasked.startsWith('env:') ? row.apiKeyMasked.slice(4) : ''
  form.priority = row.priority
  form.enabled = row.enabled
  form.models = row.models.map((m) => ({
    modelCode: m.modelCode,
    modelName: m.modelName,
    capabilityTags: [...m.capabilityTags],
    enabled: m.enabled,
  }))
  editMasked.value = row.apiKeyMasked
  testResult.value = null
  formOpen.value = true
}

function addModelRow(): void {
  form.models.push({ modelCode: '', modelName: '', capabilityTags: [], enabled: true })
}

function removeModelRow(index: number): void {
  form.models.splice(index, 1)
}

const apiKeyPlaceholder = computed(() =>
  editMasked.value ? `已配置 ${editMasked.value}，留空保留` : '渠道 API Key',
)

/** 客户端前置校验（服务端为权威） */
function validateForm(): string | null {
  if (!form.channelCode.trim()) return '请填写渠道编码'
  if (!/^[A-Z][A-Z0-9_]{0,47}$/.test(form.channelCode.trim())) {
    return '渠道编码须为大写字母开头的 A-Z0-9_'
  }
  if (!form.channelName.trim()) return '请填写渠道名称'
  if (!form.apiBaseUrl.trim()) return '请填写 baseUrl'
  if (form.creating && !form.apiKey.trim() && !form.apiKeyEnv.trim()) {
    return '请提供 API Key 或环境变量引用'
  }
  if (form.models.length === 0) return '至少配置一个模型'
  const codes = new Set<string>()
  for (const m of form.models) {
    if (!m.modelCode.trim()) return '模型编码不能为空'
    if (!m.modelName.trim()) return '模型名称不能为空'
    if (codes.has(m.modelCode.trim())) return `模型编码重复：${m.modelCode}`
    codes.add(m.modelCode.trim())
  }
  if (form.enabled && !form.models.some((m) => m.enabled)) {
    return '启用渠道须至少保留一个启用模型'
  }
  return null
}

async function onTestForm(): Promise<void> {
  const err = validateForm()
  if (err) {
    message.warning(err)
    return
  }
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await executeAction('channel.adminTest', {
      channelCode: form.creating ? undefined : form.channelCode,
      apiBaseUrl: form.apiBaseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      modelCode: form.models.find((m) => m.enabled)?.modelCode ?? form.models[0]?.modelCode,
    })
  } finally {
    testing.value = false
  }
}

async function onSave(): Promise<void> {
  const err = validateForm()
  if (err) {
    message.warning(err)
    return
  }
  saving.value = true
  try {
    await executeAction('channel.adminSave', {
      channelCode: form.channelCode.trim().toUpperCase(),
      creating: form.creating,
      channelName: form.channelName.trim(),
      apiBaseUrl: form.apiBaseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      apiKeyEnv: form.apiKeyEnv.trim() || undefined,
      priority: form.priority,
      enabled: form.enabled,
      models: form.models.map((m) => ({
        modelCode: m.modelCode.trim(),
        modelName: m.modelName.trim(),
        capabilityTags: [...m.capabilityTags],
        enabled: m.enabled,
      })),
    })
    message.success('已保存并生效，无需重启')
    formOpen.value = false
    await refresh()
  } finally {
    saving.value = false
  }
}

function closeForm(): void {
  if (!saving.value) {
    formOpen.value = false
  }
}

const columns = [
  { title: '渠道', dataIndex: 'channelName', key: 'channelName', width: 150 },
  { title: '编码', dataIndex: 'channelCode', key: 'channelCode', width: 110 },
  { title: 'baseUrl', dataIndex: 'apiBaseUrl', key: 'apiBaseUrl', ellipsis: true },
  { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, align: 'center' as const },
  { title: '模型', key: 'modelCount', width: 70, align: 'center' as const },
  { title: '密钥', key: 'keyMasked', width: 150 },
  { title: '状态', key: 'enabled', width: 80, align: 'center' as const },
  { title: '来源', key: 'source', width: 90, align: 'center' as const },
  { title: '操作', key: 'ops', width: 170, align: 'center' as const },
]
</script>

<template>
  <div class="channel-admin">
    <!-- 工具栏 -->
    <div class="channel-admin-toolbar">
      <a-button type="primary" @click="openCreate">新建渠道</a-button>
      <a-button @click="refresh">刷新</a-button>
      <span class="channel-admin-hint">
        配置保存在服务端数据库，保存即热生效；env 仅作首次导入引导，之后以这里为准
      </span>
    </div>

    <!-- 渠道清单 -->
    <a-table
      class="dl-table"
      :columns="columns"
      :data-source="records"
      :loading="loading"
      :pagination="false"
      row-key="channelCode"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'channelName'">
          <span class="channel-name">{{ (record as ChannelRecord).channelName }}</span>
          <a-tag v-if="(record as ChannelRecord).builtin" class="channel-builtin-tag">内置</a-tag>
        </template>
        <template v-else-if="column.key === 'modelCount'">
          {{ (record as ChannelRecord).models.length }}
        </template>
        <template v-else-if="column.key === 'keyMasked'">
          <span v-if="(record as ChannelRecord).apiKeyMasked" class="channel-key">
            {{ (record as ChannelRecord).apiKeyMasked }}
          </span>
          <span v-else class="channel-key channel-key--empty">未配置</span>
        </template>
        <template v-else-if="column.key === 'enabled'">
          <a-tag v-if="(record as ChannelRecord).enabled" color="success">启用</a-tag>
          <a-tag v-else>停用</a-tag>
        </template>
        <template v-else-if="column.key === 'source'">
          {{ SOURCE_LABELS[(record as ChannelRecord).source] ?? (record as ChannelRecord).source }}
        </template>
        <template v-else-if="column.key === 'ops'">
          <a-space :size="4">
            <a-button
              type="link"
              size="small"
              :disabled="(record as ChannelRecord).builtin"
              @click="openEdit(record as ChannelRecord)"
            >
              编辑
            </a-button>
            <a-button
              type="link"
              size="small"
              @click="onToggle(record as ChannelRecord, !(record as ChannelRecord).enabled)"
            >
              {{ (record as ChannelRecord).enabled ? '停用' : '启用' }}
            </a-button>
            <a-button
              type="link"
              size="small"
              :loading="testingCode === (record as ChannelRecord).channelCode"
              @click="onTestRow(record as ChannelRecord)"
            >
              测试
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 新建/编辑弹层（浮层语言：#262626 + radius 10） -->
    <Teleport to="body">
      <div v-if="formOpen" class="dl-dialog-overlay">
        <div class="dl-dialog channel-dialog" role="dialog" aria-modal="true">
          <div class="dl-dialog-head">
            <span class="dl-dialog-title">{{ form.creating ? '新建渠道' : '编辑渠道' }}</span>
            <a-button type="text" size="small" :disabled="saving" @click="closeForm">✕</a-button>
          </div>

          <div class="dl-dialog-body channel-dialog-body">
            <a-form class="dl-form" layout="vertical">
              <div class="channel-form-grid">
                <a-form-item label="渠道名称" required>
                  <a-input
                    v-model:value="form.channelName"
                    placeholder="如：智谱 GLM"
                    :maxlength="100"
                  />
                </a-form-item>
                <a-form-item label="渠道编码" required>
                  <a-input
                    v-model:value="form.channelCode"
                    placeholder="如：GLM（大写字母开头）"
                    :maxlength="48"
                    :disabled="!form.creating"
                  />
                </a-form-item>
              </div>

              <a-form-item label="baseUrl" required>
                <a-input
                  v-model:value="form.apiBaseUrl"
                  placeholder="OpenAI 兼容端点，如 https://open.bigmodel.cn/api/paas/v4"
                  :maxlength="500"
                />
              </a-form-item>

              <div class="channel-form-grid">
                <a-form-item :label="form.creating ? 'API Key' : 'API Key（留空保留）'">
                  <a-input-password
                    v-model:value="form.apiKey"
                    :placeholder="apiKeyPlaceholder"
                    :maxlength="500"
                    autocomplete="new-password"
                  />
                </a-form-item>
                <a-form-item label="密钥环境变量名（可选）">
                  <a-input
                    v-model:value="form.apiKeyEnv"
                    placeholder="如 GLM_API_KEY；填写后优先生效"
                    :maxlength="200"
                  />
                </a-form-item>
              </div>

              <div class="channel-form-grid">
                <a-form-item label="优先级（数值大优先）">
                  <a-input-number v-model:value="form.priority" :min="-9999" :max="9999" class="channel-w-full" />
                </a-form-item>
                <a-form-item label="启用">
                  <a-switch v-model:checked="form.enabled" />
                </a-form-item>
              </div>

              <!-- 模型清单行编辑 -->
              <div class="channel-models">
                <div class="channel-models-head">
                  <span class="channel-models-title">模型清单</span>
                  <a-button size="small" @click="addModelRow">
                    <PlusOutlined />
                    添加模型
                  </a-button>
                </div>
                <div v-for="(m, i) in form.models" :key="i" class="channel-model-row">
                  <a-input
                    v-model:value="m.modelCode"
                    placeholder="模型编码，如 glm-4.7"
                    :maxlength="100"
                    class="channel-model-code"
                  />
                  <a-input
                    v-model:value="m.modelName"
                    placeholder="模型名称"
                    :maxlength="100"
                    class="channel-model-name"
                  />
                  <a-checkbox-group v-model:value="m.capabilityTags" class="channel-model-tags">
                    <a-checkbox v-for="cap in CAPABILITY_OPTIONS" :key="cap.value" :value="cap.value">
                      {{ cap.label }}
                    </a-checkbox>
                  </a-checkbox-group>
                  <a-switch v-model:checked="m.enabled" size="small" />
                  <a-button type="link" danger size="small" @click="removeModelRow(i)">删</a-button>
                </div>
              </div>

              <!-- 测试结果内联回显 -->
              <div v-if="testResult" class="channel-test-result" :class="testResult.ok ? 'is-ok' : 'is-fail'">
                <template v-if="testResult.ok">
                  ✓ 连通正常（{{ testResult.latencyMs ?? 0 }}ms）
                </template>
                <template v-else>✕ 连通失败：{{ testResult.errorMsg ?? '未知原因' }}</template>
              </div>
            </a-form>
          </div>

          <div class="dl-dialog-foot">
            <a-button :disabled="testing" @click="onTestForm">
              {{ testing ? '测试中…' : '测试连接' }}
            </a-button>
            <a-button :disabled="saving" @click="closeForm">取消</a-button>
            <a-button type="primary" :loading="saving" @click="onSave">保存</a-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 弹层骨架（结构与 ExportCreateDialog 同款；scoped 各自持有，不能省） */
.dl-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 48px 16px;
}

.dl-dialog {
  background: var(--dl-card-bg);
  border: 1px solid var(--dl-border-light);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dl-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--dl-border-light);
}

.dl-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dl-title-color);
}

.dl-dialog-body {
  padding: 16px;
}

.dl-dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--dl-border-light);
}

.channel-admin {
  padding: 0 24px 24px;
}

.channel-admin-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
}

.channel-admin-hint {
  margin-left: auto;
  color: var(--dl-text-secondary);
  font-size: 12px;
}

.channel-name {
  font-weight: 600;
}

.channel-builtin-tag {
  margin-left: 4px;
}

.channel-key {
  font-size: 12px;
  color: var(--dl-text-secondary);
}

.channel-key--empty {
  opacity: 0.6;
}

/* 弹层宽于默认 520（模型行编辑需要） */
.channel-dialog {
  width: 720px;
  max-width: calc(100vw - 32px);
}

.channel-dialog-body {
  max-height: calc(100vh - 260px);
  overflow-y: auto;
}

.channel-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
}

.channel-w-full {
  width: 100%;
}

.channel-models {
  border: 1px solid var(--dl-border-light);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.channel-models-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.channel-models-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dl-title-color);
}

.channel-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.channel-model-code {
  width: 170px;
  flex: none;
}

.channel-model-name {
  width: 130px;
  flex: none;
}

.channel-model-tags {
  flex: 1;
  min-width: 0;
}

.channel-test-result {
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.channel-test-result.is-ok {
  color: var(--dl-primary);
}

.channel-test-result.is-fail {
  color: var(--dl-danger-color);
}
</style>
