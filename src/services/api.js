/**
 * DATA.GOV.HK API 溝通層
 * ------------------------------------------------------------------
 * 資料來源：
 *   九巴 (KMB)  https://data.etabus.gov.hk/v1/transport/kmb
 *   城巴 (CTB)  https://rt.data.gov.hk/v2/transport/citybus
 *   專線小巴 (GMB) https://data.etagmb.gov.hk
 *
 * 官方 API 的特性（也是本層存在的原因）：
 *   1. KMB 有「全部站點」清單 (GET /stop)，可直接做座標篩選；
 *      城巴與小巴沒有全站點端點，需用 Route-Stop 建立索引（見 scripts/sync-data.mjs）。
 *   2. KMB 的 ETA 是「以站點查全部路線」(GET /stop-eta/{stopId})；
 *      小巴同樣有站點層級端點 (GET /eta/stop/{stopId})；
 *      城巴只能「以路線 + 站點」查詢 (GET /eta/CTB/{route}/{stopId})。
 *   3. 三邊的 ETA API 都沒有票價，票價取自運輸署 ROUTE_BUS.xml 產生的靜態表
 *      (src/data/fares.json)；小巴不在該份 xml 內，因此票價顯示「票價待查」。
 *   4. 小巴 ETA 只回傳 route_id / route_seq，路線號碼與目的地需要靠
 *      public/data/gmb-routes.json（sync:data 產生）對照。
 *
 * 本層負責把三種不同形狀的資料合併成 UI 可直接渲染的「單一乾淨陣列」。
 */
import fareTable from '../data/fares.json'
import { formatClock } from '../utils/format.js'
import { loadStaticData } from './staticData.js'

const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb'
const CTB_BASE = 'https://rt.data.gov.hk/v2/transport/citybus'
const GMB_BASE = 'https://data.etagmb.gov.hk'

/** 首頁附近站點的搜尋半徑（公尺）：固定 500，不開放使用者調整 */
export const DEFAULT_RADIUS = 500
/** 每條路線最多顯示三班車 */
export const ETA_PER_ROUTE = 3

export const OPERATORS = {
  KMB: { id: 'KMB', code: 'KMB', name: '九巴', fullName: 'Kowloon Motor Bus' },
  CTB: { id: 'CTB', code: 'CTB', name: '城巴', fullName: 'Citybus' },
  GMB: { id: 'GMB', code: 'GMB', name: '專線小巴', fullName: 'Green Minibus' },
}

const REQUEST_TIMEOUT = 12000
const CACHE_PREFIX = 'hkb:cache:'
const STOPS_TTL = 12 * 60 * 60 * 1000
const ROUTES_TTL = 12 * 60 * 60 * 1000
const CTB_ETA_CONCURRENCY = 4
const KMB_ETA_CONCURRENCY = 4
const GMB_ETA_CONCURRENCY = 4

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
/** 進行中的 loader：同一 key 併發呼叫時共用同一個 Promise，避免重複網絡請求 */
const inFlightCache = new Map()

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

/** 記憶體 → localStorage → 網絡，三層快取（同一 key 併發呼叫只載入一次） */
async function withCache(key, ttl, loader) {
  if (memoryCache.has(key)) return memoryCache.get(key)
  const cached = readCache(key)
  if (cached) {
    memoryCache.set(key, cached)
    return cached
  }
  if (inFlightCache.has(key)) return inFlightCache.get(key)

  // 包一層 Promise 記錄進行中請求；失敗時清掉記錄，讓下次呼叫可以重試
  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      memoryCache.set(key, value)
      writeCache(key, value, ttl)
      return value
    })
    .finally(() => {
      inFlightCache.delete(key)
    })
  inFlightCache.set(key, pending)
  return pending
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

/** 站點索引載入器（同一業者只載入一次，JS 端再做一層記憶體快取） */
const staticStopLoaders = {
  CTB: () =>
    loadStaticData('citybus-stops.json').then((rows) =>
      (rows ?? []).map(([id, nameTc, nameEn, lat, lng, routes]) => ({
        operator: 'CTB',
        id,
        nameTc,
        nameEn,
        lat,
        lng,
        routes: routes ?? [],
      })),
    ),
  GMB: () =>
    loadStaticData('gmb-stops.json').then((rows) =>
      (rows ?? []).map(([id, nameTc, nameEn, lat, lng, routes]) => ({
        operator: 'GMB',
        id,
        nameTc,
        nameEn,
        lat,
        lng,
        routes: routes ?? [],
      })),
    ),
}

const stopIndexPromises = new Map()

/**
 * 城巴／小巴站點索引：來自 public/data/*.json（由 npm run sync:data 產生）
 * 每筆格式 [stopId, name_tc, name_en, lat, lng, [route...]]
 */
export function getStaticStops(operator) {
  const loader = staticStopLoaders[operator]
  if (!loader) return Promise.resolve([])
  if (!stopIndexPromises.has(operator)) {
    stopIndexPromises.set(
      operator,
      loader().catch((error) => {
        // 載入失敗時清掉 promise，下次呼叫可以重試
        stopIndexPromises.delete(operator)
        throw error
      }),
    )
  }
  return stopIndexPromises.get(operator)
}

/** 城巴站點索引（非同步：改由 public/data 延遲載入，避免拖慢首次渲染） */
export function getCitybusStops() {
  return getStaticStops('CTB')
}

/** 專線小巴站點索引（非同步，同上） */
export function getGmbStops() {
  return getStaticStops('GMB')
}

/** 小巴路線對照表：route_id + route_seq → 路線號碼／方向／目的地 */
let gmbRouteMetaPromise = null

/**
 * 小巴路線對照表（public/data/gmb-routes.json）
 * 每筆格式 [route_id, route_seq, route_code, region, orig_tc, dest_tc, orig_en, dest_en]
 * @returns {Promise<Array<{routeId:number,routeSeq:number,route:string,region:string,origTc:string,destTc:string,origEn:string,destEn:string,direction:'inbound'|'outbound'}>>}
 */
export function getGmbRouteMeta() {
  if (!gmbRouteMetaPromise) {
    gmbRouteMetaPromise = loadStaticData('gmb-routes.json')
      .then((rows) =>
        (rows ?? []).map(([routeId, routeSeq, route, region, origTc, destTc, origEn, destEn]) => ({
          routeId,
          routeSeq,
          route,
          region,
          origTc,
          destTc,
          origEn,
          destEn,
          direction: Number(routeSeq) === 2 ? 'inbound' : 'outbound',
        })),
      )
      .catch((error) => {
        gmbRouteMetaPromise = null
        throw error
      })
  }
  return gmbRouteMetaPromise
}

/** 去掉九巴站名結尾的站牌編號，例如「尖沙咀碼頭,海港城 (YT905)」→「尖沙咀碼頭,海港城」 */
function normalizeStopName(name = '') {
  return String(name).replace(/\s*[(（][A-Z0-9]{2,10}[)）]\s*$/i, '').trim()
}

/**
 * 從同一路線的站序清單找出「同名且相距 ≤ SAME_STOP_RADIUS」的月台。
 *
 * 循環線（例如 26M）的同一站名會在站序出現兩次（順天總站 seq8／seq18，兩個站牌相距約 13 公尺），
 * 站序頁展開這類站點時要一起查同日同名月台，才能依 ETA 站序拆出「去程／回程」方向。
 * 只處理重複出現的站名，其餘站點維持單一月台請求，避免每展開一站就多打數個 API。
 *
 * @param {Array<{id:string,nameTc?:string,nameEn?:string,lat?:number|null,lng?:number|null}>} stops
 *        getRouteStops() 的結果
 * @returns {Map<string, string[]>} 站點 ID → 其他月台 ID（最多 MAX_SIBLINGS 個）
 */
export function findSiblingStopIds(stops = []) {
  const map = new Map()
  if (!stops?.length) return map

  const nameOf = (stop) => normalizeStopName(stop.nameTc || stop.nameEn || '')
  const nameCounts = new Map()
  for (const stop of stops) {
    const name = nameOf(stop)
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  for (const stop of stops) {
    const name = nameOf(stop)
    if (!name || (nameCounts.get(name) ?? 0) < 2) continue
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue
    const siblingIds = stops
      .filter(
        (other) =>
          other.id !== stop.id &&
          nameOf(other) === name &&
          Number.isFinite(other.lat) &&
          Number.isFinite(other.lng) &&
          distanceInMeters(stop, other) <= SAME_STOP_RADIUS,
      )
      .map((other) => other.id)
      .slice(0, MAX_SIBLINGS)
    if (siblingIds.length > 0) map.set(String(stop.id), siblingIds)
  }
  return map
}

/**
 * 同業者、同站名且在此範圍內視為同一個車站的不同月台（公尺）。
 * 站序頁（RouteSequence）也用它判斷循環線同一站名出現兩次時要合併哪些月台。
 */
const SAME_STOP_RADIUS = 120
/** 合併月台時最多額外查詢的站牌數量（避免一次打出太多 ETA 請求） */
const MAX_SIBLINGS = 5

/**
 * 附近站點：以座標篩選 500 公尺內（固定半徑，見 DEFAULT_RADIUS）的 KMB + CTB + GMB 站點，依距離排序
 * 同一業者、同站名的相鄰站牌（九巴一個總站常有多個月台編號）會合併成一筆，
 * 其餘站牌編號放在 siblingIds，查 ETA 時一併合併顯示。
 * @returns {Promise<Array<{operator:string,id:string,nameTc:string,nameEn:string,lat:number,lng:number,routes:string[]|null,siblingIds:string[],distance:number}>>}
 */
export async function getNearbyStops({ lat, lng, limit = 12 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError('缺少有效的定位座標')
  }
  const origin = { lat, lng }
  const [kmbResult, ctbResult, gmbResult] = await Promise.allSettled([
    getKmbStops(),
    getCitybusStops(),
    getGmbStops(),
  ])

  if (kmbResult.status === 'rejected' && ctbResult.status === 'rejected' && gmbResult.status === 'rejected') {
    throw new ApiError(kmbResult.reason?.message || '無法取得站點資料')
  }
  if (ctbResult.status === 'rejected') {
    console.warn('[api] 城巴站點索引載入失敗，附近站點只顯示其他業者', ctbResult.reason)
  }
  if (gmbResult.status === 'rejected') {
    console.warn('[api] 小巴站點索引載入失敗，附近站點只顯示其他業者', gmbResult.reason)
  }

  const allStops = [
    ...(kmbResult.status === 'fulfilled' ? kmbResult.value : []),
    ...(ctbResult.status === 'fulfilled' ? ctbResult.value : []),
    ...(gmbResult.status === 'fulfilled' ? gmbResult.value : []),
  ]

  const matches = []
  for (const stop of allStops) {
    const distance = distanceInMeters(origin, stop)
    if (distance <= DEFAULT_RADIUS) matches.push({ ...stop, distance })
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

/** 取得單一站點的基本資料（城巴／小巴用本地索引、九巴用全站點快取） */
export async function getStopInfo(operator, stopId) {
  if (operator === 'CTB') {
    const stops = await getCitybusStops()
    return stops.find((stop) => stop.id === stopId) ?? null
  }
  if (operator === 'GMB') {
    const stops = await getGmbStops()
    return stops.find((stop) => stop.id === stopId) ?? null
  }
  const stops = await getKmbStops()
  return stops.find((stop) => stop.id === stopId) ?? null
}

/* ------------------------------------------------------------------ */
/* 路線                                                                */
/* ------------------------------------------------------------------ */

/**
 * 路線索引（搜尋頁用）：KMB + CTB + GMB 的路線號碼、起訖站與方向
 * 城巴官方 Route API 只提供單一方向的起訖站，這裡補上反向，讓 UI 可以雙向切換。
 * 小巴的路線資料來自 public/data/gmb-routes.json（sync:data 產生）。
 */
export async function getRouteIndex() {
  return withCache('route-index-v2', ROUTES_TTL, async () => {
    const [kmbResult, ctbResult, gmbResult] = await Promise.allSettled([
      fetchJson(`${KMB_BASE}/route/`),
      fetchJson(`${CTB_BASE}/route/CTB`),
      getGmbRouteMeta(),
    ])

    const rows = []

    if (kmbResult.status === 'fulfilled') {
      for (const route of kmbResult.value.data ?? []) {
        const direction = route.bound === 'I' ? 'inbound' : 'outbound'
        const serviceType = String(route.service_type ?? '1')
        rows.push({
          id: `KMB-${normalize(route.route)}-${direction}-${serviceType}`,
          operator: 'KMB',
          route: normalize(route.route),
          direction,
          serviceType,
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
          id: `CTB-${normalize(route.route)}-outbound`,
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
          id: `CTB-${normalize(route.route)}-inbound`,
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

    if (gmbResult.status === 'fulfilled') {
      for (const meta of gmbResult.value) {
        rows.push({
          // 小巴同一路線號碼可能有多個 route_id（不同班次描述），用 route_id + route_seq 當唯一鍵
          id: `GMB-${meta.routeId}-${meta.routeSeq}`,
          operator: 'GMB',
          route: normalize(meta.route),
          direction: meta.direction,
          serviceType: '1',
          routeId: meta.routeId,
          routeSeq: meta.routeSeq,
          orig: meta.origTc,
          destination: meta.destTc,
          origEn: meta.origEn,
          destinationEn: meta.destEn,
        })
      }
    } else {
      console.warn('[api] 小巴路線索引載入失敗，搜尋結果不含小巴', gmbResult.reason)
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
 * @param {{operator:string, route:string, direction?:string, serviceType?:string, routeId?:number, routeSeq?:number}} params
 */
export async function getRouteStops({ operator, route, direction = 'outbound', serviceType = '1', routeId, routeSeq }) {
  if (!route) return []

  if (operator === 'GMB') {
    if (!routeId || !routeSeq) throw new ApiError('缺少小巴路線資料，請重新整理後再試')
    const json = await fetchJson(`${GMB_BASE}/route-stop/${routeId}/${routeSeq}`)
    const stopMap = await getStopMap('GMB')
    return [...(json.data?.route_stops ?? [])]
      .sort((a, b) => Number(a.stop_seq) - Number(b.stop_seq))
      .map((row) => {
        const info = stopMap.get(String(row.stop_id))
        return {
          operator,
          id: String(row.stop_id),
          seq: Number(row.stop_seq),
          nameTc: row.name_tc ?? info?.nameTc ?? String(row.stop_id),
          nameEn: row.name_en ?? info?.nameEn ?? '',
          lat: info?.lat ?? null,
          lng: info?.lng ?? null,
          routes: info?.routes ?? [normalize(route)],
        }
      })
  }

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

/* ------------------------------------------------------------------ */
/* 路線卡排序：剩餘距離                                                 */
/* ------------------------------------------------------------------ */

/** 計算剩餘距離時，最多同時抓幾條路線的站序（避免一次打爆官方 API） */
const ROUTE_PROGRESS_CONCURRENCY = 6
/** 單一條路線站序最多等多久（毫秒）；逾時就少了該卡的剩餘距離，退回以到站時間排序 */
const ROUTE_PROGRESS_TIMEOUT = 6000
/** 整批剩餘距離最多算多久（毫秒）；繁忙站點（例如城巴一站 25 條路線）不要無限拖下去 */
const ROUTE_PROGRESS_TOTAL_TIMEOUT = 8000

/**
 * 路線站序快取（含座標）：剩餘距離排序需要「目前站序 → 路線終點」的完整站序。
 * 站序不常變動，同一次瀏覽工作階段只抓一次；30 秒 ETA 輪詢時可直接重用。
 */
const routeStopsCache = new Map()

function withTimeout(promise, timeout) {
  let timer = null
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new ApiError('讀取路線站序逾時')), timeout)
    promise.then(resolve, reject)
  }).finally(() => clearTimeout(timer))
}

/** 取得某路線卡的站序（快取；失敗回傳 null，讓路線卡退回以到站時間排序） */
function getCachedRouteStops(entry) {
  const key =
    entry.operator === 'GMB'
      ? `GMB|${entry.routeId}|${entry.routeSeq}`
      : `${entry.operator}|${entry.route}|${entry.direction}|${entry.serviceType}`
  if (!routeStopsCache.has(key)) {
    const pending = withTimeout(
      getRouteStops({
        operator: entry.operator,
        route: entry.route,
        direction: entry.direction,
        serviceType: entry.serviceType,
        routeId: entry.routeId,
        routeSeq: entry.routeSeq,
      }),
      ROUTE_PROGRESS_TIMEOUT,
    ).catch((error) => {
      // 失敗不留在快取，讓下一次輪詢有機會重試
      routeStopsCache.delete(key)
      console.warn(`[api] 路線 ${entry.route} 站序讀取失敗，改以到站時間排序：${error.message}`)
      return null
    })
    routeStopsCache.set(key, pending)
  }
  return routeStopsCache.get(key)
}

/**
 * 計算路線卡在「目前站點」的剩餘站數／剩餘距離（公尺），供路線卡由長途到短途排序。
 * - 以 ETA 的 `stopSeq` 對應 route-stop 的 `seq`；循環線同一站名會出現兩次，必須用站序分辨
 * - 找不到站序時退回以站點 id 比對（月台合併時 ETA 可能來自其他站牌）
 * - 回傳 null 代表資料不足，呼叫端維持原本的到站時間排序
 * @returns {Promise<{remainingStops:number, remainingDistance:number|null, isTerminus:boolean}|null>}
 */
async function getRouteProgress(entry, stop) {
  const stopSeq = entry.etas?.find((eta) => Number.isFinite(eta.stopSeq))?.stopSeq
  if (!Number.isFinite(stopSeq)) return null

  const stops = await getCachedRouteStops(entry)
  if (!Array.isArray(stops) || stops.length === 0) return null

  let index = stops.findIndex((row) => Number(row.seq) === Number(stopSeq))
  if (index < 0 && stop?.id != null) {
    index = stops.findIndex((row) => String(row.id) === String(stop.id))
  }
  if (index < 0) return null

  const remainingStops = stops.length - 1 - index

  // 沿線站距加總；任何一段缺座標就退回「剩餘站數」作為排序依據
  let remainingDistance = 0
  for (let i = index; i < stops.length - 1; i += 1) {
    const from = stops[i]
    const to = stops[i + 1]
    const hasCoords =
      Number.isFinite(from?.lat) &&
      Number.isFinite(from?.lng) &&
      Number.isFinite(to?.lat) &&
      Number.isFinite(to?.lng)
    if (!hasCoords) {
      remainingDistance = null
      break
    }
    remainingDistance += distanceInMeters(from, to)
  }

  return {
    remainingStops,
    remainingDistance: Number.isFinite(remainingDistance) ? Math.round(remainingDistance) : null,
    isTerminus: remainingStops === 0,
  }
}

/**
 * 為一批「站點 ETA 群組」補上各路線的剩餘距離進度（供 StopSection 排序）。
 *
 * 這個函式會抓取各路線的站序，慢的時候可能要好幾秒；`useBusData` 先顯示 ETA、
 * 再於背景呼叫本函式補上 progress，避免展開站點時卡在 loading。
 * 個別路線讀取失敗或逾時只會少了該卡的 progress，不影響 ETA 顯示。
 *
 * @param {Array<{stop:object, routes:Array}>} groups
 * @returns {Promise<Array>} 與輸入同形狀（routes 內的 entry 可能多了 progress 欄位）
 */
export async function attachRouteProgress(groups) {
  const entries = []
  for (const group of groups) {
    for (const entry of group.routes ?? []) entries.push({ group, entry })
  }
  if (entries.length === 0) return groups

  const progressByEntry = new Map()
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ROUTE_PROGRESS_TOTAL_TIMEOUT)
  })
  try {
    await Promise.race([
      mapWithConcurrency(entries, ROUTE_PROGRESS_CONCURRENCY, async ({ group, entry }) => {
        try {
          const progress = await getRouteProgress(entry, group.stop)
          if (progress) progressByEntry.set(entry, progress)
        } catch (error) {
          console.warn(`[api] 計算路線 ${entry.route} 剩餘距離失敗，改以到站時間排序：${error.message}`)
        }
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }

  return groups.map((group) => ({
    ...group,
    routes: (group.routes ?? []).map((entry) => {
      const progress = progressByEntry.get(entry)
      return progress ? { ...entry, progress } : entry
    }),
  }))
}

async function getStopMap(operator) {
  if (operator === 'CTB' || operator === 'GMB') {
    try {
      const stops = operator === 'CTB' ? await getCitybusStops() : await getGmbStops()
      return new Map(stops.map((stop) => [stop.id, stop]))
    } catch (error) {
      console.warn('[api] 站點索引載入失敗，站名將以 API 回傳值顯示', error)
      return new Map()
    }
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
  const stopSeq = Number(row.seq ?? row.stop_seq)
  return {
    seq: Number(row.eta_seq ?? 0),
    // 站序（route sequence）：合併多個月台去重時，用來優先保留目標站牌的班次，
    // 也是循環線判斷「同一站名的兩次經過」的依據
    stopSeq: Number.isFinite(stopSeq) ? stopSeq : null,
    // 服務類型：循環線拆分時只認「同一 service_type 內」的兩個站序，
    // 避免特別班次（同一目的地但站序偏移 1～2 站）被誤拆成兩個方向
    serviceType: String(row.service_type ?? '1'),
    minutes: minutesUntil(row.eta),
    time: row.eta ?? null,
    remark: row.rmk_tc ?? '',
  }
}

/**
 * 目的地分組用的 key：忽略尾端「(循環線)」標記與多餘空白，
 * 避免同一終點因 service_type 的寫法不同（例如「觀塘 (apm)」與「觀塘 (apm) (循環線)」）
 * 被拆成兩張時間完全相同的卡片。顯示仍使用原始的 dest_tc。
 */
function destinationKey(destination) {
  return String(destination ?? '')
    .replace(/\s*[（(]\s*循環線\s*[)）]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const sortEtaGroups = (a, b) =>
  a.route.localeCompare(b.route, 'en', { numeric: true }) ||
  a.direction.localeCompare(b.direction) ||
  String(a.destination ?? '').localeCompare(String(b.destination ?? ''), 'zh-Hant')

/** 補上 nextMinutes（最近一班車的剩餘分鐘），供 UI 排序 */
function withNextMinutes(entry) {
  const nextMinutes = entry.etas.reduce((min, eta) => {
    if (eta.minutes == null) return min
    return min == null ? eta.minutes : Math.min(min, eta.minutes)
  }, null)
  return { ...entry, nextMinutes }
}

/**
 * 把「一列一班車」的 ETA 回應整理成「一條路線（＋目的地）一筆」。
 *
 * key 用「路線 + 方向 + 目的地」：同一站點同一路線可能出現不同目的地的班次
 * （例如 13M 的特別班次往觀塘站、循環線去程往觀塘／回程往彩虹），
 * 必須分開成不同卡片，否則會把往相反方向的班次混在同一組時間內。
 *
 * `finalize: false` 時只收集、不排序取三班（九巴需要先合併月台與拆循環線的
 * 兩次經過，最後才截取最近三班，否則同一站牌去程／回程班次會被提前截斷）。
 *
 * @param {string} operator
 * @param {Array} rows
 * @param {number|null} [targetSeq]
 * @param {{finalize?: boolean}} [options]
 */
function groupEtaRows(operator, rows, targetSeq = null, { finalize = true } = {}) {
  const groups = new Map()

  for (const row of rows) {
    if (!row?.route) continue
    // 同一路線可能有多個 service_type（例如 5C 的 1 與 2），到站時間相同；
    // 目的地相同（忽略「(循環線)」寫法差異）時仍合併，同一班車交由 normalizeEtaList 去重。
    const key = `${normalize(row.route)}|${row.dir ?? 'O'}|${destinationKey(row.dest_tc)}`
    if (!groups.has(key)) groups.set(key, createRouteEntry(operator, row))
    groups.get(key).etas.push(toEta(row))
  }

  const entries = [...groups.values()]
  return finalize ? finishEtaGroups(entries, targetSeq) : entries
}

/** 兩筆 ETA 視為同一班車的最大時間差（毫秒） */
const DUPLICATE_ETA_WINDOW = 45 * 1000

/**
 * 判斷相鄰兩筆 ETA 是否為同一班車：
 *   1. 時間戳相差小於 45 秒（不同 seq／service_type／GPS 秒差造成的重複）
 *   2. 格式化後的 HH:mm 與剩餘 minutes 完全相同
 */
function isDuplicateEta(prev, next) {
  const prevTime = Date.parse(prev.time)
  const nextTime = Date.parse(next.time)
  if (!Number.isFinite(prevTime) || !Number.isFinite(nextTime)) return false
  if (Math.abs(nextTime - prevTime) < DUPLICATE_ETA_WINDOW) return true
  return formatClock(prev.time) === formatClock(next.time) && prev.minutes === next.minutes
}

/** 重複班次中該保留哪一筆：目標站序優先，其次保留有備註（例如「最後班次」）的那筆 */
function isPreferredEta(candidate, current, targetSeq) {
  if (
    targetSeq != null &&
    Number(candidate.stopSeq) === Number(targetSeq) &&
    Number(current.stopSeq) !== Number(targetSeq)
  ) {
    return true
  }
  return Boolean(candidate.remark) && !current.remark
}

/**
 * 整理單一路線方向的 ETA：依實際到站時間排序 → 去重 → 取最近三班 → 重新編號。
 *
 * 去重時若呼叫端有傳入目標站序（targetSeq），優先保留 stopSeq 與目標相符的班次，
 * 確保合併多月台時顯示的是「查詢的那個站牌」的資料，前三個班次不會出現兩個相同時間。
 *
 * @param {Array} input
 * @param {number|null} [targetSeq]
 */
function normalizeEtaList(input, targetSeq = null) {
  const timed = []
  const untimed = []
  for (const eta of input) {
    if (eta.time && !Number.isNaN(Date.parse(eta.time))) timed.push(eta)
    else untimed.push(eta)
  }
  timed.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.seq - b.seq)

  const deduped = []
  for (const eta of timed) {
    const prev = deduped[deduped.length - 1]
    if (prev && isDuplicateEta(prev, eta)) {
      if (isPreferredEta(eta, prev, targetSeq)) deduped[deduped.length - 1] = eta
      continue
    }
    deduped.push(eta)
  }

  return [...deduped, ...untimed]
    .slice(0, ETA_PER_ROUTE)
    .map((eta, index) => ({ ...eta, seq: index + 1 }))
}

/** 為每組 ETA 排序、去重並只保留最近三班 */
function finishEtaGroups(entries, targetSeq = null) {
  return entries
    .map((entry) => withNextMinutes({ ...entry, etas: normalizeEtaList(entry.etas, targetSeq) }))
    .sort(sortEtaGroups)
}

/**
 * 合併多個站牌（月台）的 ETA：同一路線＋方向＋目的地只留一筆。
 *
 * 這裡只做合併、不排序取三班；交由呼叫端呼叫 finishEtaGroups。
 * 九巴循環線需要在「取最近三班」之前，先依 ETA 的站序把同一站名的兩次經過拆開。
 */
function mergeEtaGroups(groupSets) {
  if (groupSets.length === 1) return groupSets[0]

  const merged = new Map()
  for (const entries of groupSets) {
    for (const entry of entries) {
      // 同一目的地即使 service_type 不同（例如特別班次）仍合併，
      // 與 groupEtaRows 的分組規則一致；服務類型差異交給 UI 的特別班次標籤
      const key = `${entry.route}|${entry.direction}|${destinationKey(entry.destination)}`
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...entry, etas: [...entry.etas] })
        continue
      }
      existing.etas = [...existing.etas, ...entry.etas]
    }
  }

  return [...merged.values()]
}

/* ------------------------------------------------------------------ */
/* 循環線：同一站名的去程／回程                                        */
/* ------------------------------------------------------------------ */

/** 九巴路線基本資料快取（只為循環線回程取得起點站名，避免重複請求） */
const kmbRouteInfoCache = new Map()

function getKmbRouteInfo(route, direction, serviceType = '1') {
  const key = `${route}|${direction}|${serviceType}`
  if (!kmbRouteInfoCache.has(key)) {
    const promise = fetchJson(
      `${KMB_BASE}/route/${encodeURIComponent(route)}/${direction}/${encodeURIComponent(serviceType)}`,
      { timeout: 6000 },
    )
      .then((json) => json.data ?? null)
      // 暫時性失敗不要留在快取，讓下一次輪詢可以重試（成功結果才長期快取）
      .catch(() => {
        kmbRouteInfoCache.delete(key)
        return null
      })
    kmbRouteInfoCache.set(key, promise)
  }
  return kmbRouteInfoCache.get(key)
}

/** 九巴路線站序快取（只取站序號碼）：循環線拆分時用來確認兩次經過的位置 */
const kmbRouteSeqsCache = new Map()

function getKmbRouteSeqs(route, direction, serviceType = '1') {
  const key = `${route}|${direction}|${serviceType}`
  if (!kmbRouteSeqsCache.has(key)) {
    const promise = fetchJson(
      `${KMB_BASE}/route-stop/${encodeURIComponent(route)}/${direction}/${encodeURIComponent(serviceType)}`,
      { timeout: 6000 },
    )
      .then((json) =>
        (json.data ?? [])
          .map((row) => Number(row.seq))
          .filter(Number.isFinite)
          .sort((a, b) => a - b),
      )
      .catch(() => {
        kmbRouteSeqsCache.delete(key)
        return null
      })
    kmbRouteSeqsCache.set(key, promise)
  }
  return kmbRouteSeqsCache.get(key)
}

/**
 * 循環線（例如 26M）的同一站名會在路線中出現兩次，並被合併成同一個站點群組：
 * 順天總站去程往觀塘（seq 8）、回程往彩虹（seq 18），但官方 stop-eta 兩次都回
 * dest_tc「觀塘(循環線)」，無法單靠 dest 分辨。這裡用 ETA 的站序（stopSeq）拆成兩組：
 * 站序較前的一組維持官方目的地，較後的一組（回程）以路線起點（orig_tc）作目的地標示。
 *
 * 為避免誤拆（尤其同一目的地的特別班次對同一站牌可能有 1～2 站的站序偏移），必須同時滿足：
 *   1. 目的地含「循環」、ETA 有站序、且所有班次屬同一個 service_type；
 *   2. 該 service_type 內恰好兩個站序；
 *   3. 用 /route-stop 站序清單驗證：一個站在路線前半、一個在後半，且相距至少 1/3 條路線
 *      （排除 78A 皇后山總站這類末段折返兩次經過的誤判）。
 * 任何一項不成立、或取不到路線資料／起點時，保持原狀（寧可少拆，不可標錯方向）。
 */
async function splitCircularPasses(entries) {
  const result = []
  for (const entry of entries) {
    const seqs = new Set(entry.etas.map((eta) => eta.stopSeq).filter(Number.isFinite))
    const serviceTypes = new Set(entry.etas.map((eta) => eta.serviceType ?? entry.serviceType))
    const canSplit =
      String(entry.destination ?? '').includes('循環') &&
      seqs.size === 2 &&
      serviceTypes.size === 1 &&
      entry.etas.every((eta) => Number.isFinite(eta.stopSeq))
    if (!canSplit) {
      result.push(entry)
      continue
    }

    const [firstSeq, lastSeq] = [...seqs].sort((a, b) => a - b)
    const routeSeqs = await getKmbRouteSeqs(entry.route, entry.direction, entry.serviceType)
    const total = routeSeqs?.length ? routeSeqs[routeSeqs.length - 1] : 0
    const oppositePass =
      total >= 6 &&
      routeSeqs.includes(firstSeq) &&
      routeSeqs.includes(lastSeq) &&
      firstSeq < total / 2 &&
      lastSeq > total / 2 &&
      lastSeq - firstSeq >= total / 3
    if (!oppositePass) {
      result.push(entry)
      continue
    }

    const info = await getKmbRouteInfo(entry.route, entry.direction, entry.serviceType)
    const orig = String(info?.orig_tc ?? '').trim()
    if (!orig) {
      result.push(entry)
      continue
    }

    const towardDestination = entry.etas.filter((eta) => eta.stopSeq === firstSeq)
    const towardOrigin = entry.etas.filter((eta) => eta.stopSeq === lastSeq)
    if (towardDestination.length === 0 || towardOrigin.length === 0) {
      result.push(entry)
      continue
    }

    result.push(
      { ...entry, etas: towardDestination },
      {
        ...entry,
        // 回程顯示「往 起點」作方向提示；站序頁標題仍用官方終點（routeDestination）
        destination: orig,
        destinationEn: info.orig_en ?? '',
        routeDestination: entry.destination,
        etas: towardOrigin,
      },
    )
  }
  return result
}

/**
 * 拆分循環線後，回程目的地可能與同站同方向、另一個 service_type 的終點相同
 * （例如 78A：回程往皇后山，剛好另一個 variant 的目的地也是皇后山），
 * 這時要再合併一次同目的地群組，避免出現兩張一模一樣的卡片。
 */
function mergeSameDestination(entries) {
  const merged = new Map()
  for (const entry of entries) {
    const key = `${entry.route}|${entry.direction}|${destinationKey(entry.destination)}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...entry, etas: [...entry.etas] })
      continue
    }
    existing.etas = [...existing.etas, ...entry.etas]
    existing.routeDestination = existing.routeDestination ?? entry.routeDestination
  }
  return [...merged.values()]
}

/** 九巴：以站點查全部路線的 ETA（同一車站的多個月台會合併） */
export async function getKmbStopEtas(stopId, siblingIds = [], targetSeq = null) {
  const ids = [stopId, ...siblingIds.filter((id) => id && id !== stopId)].slice(0, MAX_SIBLINGS + 1)
  const results = await mapWithConcurrency(ids, KMB_ETA_CONCURRENCY, async (id) => {
    try {
      const json = await fetchJson(`${KMB_BASE}/stop-eta/${encodeURIComponent(id)}`)
      // 先只收集原始班次；合併月台＋拆循環線之後才排序取三班（見 getKmbStopEtas 尾段）
      return groupEtaRows('KMB', json.data ?? [], targetSeq, { finalize: false })
    } catch (error) {
      if (ids.length === 1) throw error
      console.warn(`[api] 九巴站點 ${id} 讀取失敗：${error.message}`)
      return null
    }
  })

  // 只有「所有站牌都失敗」才算錯誤；單一月台失敗仍顯示其他月台的班次
  const succeeded = results.filter((entries) => entries !== null)
  if (succeeded.length === 0) throw new ApiError('九巴站點暫時無法提供到站資料，請稍後再試')
  // 先合併月台 → 拆循環線的兩次經過 → 合併重複目的地 → 最後才排序／取最近三班
  const merged = mergeEtaGroups(succeeded)
  const split = await splitCircularPasses(merged)
  return finishEtaGroups(mergeSameDestination(split), targetSeq)
}

/**
 * 城巴 ETA
 * ------------------------------------------------------------------
 * 主要走 OGCIO 的批次端點：一次取得「該站所有路線」的到站時間，
 * 不需要站點的路線索引，請求數也從最多 8 次降為 1 次。
 *
 * 備援走官方 v2 逐路線端點，注意路徑順序是 `eta/CTB/{stopId}/{route}`：
 * 若寫成 `eta/CTB/{route}/{stopId}` 官方仍會回 200，但 `data` 永遠是空陣列
 * （過去城巴「有站點但沒有到站時間」就是這個原因）。
 */

/** 批次 ETA 端點（OGCIO「Bus Route List and ETA of a Specific Bus Stop」） */
const CTB_BATCH_ETA = 'https://rt.data.gov.hk/v1/transport/batch/stop-eta'

/** 批次回應的 `dest`／`rmk` 對齊 v2 逐路線回應的 `dest_tc`／`rmk_tc` */
function normalizeCitybusBatchRow(row) {
  return {
    ...row,
    dest_tc: row.dest_tc ?? row.dest ?? '',
    dest_en: row.dest_en ?? '',
    rmk_tc: row.rmk_tc ?? row.rmk ?? '',
  }
}

export async function getCitybusStopEtas(stopId, routes = [], targetSeq = null) {
  if (!stopId) return []

  // 1) 批次端點：一次拿齊該站所有路線的 ETA（含靜態索引未收錄的新路線）
  try {
    const json = await fetchJson(
      `${CTB_BATCH_ETA}/CTB/${encodeURIComponent(stopId)}?lang=zh-hant`,
    )
    return groupEtaRows('CTB', (json.data ?? []).map(normalizeCitybusBatchRow), targetSeq)
  } catch (error) {
    console.warn(`[api] 城巴批次 ETA（站點 ${stopId}）失敗，改用逐路線查詢：${error.message}`)
  }

  // 2) 備援：逐路線查詢（只有批次端點連線失敗時才會走到這裡）
  const routeCodes = [...new Set(routes.map((route) => normalize(route)).filter(Boolean))].slice(0, 8)
  if (routeCodes.length === 0) return []

  const results = await mapWithConcurrency(routeCodes, CTB_ETA_CONCURRENCY, async (route) => {
    try {
      const json = await fetchJson(
        `${CTB_BASE}/eta/CTB/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`,
      )
      return json.data ?? []
    } catch (error) {
      console.warn(`[api] 城巴 ${route} @ ${stopId} 讀取失敗：${error.message}`)
      return null
    }
  })

  // 全部路線都失敗（同時請求過多、被 timeout 擋掉）才顯示錯誤；
  // 若只是官方回空陣列（城巴偶發狀況）則照常顯示「暫無到站資料」。
  const succeeded = results.filter((rows) => rows !== null)
  if (succeeded.length === 0) {
    throw new ApiError('城巴暫時無法提供到站資料，請稍後再試')
  }
  return groupEtaRows('CTB', succeeded.flat(), targetSeq)
}

/** 小巴 ETA 一列一班車 → UI 共用格式 */
function toGmbEntry(item, meta) {
  const stopSeq = Number(item.stop_seq)
  const etas = (item.eta ?? []).map((eta) => {
    const diff = Number(eta.diff)
    return {
      seq: Number(eta.eta_seq ?? 0),
      stopSeq: Number.isFinite(stopSeq) ? stopSeq : null,
      minutes: Number.isFinite(diff) ? diff : minutesUntil(eta.timestamp),
      time: eta.timestamp ?? null,
      remark: eta.remarks_tc ?? '',
    }
  })

  return {
    operator: 'GMB',
    operatorName: OPERATORS.GMB.name,
    route: normalize(meta.route),
    direction: meta.direction,
    serviceType: '1',
    // route_id / route_seq 是查「全路線站序」(route-stop) 的必要參數
    routeId: meta.routeId,
    routeSeq: meta.routeSeq,
    orig: meta.origTc ?? '',
    destination: meta.destTc ?? '',
    destinationEn: meta.destEn ?? '',
    etas,
    // 運輸署的 ROUTE_BUS.xml 只含專營巴士，小巴票價沒有官方來源
    fare: null,
  }
}

/**
 * 小巴：以站點查全部路線的 ETA
 * API: GET https://data.etagmb.gov.hk/eta/stop/{stopId}
 *      回應只帶 route_id / route_seq，路線號碼與目的地要用靜態對照表補齊。
 *      同一路線號碼可能有多個 route_id（不同班次描述、目的地），這裡以「路線＋方向」合併成一張卡。
 */
export async function getGmbStopEtas(stopId, siblingIds = [], targetSeq = null) {
  const ids = [stopId, ...siblingIds.filter((id) => id && id !== stopId)].slice(0, MAX_SIBLINGS + 1)
  const routeMeta = await getGmbRouteMeta()
  const metaMap = new Map(routeMeta.map((meta) => [`${meta.routeId}|${meta.routeSeq}`, meta]))

  const results = await mapWithConcurrency(ids, GMB_ETA_CONCURRENCY, async (id) => {
    try {
      const json = await fetchJson(`${GMB_BASE}/eta/stop/${encodeURIComponent(id)}`)
      const groups = new Map()

      for (const item of json.data ?? []) {
        if (item.enabled === false) continue
        const meta = metaMap.get(`${item.route_id}|${item.route_seq}`)
        if (!meta) continue
        const entry = toGmbEntry(item, meta)
        const key = `${entry.route}|${entry.direction}`
        const existing = groups.get(key)
        if (!existing) {
          groups.set(key, entry)
          continue
        }
        // 有班次的那筆優先（另一個 route_id 可能只有班表、還沒有實時資料）
        if (existing.etas.length === 0 && entry.etas.length > 0) {
          existing.destination = entry.destination
          existing.destinationEn = entry.destinationEn
          existing.orig = entry.orig
          existing.routeId = entry.routeId
          existing.routeSeq = entry.routeSeq
        }
        existing.etas = [...existing.etas, ...entry.etas]
      }

      return [...groups.values()]
        .map((entry) => withNextMinutes({ ...entry, etas: normalizeEtaList(entry.etas, targetSeq) }))
        .sort(sortEtaGroups)
    } catch (error) {
      if (ids.length === 1) throw error
      console.warn(`[api] 小巴站點 ${id} 讀取失敗：${error.message}`)
      return null
    }
  })

  // 全部站牌都失敗才視為錯誤，單一站牌失敗仍顯示其他站牌的班次
  const succeeded = results.filter((entries) => entries !== null)
  if (succeeded.length === 0) throw new ApiError('小巴站點暫時無法提供到站資料，請稍後再試')
  return finishEtaGroups(mergeEtaGroups(succeeded), targetSeq)
}

/**
 * 統一入口：依業者呼叫對應的 ETA API
 * @param {{operator:string,id:string,seq?:number,routes?:string[],siblingIds?:string[]}} stop
 */
export async function getStopEtas(stop) {
  if (!stop?.id) return []
  // 目標站序：合併月台去重時，優先保留這個站牌的班次（呼叫端有帶 seq 才生效）
  const targetSeq = stop.seq != null && Number.isFinite(Number(stop.seq)) ? Number(stop.seq) : null
  if (stop.operator === 'CTB') {
    const routes = stop.routes?.length ? stop.routes : (await getStopInfo('CTB', stop.id))?.routes
    return getCitybusStopEtas(stop.id, routes ?? [], targetSeq)
  }
  if (stop.operator === 'GMB') {
    return getGmbStopEtas(stop.id, stop.siblingIds ?? [], targetSeq)
  }
  return getKmbStopEtas(stop.id, stop.siblingIds ?? [], targetSeq)
}

/** 依路線過濾（搜尋頁只顯示被選中的那條路線） */
export function filterByRoute(entries, route) {
  if (!route) return entries
  const target = normalize(route)
  return entries.filter((entry) => entry.route === target)
}

