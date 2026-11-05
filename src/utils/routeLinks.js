/**
 * 「路線站序頁」的站內路徑組裝
 *
 * 路徑：`/route/:operator/:route/:direction`
 * 查詢參數（全部都可省略，頁面會逐項還原）：
 * - `stop`      要高亮／自動展開的站點 ID
 * - `name`      站名（反轉方向後用站名在反向站序找回同一站）
 * - `siblings`  同站其他月台的站點 ID，逗號分隔（九巴同站不同月台）
 * - `serviceType` 九巴服務類型（'1' 為常用正線）
 * - `routeId` / `routeSeq` 小巴站序查詢必要參數
 * - `orig` / `dest` 起點與終點站名（用於標題列，反轉時互換）
 *
 * 站內導覽一律以 react-router 的 `navigate()`／`<Link>` 原視窗切換，因此這裡只組出
 * 相對於 Router basename 的路徑；`BrowserRouter` 的 basename 已跟隨
 * `import.meta.env.BASE_URL`，不需要（也不應該）在路徑前再拼 BASE_URL。
 * 只有外部連結（例如 Google Maps）才使用 `target="_blank"`。
 */

function encode(value) {
  return encodeURIComponent(String(value ?? ''))
}

/**
 * 組出路線站序頁的站內路徑（交給 `useNavigate()` 或 `<Link to>`）。
 *
 * @param {object} entry 路線 ETA 資料（operator/route/direction/serviceType/routeId/routeSeq/orig/destination）
 * @param {object} [stop] 目前站點（id/nameTc/nameEn/siblingIds）
 * @returns {string|null} 無法組出時回傳 null（缺少 operator／route／direction）
 */
export function buildRouteSequencePath(entry, stop) {
  const {
    operator,
    route,
    direction,
    serviceType,
    routeId,
    routeSeq,
    orig,
    destination,
    routeDestination,
  } = entry ?? {}
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
  // 循環線回程卡顯示「往起點」，但站序頁標題應維持官方終點（routeDestination）
  const destinationQuery = routeDestination || destination
  if (destinationQuery) query.push(`dest=${encode(destinationQuery)}`)

  const path = `route/${encode(operator)}/${encode(route)}/${encode(direction)}`
  return `/${path}${query.length > 0 ? `?${query.join('&')}` : ''}`
}
