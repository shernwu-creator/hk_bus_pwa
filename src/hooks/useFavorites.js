import { useCallback, useEffect, useState } from 'react'

/** 收藏站點（沿用既有 key，向下相容已儲存的資料） */
const STORAGE_KEY = 'hkb:favorites:v1'
/** 收藏路線（獨立 key：舊版只會讀寫上面的站點 key，不會被舊版覆蓋或丟失） */
const ROUTE_STORAGE_KEY = 'hkb:favorite-routes:v1'

/** 收藏站點的唯一識別：業者 + 站點編號（同一位置可能同時有九巴與城巴站） */
export function favoriteKey(stop) {
  if (!stop?.id) return ''
  return `${stop.operator}:${stop.id}`
}

/** 收藏路線的唯一識別：業者 + 路線 + 方向 + 服務類型（同一路線可有去／回程與特別班次） */
export function favoriteRouteKey(route) {
  if (!route?.operator || !route?.route) return ''
  const direction = route.direction === 'inbound' ? 'inbound' : 'outbound'
  return `${route.operator}:${route.route}:${direction}:${String(route.serviceType ?? '1')}`
}

function isValidStopFavorite(item) {
  return Boolean(item && item.id && item.operator)
}

/** 舊收藏可能缺少欄位：逐筆補預設值，不因單筆壞資料清空整份收藏 */
function normalizeStopFavorite(item) {
  if (!isValidStopFavorite(item)) return null
  return {
    ...item,
    nameTc: item.nameTc ?? '',
    nameEn: item.nameEn ?? '',
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    routes: Array.isArray(item.routes) ? item.routes : [],
    siblingIds: Array.isArray(item.siblingIds) ? item.siblingIds : [],
    savedAt: Number.isFinite(item.savedAt) ? item.savedAt : Date.now(),
  }
}

function normalizeRouteFavorite(item) {
  if (!item?.operator || !item?.route) return null
  const direction = item.direction === 'inbound' ? 'inbound' : 'outbound'
  const stop =
    item.stop && item.stop.id
      ? {
          id: item.stop.id,
          nameTc: item.stop.nameTc ?? '',
          nameEn: item.stop.nameEn ?? '',
          lat: item.stop.lat ?? null,
          lng: item.stop.lng ?? null,
          siblingIds: Array.isArray(item.stop.siblingIds) ? item.stop.siblingIds : [],
        }
      : null
  return {
    operator: item.operator,
    route: String(item.route),
    direction,
    serviceType: String(item.serviceType ?? '1'),
    orig: item.orig ?? '',
    origEn: item.origEn ?? '',
    destination: item.destination ?? '',
    destinationEn: item.destinationEn ?? item.destination ?? '',
    routeId: item.routeId ?? null,
    routeSeq: item.routeSeq ?? null,
    // 由站序頁收藏時可記錄「來源站」，作為進入站序頁時的預設站點
    stop,
    savedAt: Number.isFinite(item.savedAt) ? item.savedAt : Date.now(),
  }
}

function readLocalArray(key, normalize) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    const result = []
    for (const item of parsed) {
      const normalized = normalize(item)
      if (!normalized) continue
      const identity = key === STORAGE_KEY ? favoriteKey(normalized) : favoriteRouteKey(normalized)
      if (!identity || seen.has(identity)) continue
      seen.add(identity)
      result.push(normalized)
    }
    return result
  } catch {
    return []
  }
}

function writeLocalArray(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // 私密模式或 quota 不足時僅保留記憶體狀態
  }
}

function readStopFavorites() {
  return readLocalArray(STORAGE_KEY, normalizeStopFavorite)
}

function readRouteFavorites() {
  return readLocalArray(ROUTE_STORAGE_KEY, normalizeRouteFavorite)
}

/**
 * 收藏站點＋收藏路線（localStorage 持久化，支援跨分頁同步）
 *
 * 向下相容：
 * - 站點收藏沿用 `hkb:favorites:v1`（舊資料格式不變，不會被覆寫或清空）。
 * - 路線收藏另存 `hkb:favorite-routes:v1`；舊版 App 只會讀寫站點 key，不會破壞路線收藏。
 * - 讀取時逐筆補預設值／過濾壞資料，JSON 損壞或不是陣列時退回空清單（不 throw）。
 *
 * @returns {{
 *   favoriteStops: Array<object>, favorites: Array<object>, favoriteRoutes: Array<object>,
 *   isFavoriteStop: (stop:object) => boolean, isFavorite: (stop:object) => boolean,
 *   isFavoriteRoute: (route:object) => boolean,
 *   toggleFavoriteStop: (stop:object) => void, toggleFavorite: (stop:object) => void,
 *   toggleFavoriteRoute: (route:object) => void,
 *   removeFavoriteStop: (stop:object) => void, removeFavorite: (stop:object) => void,
 *   removeFavoriteRoute: (route:object) => void,
 *   clearFavoriteStops: () => void, clearFavorites: () => void,
 *   clearFavoriteRoutes: () => void,
 *   count: number, routeCount: number
 * }}
 */
export default function useFavorites() {
  const [stopFavorites, setStopFavorites] = useState(readStopFavorites)
  const [routeFavorites, setRouteFavorites] = useState(readRouteFavorites)

  useEffect(() => {
    const handleStorage = (event) => {
      // event.key 為 null 代表 localStorage.clear()
      if (event.key === STORAGE_KEY || event.key === null) setStopFavorites(readStopFavorites())
      if (event.key === ROUTE_STORAGE_KEY || event.key === null) setRouteFavorites(readRouteFavorites())
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const isFavoriteStop = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      return Boolean(key) && stopFavorites.some((item) => favoriteKey(item) === key)
    },
    [stopFavorites],
  )

  const toggleFavoriteStop = useCallback((stop) => {
    if (!stop?.id) return
    setStopFavorites((prev) => {
      const key = favoriteKey(stop)
      const exists = prev.some((item) => favoriteKey(item) === key)
      const next = exists
        ? prev.filter((item) => favoriteKey(item) !== key)
        : [
            {
              operator: stop.operator,
              id: stop.id,
              nameTc: stop.nameTc ?? '',
              nameEn: stop.nameEn ?? '',
              lat: stop.lat ?? null,
              lng: stop.lng ?? null,
              // 城巴需要路線清單才能查 ETA；九巴需要 siblingIds 才能合併同站月台
              routes: stop.routes ?? [],
              siblingIds: stop.siblingIds ?? [],
              savedAt: Date.now(),
            },
            ...prev,
          ]
      writeLocalArray(STORAGE_KEY, next)
      return next
    })
  }, [])

  const removeFavoriteStop = useCallback((stop) => {
    const key = favoriteKey(stop)
    setStopFavorites((prev) => {
      const next = prev.filter((item) => favoriteKey(item) !== key)
      writeLocalArray(STORAGE_KEY, next)
      return next
    })
  }, [])

  const clearFavoriteStops = useCallback(() => {
    writeLocalArray(STORAGE_KEY, [])
    setStopFavorites([])
  }, [])

  const isFavoriteRoute = useCallback(
    (route) => {
      const key = favoriteRouteKey(route)
      return Boolean(key) && routeFavorites.some((item) => favoriteRouteKey(item) === key)
    },
    [routeFavorites],
  )

  const toggleFavoriteRoute = useCallback((route) => {
    const normalized = normalizeRouteFavorite(route)
    if (!normalized) return
    setRouteFavorites((prev) => {
      const key = favoriteRouteKey(normalized)
      const exists = prev.some((item) => favoriteRouteKey(item) === key)
      const next = exists
        ? prev.filter((item) => favoriteRouteKey(item) !== key)
        : [{ ...normalized, savedAt: Date.now() }, ...prev]
      writeLocalArray(ROUTE_STORAGE_KEY, next)
      return next
    })
  }, [])

  const removeFavoriteRoute = useCallback((route) => {
    const key = favoriteRouteKey(route)
    setRouteFavorites((prev) => {
      const next = prev.filter((item) => favoriteRouteKey(item) !== key)
      writeLocalArray(ROUTE_STORAGE_KEY, next)
      return next
    })
  }, [])

  const clearFavoriteRoutes = useCallback(() => {
    writeLocalArray(ROUTE_STORAGE_KEY, [])
    setRouteFavorites([])
  }, [])

  return {
    favoriteStops: stopFavorites,
    // 舊 API 名稱保留給既有頁面（Nearby／Search／RouteSequence／Favorites）
    favorites: stopFavorites,
    favoriteRoutes: routeFavorites,
    isFavoriteStop,
    isFavorite: isFavoriteStop,
    isFavoriteRoute,
    toggleFavoriteStop,
    toggleFavorite: toggleFavoriteStop,
    toggleFavoriteRoute,
    removeFavoriteStop,
    removeFavorite: removeFavoriteStop,
    removeFavoriteRoute,
    clearFavoriteStops,
    clearFavorites: clearFavoriteStops,
    clearFavoriteRoutes,
    count: stopFavorites.length,
    routeCount: routeFavorites.length,
  }
}
