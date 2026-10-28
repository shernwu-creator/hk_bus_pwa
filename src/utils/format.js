/** 距離顯示：< 1 公里用公尺，之後用小數一位公里 */
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return ''
  if (meters < 1000) return `${Math.round(meters)} 公尺`
  return `${(meters / 1000).toFixed(1)} 公里`
}

const pad = (value) => String(value).padStart(2, '0')

/** 24 小時制時間，例如 08:05 */
export function formatClock(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 日期＋時間，例如 10/28 08:05 */
export function formatDateTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()} ${formatClock(date)}`
}

/** 剩餘分鐘轉成 UI 文字 */
export function formatMinutes(minutes) {
  if (minutes == null) return '未有班次'
  if (minutes <= 0) return '即將到站'
  return `${minutes} 分鐘`
}

/** 服務類型：1 為正常班次，其他視為特別班次 */
export function serviceTypeLabel(serviceType) {
  return String(serviceType ?? '1') === '1' ? '' : `特別班次 ${serviceType}`
}
