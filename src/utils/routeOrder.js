/**
 * 路線卡排序（站點內各路線的顯示順序）
 * ------------------------------------------------------------------
 * 除了「最近一班到站時間」之外，再以「本站到路線終點的剩餘距離」排序：
 *
 *   1. 長途方向優先：剩餘距離（公尺）由長到短
 *   2. 短途方向排後面：最後一站或倒數幾站的車自然排在長途之後
 *   3. 終點站最後：本站就是該路線的終點時，一律排最後
 *   4. 同距離時再依最近一班到站時間、路線號碼排序；缺座標時改用剩餘站數比較
 *
 * `entry.progress` 由 services/api.js 的 attachRouteProgress() 預先計算：
 * `{ remainingStops, remainingDistance, isTerminus }`；讀取失敗或逾時的路線沒有 progress，
 * 退回以到站時間排序，排在「有 progress 的路線」之後、「終點站」之前。
 */

function sortByArrival(a, b) {
  const aMinutes = a.nextMinutes ?? Number.POSITIVE_INFINITY
  const bMinutes = b.nextMinutes ?? Number.POSITIVE_INFINITY
  if (aMinutes !== bMinutes) return aMinutes - bMinutes
  return a.route.localeCompare(b.route, 'en', { numeric: true })
}

/**
 * 依剩餘距離排序路線卡（長途優先、終點站最後）。
 * @param {Array<{route:string, nextMinutes?:number|null, progress?:{remainingStops:number, remainingDistance:number|null, isTerminus:boolean}}>} routes
 * @returns {Array} 排序後的新陣列（不改動傳入的陣列）
 */
export function sortRoutes(routes) {
  return [...routes].sort((a, b) => {
    const aProgress = a.progress
    const bProgress = b.progress
    // 終點站（本站即路線終點）一律最後
    const aTerminus = aProgress?.isTerminus ? 1 : 0
    const bTerminus = bProgress?.isTerminus ? 1 : 0
    if (aTerminus !== bTerminus) return aTerminus - bTerminus

    if (aProgress && bProgress) {
      const aDistance = Number.isFinite(aProgress.remainingDistance)
        ? aProgress.remainingDistance
        : null
      const bDistance = Number.isFinite(bProgress.remainingDistance)
        ? bProgress.remainingDistance
        : null
      if (aDistance != null && bDistance != null) {
        if (aDistance !== bDistance) return bDistance - aDistance
      } else if (aProgress.remainingStops !== bProgress.remainingStops) {
        // 缺座標時退回用剩餘站數比較
        return bProgress.remainingStops - aProgress.remainingStops
      }
    } else if (aProgress) {
      return -1
    } else if (bProgress) {
      return 1
    }

    return sortByArrival(a, b)
  })
}
