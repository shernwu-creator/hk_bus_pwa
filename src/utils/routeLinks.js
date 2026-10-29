/**
 * 「新視窗站序頁」的 URL 組裝與開啟邏輯
 *
 * 路徑：`{BASE_URL}route/:operator/:route/:direction`
 * 查詢參數（全部都可省略，頁面會逐項還原）：
 * - `stop`      要高亮／自動展開的站點 ID
 * - `name`      站名（反轉方向後用站名在反向站序找回同一站）
 * - `siblings`  同站其他月台的站點 ID，逗號分隔（九巴同站不同月台）
 * - `serviceType` 九巴服務類型（'1' 為常用正線）
 * - `routeId` / `routeSeq` 小巴站序查詢必要參數
 * - `orig` / `dest` 起點與終點站名（用於標題列，反轉時互換）
 *
 * 部署在子路徑（GitHub Pages：/hk_bus_pwa/）時必須以 import.meta.env.BASE_URL 為前綴，
 * 不可寫死 `/`。
 */

/** 保證 BASE_URL 以 `/` 結尾（dev 為 `/`，build 為 `/hk_bus_pwa/`） */
const BASE_URL = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

function encode(value) {
  return encodeURIComponent(String(value ?? ''))
}

/**
 * 組出新視窗站序頁的完整 URL。
 *
 * @param {object} entry 路線 ETA 資料（operator/route/direction/serviceType/routeId/routeSeq/orig/destination）
 * @param {object} [stop] 目前站點（id/nameTc/nameEn/siblingIds）
 * @returns {string|null} 無法組出時回傳 null（缺少 operator／route／direction）
 */
export function buildRouteSequenceUrl(entry, stop) {
  const { operator, route, direction, serviceType, routeId, routeSeq, orig, destination } = entry ?? {}
  if (!operator || !route || !direction) return null

  const query = []
  if (stop?.id) {
    query.push(`stop=${encode(stop.id)}`)
    const name = stop.nameTc || stop.nameEn || ''
    if (name) query.push(`name=${encode(name)}`)
    // 月台 ID 以逗號串接，頁面會逐一分別比對 stop.id
    const siblings = [...new Set((stop.siblingIds ?? []).filter(Boolean))].filter(
      (id) => id !== stop.id,
    )
    if (siblings.length > 0) query.push(`siblings=${encode(siblings.join(','))}`)
  }
  if (serviceType) query.push(`serviceType=${encode(serviceType)}`)
  if (routeId != null && routeId !== '') query.push(`routeId=${encode(routeId)}`)
  if (routeSeq != null && routeSeq !== '') query.push(`routeSeq=${encode(routeSeq)}`)
  if (orig) query.push(`orig=${encode(orig)}`)
  if (destination) query.push(`dest=${encode(destination)}`)

  const path = `route/${encode(operator)}/${encode(route)}/${encode(direction)}`
  return `${BASE_URL}${path}${query.length > 0 ? `?${query.join('&')}` : ''}`
}

/**
 * 在新視窗開啟站序頁。
 *
 * - 優先 `window.open(url, '_blank')`；被瀏覽器／PWA 封鎖（回傳 null）時改用
 *   `window.location.assign(url)`，至少不讓點擊無反應。
 * - 成功開啟後把 `win.opener` 設為 null，避免新視窗透過 window.opener 反向操作本頁。
 *
 * @param {object} entry 路線 ETA 資料
 * @param {object} [stop] 目前站點
 * @returns {Window|null} 新視窗（或 null 代表已改為在目前視窗開啟）
 */
export function openRouteSequence(entry, stop) {
  const url = buildRouteSequenceUrl(entry, stop)
  if (!url) return null

  const win = window.open(url, '_blank')
  if (!win) {
    // 彈出視窗被封鎖（部分 PWA／iOS 環境）：退回同視窗導覽
    window.location.assign(url)
    return null
  }

  try {
    win.opener = null
  } catch {
    // 跨來源或瀏覽器禁止設定時忽略即可
  }
  return win
}
