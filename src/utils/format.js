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

/* ------------------------------------------------------------------ */
/* 站名標準化                                                          */
/* ------------------------------------------------------------------ */

/**
 * 站名尾端的站牌代號，例如「彌敦道 (YT123)」「某站 (AB12)」。
 * 代號必須包含數字（九巴格式為 1～3 個英文字母＋數字，如 YT123、KT512a、C1）；
 * 這樣才不會把英文站名尾端的地名括號（例如「Lam Tin (North)」「… (WEST)」）誤當代號。
 */
const STOP_CODE_PATTERN = /\s*[(（]\s*([A-Za-z]{1,3}\d{1,4}[a-z]?)\s*[)）]\s*$/i

/** 站名尾端的月台描述，例如「某站 - 3號月台」「某站 - 月台 A」 */
const PLATFORM_SUFFIX_PATTERN =
  /\s*[-–—]\s*(?:(?:第\s*)?[A-Za-z0-9]{1,3}\s*號?\s*)?(?:月台|站台|泊位)\s*[A-Za-z0-9]{0,3}\s*$/i

/**
 * 站名標準化：移除尾端的站牌代號與月台後綴，方便把同一車站的多個站位合併顯示
 *   「彌敦道 (YT123)」→「彌敦道」
 *   「某站 (AB12)」→「某站」
 *   「某站 - 3號月台」→「某站」
 * 只處理「尾端」的修飾字，站名中間的括號（例如「中環 (交易廣場)」）會原樣保留。
 * @param {string} name
 * @returns {string} 乾淨站名；傳入空值時回傳空字串
 */
export function normalizeStopName(name) {
  let cleaned = String(name ?? '').trim()
  if (!cleaned) return ''
  // 代號與月台後綴可能一前一後出現（例如「某站 (AB12) - 1號月台」），最多處理三輪
  for (let round = 0; round < 3; round += 1) {
    const next = cleaned.replace(STOP_CODE_PATTERN, '').replace(PLATFORM_SUFFIX_PATTERN, '')
    if (next === cleaned) break
    cleaned = next
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

/**
 * 取出站名尾端的站牌代號（給小標籤用，不會改動原始站名）
 * @param {string} name
 * @returns {string} 例如 'YT123'；沒有代號時回傳空字串
 */
export function stopPlatformCode(name) {
  const withoutPlatform = String(name ?? '')
    .trim()
    .replace(PLATFORM_SUFFIX_PATTERN, '')
  const match = withoutPlatform.match(STOP_CODE_PATTERN)
  return match ? match[1].toUpperCase() : ''
}
