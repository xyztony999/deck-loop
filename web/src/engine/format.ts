/**
 * 展示格式化（frontend-specs §5.3 金额 / §5.9 日期与空值）。
 */
import dayjs from 'dayjs'

const CNY = 'CNY'

function group(value: number, fractionDigits: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/** 金额（2 位小数）：CNY 1,234.56，null/undefined 返回 '' */
export function formatAmount(value: number | string | null | undefined): string {
  if (value == null || value === '') return ''
  return `${CNY} ${group(Number(value), 2)}`
}

/** 单价（8 位小数）：CNY 1,234.12345678 */
export function formatUnitPrice(
  value: number | string | null | undefined,
): string {
  if (value == null || value === '') return ''
  return `${CNY} ${group(Number(value), 8)}`
}

/** 日期时间：YYYY-MM-DD HH:mm（详情页标准格式，§5.9） */
export function formatDatetime(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return ''
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(value)
}

/** 详情空值统一显示 '-'（§5.9） */
export function displayValue(value: unknown): string {
  if (value == null || value === '') return '-'
  return String(value)
}
