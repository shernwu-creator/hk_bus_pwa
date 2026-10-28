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
import { loadStaticData } from './staticData.js'

const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb'
const CTB_BASE = 'https://rt.data.gov.hk/v2/transport/citybus'
const GMB_BASE = 'https://data.etagmb.gov.hk'

/** 首頁附近站點的預設搜尋半徑（公尺） */
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
/**
 * 附近站點：以座標篩選半徑內的 KMB + CTB + GMB 站點，依距離排序
 * 同一業者、同站名的相鄰站牌（九巴一個總站常有多個月台編號）會合併成一筆，
 * 其餘站牌編號放在 siblingIds，查 ETA 時一併合併顯示。
 * @returns {Promise<Array<{operator:string,id:string,nameTc:string,nameEn:string,lat:number,lng:number,routes:string[]|null,siblingIds:string[],distance:number}>>}
 */
export async function getNearbyStops({ lat, lng, radius = DEFAULT_RADIUS, limit = 12 } = {}) {
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
  return {
    seq: Number(row.eta_seq ?? 0),
    minutes: minutesUntil(row.eta),
    time: row.eta ?? null,
    remark: row.rmk_tc ?? '',
  }
}

const sortEtaGroups = (a, b) =>
  a.route.localeCompare(b.route, 'en', { numeric: true }) || a.direction.localeCompare(b.direction)

/** 補上 nextMinutes（最近一班車的剩餘分鐘），供 UI 排序 */
function withNextMinutes(entry) {
  const nextMinutes = entry.etas.reduce((min, eta) => {
    if (eta.minutes == null) return min
    return min == null ? eta.minutes : Math.min(min, eta.minutes)
  }, null)
  return { ...entry, nextMinutes }
}

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
    .map((entry) => withNextMinutes({ ...entry, etas: [...entry.etas].sort((a, b) => a.seq - b.seq).slice(0, ETA_PER_ROUTE) }))
    .sort(sortEtaGroups)
}

/**
 * 整理多筆到站時間：依實際時間排序、60 秒內視為同一班車、沒有時間的班次排最後，
 * 最後只保留最近三班並重新編號。
 */
function trimEtas(input) {
  const timed = [...input]
    .filter((eta) => eta.time && !Number.isNaN(Date.parse(eta.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .reduce((kept, eta) => {
      const last = kept[kept.length - 1]
      if (!last) return [eta]
      return Date.parse(eta.time) - Date.parse(last.time) < SIBLING_ETA_WINDOW ? kept : [...kept, eta]
    }, [])

  const untimed = input.filter((eta) => !eta.time || Number.isNaN(Date.parse(eta.time)))

  return [...timed, ...untimed].slice(0, ETA_PER_ROUTE).map((eta, index) => ({ ...eta, seq: index + 1 }))
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
    .map((entry) => withNextMinutes({ ...entry, etas: trimEtas(entry.etas) }))
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
      return null
    }
  })

  // 只有「所有站牌都失敗」才算錯誤；單一月台失敗仍顯示其他月台的班次
  const succeeded = results.filter((entries) => entries !== null)
  if (succeeded.length === 0) throw new ApiError('九巴站點暫時無法提供到站資料，請稍後再試')
  return mergeEtaGroups(succeeded)
}

/**
 * 城巴：必須逐條路線查詢，因此需要「該站點經過的路線」清單
 * （來源：public/data/citybus-stops.json，或搜尋頁已知的路線）
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
      return null
    }
  })

  // 全部路線都失敗（同時請求過多、被 timeout 擋掉）才顯示錯誤；
  // 若只是官方回空陣列（城巴偶發狀況）則照常顯示「暫無到站資料」。
  const succeeded = results.filter((rows) => rows !== null)
  if (succeeded.length === 0) {
    throw new ApiError('城巴暫時無法提供到站資料，請稍後再試')
  }
  return groupEtaRows('CTB', succeeded.flat())
}

/** 小巴 ETA 一列一班車 → UI 共用格式 */
function toGmbEntry(item, meta) {
  const etas = (item.eta ?? []).map((eta) => {
    const diff = Number(eta.diff)
    return {
      seq: Number(eta.eta_seq ?? 0),
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
export async function getGmbStopEtas(stopId, siblingIds = []) {
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
        .map((entry) => withNextMinutes({ ...entry, etas: trimEtas(entry.etas) }))
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
  return mergeEtaGroups(succeeded)
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
  if (stop.operator === 'GMB') {
    return getGmbStopEtas(stop.id, stop.siblingIds ?? [])
  }
  return getKmbStopEtas(stop.id, stop.siblingIds ?? [])
}

/** 依路線過濾（搜尋頁只顯示被選中的那條路線） */
export function filterByRoute(entries, route) {
  if (!route) return entries
  const target = normalize(route)
  return entries.filter((entry) => entry.route === target)
}

