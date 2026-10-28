/**
 * DATA.GOV.HK API 溝通層
 * ------------------------------------------------------------------
 * 資料來源：
 *   九巴 (KMB)  https://data.etabus.gov.hk/v1/transport/kmb
 *   城巴 (CTB)  https://rt.data.gov.hk/v2/transport/citybus
 *
 * 官方 API 的特性（也是本層存在的原因）：
 *   1. KMB 有「全部站點」清單 (GET /stop)，可直接做座標篩選；
 *      城巴沒有全站點端點，需用 Route-Stop 建立索引（見 scripts/sync-data.mjs）。
 *   2. KMB 的 ETA 是「以站點查全部路線」(GET /stop-eta/{stopId})；
 *      城巴必須「以路線 + 站點」查詢 (GET /eta/CTB/{route}/{stopId})。
 *   3. 兩邊的 ETA API 都沒有票價，票價取自運輸署 ROUTE_BUS.xml 產生的靜態表
 *      (src/data/fares.json)。
 *
 * 本層負責把三種不同形狀的資料合併成 UI 可直接渲染的「單一乾淨陣列」。
 */
import citybusStopIndex from '../data/citybus-stops.json'
import fareTable from '../data/fares.json'

const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb'
const CTB_BASE = 'https://rt.data.gov.hk/v2/transport/citybus'

/** 首頁附近站點的預設搜尋半徑（公尺） */
export const DEFAULT_RADIUS = 500
/** 每條路線最多顯示三班車 */
export const ETA_PER_ROUTE = 3

export const OPERATORS = {
  KMB: { id: 'KMB', code: 'KMB', name: '九巴', fullName: 'Kowloon Motor Bus' },
  CTB: { id: 'CTB', code: 'CTB', name: '城巴', fullName: 'Citybus' },
}

const REQUEST_TIMEOUT = 12000
const CACHE_PREFIX = 'hkb:cache:'
const STOPS_TTL = 12 * 60 * 60 * 1000
const ROUTES_TTL = 12 * 60 * 60 * 1000
const CTB_ETA_CONCURRENCY = 4
const KMB_ETA_CONCURRENCY = 4

export class ApiError extends Error {
  constructor(message, { url, status } = {}) {
    super(message)
    this.name = 'ApiError'
    this.url = url
    this.status = status
  }
}

/* ------------------------------------------------------------------ */
/* 基礎工具                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson(url, { timeout = REQUEST_TIMEOUT } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new ApiError(`伺服器回應 ${response.status}`, { url, status: response.status })
    }
    return await response.json()
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error?.name === 'AbortError') throw new ApiError('連線逾時，請稍後再試', { url })
    throw new ApiError('網絡連線失敗，請檢查連線後再試', { url })
  } finally {
    clearTimeout(timer)
  }
}

/** 以固定併發數執行非同步任務，避免一次打出太多請求 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

const memoryCache = new Map()

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const { expiresAt, value } = JSON.parse(raw)
    if (!expiresAt || expiresAt < Date.now()) return null
    return value
  } catch {
    return null
  }
}

function writeCache(key, value, ttl) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ expiresAt: Date.now() + ttl, value }))
  } catch {
    // 超過 quota 或停用儲存時忽略，記憶體快取仍可運作
  }
}

/** 記憶體 → localStorage → 網絡，三層快取 */
async function withCache(key, ttl, loader) {
  if (memoryCache.has(key)) return memoryCache.get(key)
  const cached = readCache(key)
  if (cached) {
    memoryCache.set(key, cached)
    return cached
  }
  const value = await loader()
  memoryCache.set(key, value)
  writeCache(key, value, ttl)
  return value
}

/** Haversine 公式：兩點間地表距離（公尺） */
export function distanceInMeters(from, to) {
  const EARTH_RADIUS = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

function normalize(text) {
  return String(text ?? '').trim().toUpperCase()
}

/* ------------------------------------------------------------------ */
/* 站點                                                                */
/* ------------------------------------------------------------------ */

/** 九巴全部站點（約 6,700 個，約 1 MB，快取 12 小時） */
export async function getKmbStops() {
  return withCache('kmb-stops', STOPS_TTL, async () => {
    const json = await fetchJson(`${KMB_BASE}/stop`)
    return (json.data ?? [])
      .map((stop) => ({
        operator: 'KMB',
        id: stop.stop,
        nameTc: stop.name_tc,
        nameEn: stop.name_en,
        lat: Number(stop.lat),
        lng: Number(stop.long),
        routes: null,
      }))
      .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
  })
}

let citybusStops = null

/**
 * 城巴站點索引：來自 src/data/citybus-stops.json（由 npm run sync:data 產生）
 * 每筆格式 [stopId, name_tc, name_en, lat, lng, [route...]]
 */
export function getCitybusStops() {
  if (!citybusStops) {
    citybusStops = (citybusStopIndex ?? []).map(([id, nameTc, nameEn, lat, lng, routes]) => ({
      operator: 'CTB',
      id,
      nameTc,
      nameEn,
      lat,
      lng,
      routes: routes ?? [],
    }))
  }
  return citybusStops
}

/** 去掉九巴站名結尾的站牌編號，例如「尖沙咀碼頭,海港城 (YT905)」→「尖沙咀碼頭,海港城」 */
function normalizeStopName(name = '') {
  return String(name).replace(/\s*[(（][A-Z0-9]{2,10}[)）]\s*$/i, '').trim()
}

/** 同業者、同站名且在此範圍內視為同一個車站的不同月台 */
const SAME_STOP_RADIUS = 120
/** 合併月台時最多額外查詢的站牌數量（避免一次打出太多 ETA 請求） */
const MAX_SIBLINGS = 5
/** 合併月台時，時間差小於此值視為同一班車（毫秒） */
const SIBLING_ETA_WINDOW = 60 * 1000

/**
 * 附近站點：以座標篩選半徑內的 KMB + CTB 站點，依距離排序
 * 同一業者、同站名的相鄰站牌（九巴一個總站常有多個月台編號）會合併成一筆，
 * 其餘站牌編號放在 siblingIds，查 ETA 時一併合併顯示。
 * @returns {Promise<Array<{operator:string,id:string,nameTc:string,nameEn:string,lat:number,lng:number,routes:string[]|null,siblingIds:string[],distance:number}>>}
 */
export async function getNearbyStops({ lat, lng, radius = DEFAULT_RADIUS, limit = 12 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError('缺少有效的定位座標')
  }
  const origin = { lat, lng }
  const kmbStops = await getKmbStops()
  const matches = []

  for (const stop of [...kmbStops, ...getCitybusStops()]) {
    const distance = distanceInMeters(origin, stop)
    if (distance <= radius) matches.push({ ...stop, distance })
  }

  matches.sort((a, b) => a.distance - b.distance)

  const picked = []
  for (const stop of matches) {
    const nameTc = normalizeStopName(stop.nameTc)
    const sameStop = picked.find(
      (kept) =>
        kept.operator === stop.operator &&
        kept.nameTc === nameTc &&
        distanceInMeters(kept, stop) <= SAME_STOP_RADIUS,
    )
    if (sameStop) {
      if (sameStop.siblingIds.length < MAX_SIBLINGS) sameStop.siblingIds.push(stop.id)
      continue
    }
    picked.push({
      ...stop,
      nameTc,
      nameEn: normalizeStopName(stop.nameEn),
      siblingIds: [],
    })
    if (picked.length >= limit) break
  }

  return picked
}

/** 取得單一站點的基本資料（城巴用本地索引、九巴用全站點快取） */
export async function getStopInfo(operator, stopId) {
  if (operator === 'CTB') {
    return getCitybusStops().find((stop) => stop.id === stopId) ?? null
  }
  const stops = await getKmbStops()
  return stops.find((stop) => stop.id === stopId) ?? null
}

/* ------------------------------------------------------------------ */
/* 路線                                                                */
/* ------------------------------------------------------------------ */

/**
 * 路線索引（搜尋頁用）：KMB + CTB 的路線號碼、起訖站與方向
 * 城巴官方 Route API 只提供單一方向的起訖站，這裡補上反向，讓 UI 可以雙向切換。
 */
export async function getRouteIndex() {
  return withCache('route-index', ROUTES_TTL, async () => {
    const [kmbResult, ctbResult] = await Promise.allSettled([
      fetchJson(`${KMB_BASE}/route/`),
      fetchJson(`${CTB_BASE}/route/CTB`),
    ])

    const rows = []

    if (kmbResult.status === 'fulfilled') {
      for (const route of kmbResult.value.data ?? []) {
        rows.push({
          operator: 'KMB',
          route: normalize(route.route),
          direction: route.bound === 'I' ? 'inbound' : 'outbound',
          serviceType: String(route.service_type ?? '1'),
          orig: route.orig_tc,
          destination: route.dest_tc,
          origEn: route.orig_en,
          destinationEn: route.dest_en,
        })
      }
    }

    if (ctbResult.status === 'fulfilled') {
      for (const route of ctbResult.value.data ?? []) {
        rows.push({
          operator: 'CTB',
          route: normalize(route.route),
          direction: 'outbound',
          serviceType: '1',
          orig: route.orig_tc,
          destination: route.dest_tc,
          origEn: route.orig_en,
          destinationEn: route.dest_en,
        })
        rows.push({
          operator: 'CTB',
          route: normalize(route.route),
          direction: 'inbound',
          serviceType: '1',
          orig: route.dest_tc,
          destination: route.orig_tc,
          origEn: route.dest_en,
          destinationEn: route.orig_en,
        })
      }
    }

    if (rows.length === 0) {
      const reason = kmbResult.status === 'rejected' ? kmbResult.reason : ctbResult.reason
      throw new ApiError(reason?.message || '無法取得路線清單')
    }

    return rows
  })
}

/**
 * 取得某條路線（含方向）的站序清單，並補上站名／座標
 * @param {{operator:string, route:string, direction?:string, serviceType?:string}} params
 */
export async function getRouteStops({ operator, route, direction = 'outbound', serviceType = '1' }) {
  if (!route) return []
  const routeCode = normalize(route)
  const url =
    operator === 'CTB'
      ? `${CTB_BASE}/route-stop/CTB/${encodeURIComponent(routeCode)}/${direction}`
      : `${KMB_BASE}/route-stop/${encodeURIComponent(routeCode)}/${direction}/${serviceType || '1'}`

  const json = await fetchJson(url)
  const rows = [...(json.data ?? [])].sort((a, b) => Number(a.seq) - Number(b.seq))

  const stopMap = await getStopMap(operator)
  return rows.map((row) => {
    const info = stopMap.get(row.stop)
    return {
      operator,
      id: row.stop,
      seq: Number(row.seq),
      nameTc: info?.nameTc ?? row.stop,
      nameEn: info?.nameEn ?? '',
      lat: info?.lat ?? null,
      lng: info?.lng ?? null,
      routes: info?.routes ?? null,
    }
  })
}

async function getStopMap(operator) {
  if (operator === 'CTB') {
    return new Map(getCitybusStops().map((stop) => [stop.id, stop]))
  }
  try {
    const stops = await getKmbStops()
    return new Map(stops.map((stop) => [stop.id, stop]))
  } catch (error) {
    console.warn('[api] 九巴站點清單讀取失敗，站名將以站點編號顯示', error)
    return new Map()
  }
}

/* ------------------------------------------------------------------ */
/* 票價                                                                */
/* ------------------------------------------------------------------ */

/**
 * 上車收費（HKD）：以「業者 + 路線 + 服務類型」查表
 * 找不到時回傳 null，UI 會顯示「票價待查」而不是錯誤數字。
 */
export function getFare(operator, route, serviceType = '1') {
  const table = fareTable?.operators?.[operator]
  if (!table || !route) return null
  const routeCode = normalize(route)
  const fare = table[`${routeCode}|${serviceType || '1'}`] ?? table[`${routeCode}|1`]
  return Number.isFinite(fare) ? fare : null
}

/** 票價表產生時間（顯示於 UI 的資料來源說明） */
export function getFareUpdatedAt() {
  return fareTable?.generatedAt ?? null
}

/* ------------------------------------------------------------------ */
/* ETA                                                                 */
/* ------------------------------------------------------------------ */

function minutesUntil(iso) {
  if (!iso) return null
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, Math.floor((timestamp - Date.now()) / 60000))
}

function createRouteEntry(operator, row) {
  const serviceType = String(row.service_type ?? '1')
  return {
    operator,
    operatorName: OPERATORS[operator]?.name ?? operator,
    route: normalize(row.route),
    direction: row.dir === 'I' ? 'inbound' : 'outbound',
    serviceType,
    destination: row.dest_tc ?? '',
    destinationEn: row.dest_en ?? '',
    etas: [],
    fare: getFare(operator, row.route, serviceType),
  }
}

function toEta(row) {
  return {
    seq: Number(row.eta_seq ?? 0),
    minutes: minutesUntil(row.eta),
    time: row.eta ?? null,
    remark: row.rmk_tc ?? '',
  }
}

const sortEtaGroups = (a, b) =>
  a.route.localeCompare(b.route, 'en', { numeric: true }) || a.direction.localeCompare(b.direction)

/** 把「一列一班車」的 ETA 回應整理成「一條路線一筆 + 最近三班車」 */
function groupEtaRows(operator, rows) {
  const groups = new Map()

  for (const row of rows) {
    if (!row?.route) continue
    // 同一路線可能有多個 service_type（例如 5C 的 1 與 2），到站時間相同，
    // 這裡只用「路線 + 方向」當 key，避免同一班車重複顯示。
    const key = `${normalize(row.route)}|${row.dir ?? 'O'}`
    if (!groups.has(key)) groups.set(key, createRouteEntry(operator, row))
    const group = groups.get(key)
    if (group.etas.length < ETA_PER_ROUTE) group.etas.push(toEta(row))
  }

  return [...groups.values()]
    .map((entry) => {
      const etas = [...entry.etas].sort((a, b) => a.seq - b.seq).slice(0, ETA_PER_ROUTE)
      const nextMinutes = etas.reduce((min, eta) => {
        if (eta.minutes == null) return min
        return min == null ? eta.minutes : Math.min(min, eta.minutes)
      }, null)
      return { ...entry, etas, nextMinutes }
    })
    .sort(sortEtaGroups)
}

/**
 * 合併多個站牌（月台）的 ETA：同一路線＋方向只留一筆，
 * 到站時間依實際時間排序後取最近三班。
 */
function mergeEtaGroups(groupSets) {
  if (groupSets.length === 1) return groupSets[0]

  const merged = new Map()
  for (const entries of groupSets) {
    for (const entry of entries) {
      const key = `${entry.route}|${entry.direction}|${entry.serviceType}`
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...entry, etas: [...entry.etas] })
        continue
      }
      existing.etas = [...existing.etas, ...entry.etas]
    }
  }

  return [...merged.values()]
    .map((entry) => {
      const timed = [...entry.etas]
        .filter((eta) => eta.time && !Number.isNaN(Date.parse(eta.time)))
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
        // 同一班車可能同時出現在兩個月台（時間差僅數十秒），只保留最早的一筆
        .reduce((kept, eta) => {
          const last = kept[kept.length - 1]
          if (!last) return [eta]
          return Date.parse(eta.time) - Date.parse(last.time) < SIBLING_ETA_WINDOW ? kept : [...kept, eta]
        }, [])

      // 沒有時間的班次（例如「最後班次已過」）排在最後，避免佔用前面的位置
      const untimed = entry.etas.filter((eta) => !eta.time || Number.isNaN(Date.parse(eta.time)))

      const etas = [...timed, ...untimed]
        .slice(0, ETA_PER_ROUTE)
        .map((eta, index) => ({ ...eta, seq: index + 1 }))
      const nextMinutes = etas.reduce((min, eta) => {
        if (eta.minutes == null) return min
        return min == null ? eta.minutes : Math.min(min, eta.minutes)
      }, null)
      return { ...entry, etas, nextMinutes }
    })
    .sort(sortEtaGroups)
}

/** 九巴：以站點查全部路線的 ETA（同一車站的多個月台會合併） */
export async function getKmbStopEtas(stopId, siblingIds = []) {
  const ids = [stopId, ...siblingIds.filter((id) => id && id !== stopId)].slice(0, MAX_SIBLINGS + 1)
  const results = await mapWithConcurrency(ids, KMB_ETA_CONCURRENCY, async (id) => {
    try {
      const json = await fetchJson(`${KMB_BASE}/stop-eta/${encodeURIComponent(id)}`)
      return groupEtaRows('KMB', json.data ?? [])
    } catch (error) {
      if (ids.length === 1) throw error
      console.warn(`[api] 九巴站點 ${id} 讀取失敗：${error.message}`)
      return []
    }
  })

  return mergeEtaGroups(results)
}

/**
 * 城巴：必須逐條路線查詢，因此需要「該站點經過的路線」清單
 * （來源：src/data/citybus-stops.json，或搜尋頁已知的路線）
 */
export async function getCitybusStopEtas(stopId, routes = []) {
  const routeCodes = [...new Set(routes.map((route) => normalize(route)).filter(Boolean))].slice(0, 8)
  if (routeCodes.length === 0) {
    throw new ApiError('此城巴站點缺少路線資料，請重新同步站點資料')
  }

  const results = await mapWithConcurrency(routeCodes, CTB_ETA_CONCURRENCY, async (route) => {
    try {
      const json = await fetchJson(
        `${CTB_BASE}/eta/CTB/${encodeURIComponent(route)}/${encodeURIComponent(stopId)}`,
      )
      return json.data ?? []
    } catch (error) {
      console.warn(`[api] 城巴 ${route} @ ${stopId} 讀取失敗：${error.message}`)
      return []
    }
  })

  return groupEtaRows('CTB', results.flat())
}

/**
 * 統一入口：依業者呼叫對應的 ETA API
 * @param {{operator:string,id:string,routes?:string[],siblingIds?:string[]}} stop
 */
export async function getStopEtas(stop) {
  if (!stop?.id) return []
  if (stop.operator === 'CTB') {
    const routes = stop.routes?.length ? stop.routes : (await getStopInfo('CTB', stop.id))?.routes
    return getCitybusStopEtas(stop.id, routes ?? [])
  }
  return getKmbStopEtas(stop.id, stop.siblingIds ?? [])
}

/** 依路線過濾（搜尋頁只顯示被選中的那條路線） */
export function filterByRoute(entries, route) {
  if (!route) return entries
  const target = normalize(route)
  return entries.filter((entry) => entry.route === target)
}

