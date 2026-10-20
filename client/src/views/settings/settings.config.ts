/**
 * settings 模块页面 config（PageSpec settings.md §5 用量统计表格列；
 * 列宽/对齐按 frontend-specs §5.5 字段类型规范）。
 *
 * 用量统计为「radio 维度 + timeRange AO + rows 响应」形态，DlListPage
 * 查询区（select/dateRange 拆分）与响应契约（records）均不匹配
 * （api-channel.md §4.4 原文为 timeRange / rows），故表格列以本 config
 * 驱动原生 a-table 呈现，数据循环在 UsageTab 内实现。
 */

/** 用量统计表格列（a-table 形态；§5.5：名称 200 / 数量右对齐 / 日期 170） */
export interface UsageTableColumn {
  key: string
  dataIndex: string
  title: string
  width?: number
  align?: 'left' | 'center' | 'right'
}

export const usageTableColumns: UsageTableColumn[] = [
  { key: 'dimName', dataIndex: 'dimName', title: '名称', width: 220, align: 'left' },
  { key: 'taskCount', dataIndex: 'taskCount', title: '任务数', width: 100, align: 'right' },
  { key: 'promptTokens', dataIndex: 'promptTokens', title: '输入 Tokens', width: 140, align: 'right' },
  { key: 'completionTokens', dataIndex: 'completionTokens', title: '输出 Tokens', width: 140, align: 'right' },
  { key: 'lastUsedAt', dataIndex: 'lastUsedAt', title: '最近使用', width: 170, align: 'left' },
  // 静态条形（任务数占比，纯 CSS 不引图表库；呈现增强列）
  { key: '__share__', dataIndex: '__share__', title: '任务数占比', width: 200, align: 'left' },
]
