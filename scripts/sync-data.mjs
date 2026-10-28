/**
 * 資料同步腳本 (npm run sync:data)
 * ------------------------------------------------------------------
 * DATA.GOV.HK 的城巴 (CTB) 與專線小巴 (GMB) 都沒有「全部站點」端點，
 * 因此需要一次性由官方 API 掃出站點索引，讓前端能在 500 公尺內找到站點。
 *
 * 產出（放在 public/data/，由前端延遲 fetch 後存進 IndexedDB，
 * 不會被打包進 JS bundle，避免拖慢首次繪製）：
 *   public/data/citybus-stops.json  [[stopId, name_tc, name_en, lat, lng, [route...]], ...]
 *   public/data/gmb-routes.json     [[route_id, route_seq, route_code, region, orig_tc, dest_tc, orig_en, dest_en], ...]
 *   public/data/gmb-stops.json      [[stopId, name_tc, name_en, lat, lng, [routeCode...]], ...]
 *
 * 另外產生（體積小，直接打包給 UI 同步查表）：
 *   src/data/fares.json             { generatedAt, source, operators: { KMB: { "1A|1": 8.2 }, CTB: {...} } }
 *
 * 使用方式：
 *   node scripts/sync-data.mjs              全部重建
 *   node scripts/sync-data.mjs --fares-only 只更新票價表
 *   node scripts/sync-data.mjs --gmb-only   只重建小巴索引
 *   node scripts/sync-data.mjs --ctb-only   只重建城巴索引
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const CTB_BASE = 'https://rt.data.gov.hk/v2/transport/citybus'
const GMB_BASE = 'https://data.etagmb.gov.hk'
const TD_FARE_XML = 'https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml'

const PUBLIC_DATA_DIR = path.resolve('public/data')
const SRC_DATA_DIR = path.resolve('src/data')

const CONCURRENCY = 12
const GMB_STOP_CONCURRENCY = 16
const RETRY = 3

const args = process.argv.slice(2)
const hasFlag = (flag) => args.includes(flag)

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
    return await res.json()
  } catch (error) {
    if (attempt + 1 >= RETRY) throw error
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    return fetchJson(url, attempt + 1)
  }
}

/** 以固定併發數執行任務，避免打爆官方 API */
async function mapWithConcurrency(items, limit, worker) {
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

/** 讀取既有的 public/data JSON（不存在或格式錯誤時回傳 null） */
async function readExisting(fileName) {
  try {
    const raw = await fs.readFile(path.join(PUBLIC_DATA_DIR, fileName), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(data)}\n`)
}

function warnSample(label, errors) {
  if (errors.length === 0) return
  console.warn(`      ⚠ ${label} ${errors.length} 筆失敗，例如：${errors.slice(0, 3).join(' / ')}`)
}


/* ------------------------------------------------------------------ */
/* 1. 城巴 (CTB) 站點索引                                              */
/* ------------------------------------------------------------------ */
async function buildCitybusStops() {
  console.log('\n[CTB] 取得城巴路線清單…')
  const routeList = await fetchJson(`${CTB_BASE}/route/CTB`)
  const routes = [...new Set(routeList.data.map((item) => item.route))]
  console.log(`      共 ${routes.length} 條城巴路線`)

  const jobs = routes.flatMap((route) => ['outbound', 'inbound'].map((direction) => ({ route, direction })))
  const stopRoutes = new Map()
  const errors = []

  await mapWithConcurrency(jobs, CONCURRENCY, async ({ route, direction }) => {
    try {
      const json = await fetchJson(`${CTB_BASE}/route-stop/CTB/${route}/${direction}`)
      for (const item of json.data ?? []) {
        if (!stopRoutes.has(item.stop)) stopRoutes.set(item.stop, new Set())
        stopRoutes.get(item.stop).add(route)
      }
    } catch (error) {
      errors.push(`${route}/${direction}: ${error.message}`)
    }
  })
  warnSample('路線站序', errors)

  console.log(`      掃描 ${jobs.length} 組路線／方向，共 ${stopRoutes.size} 個站牌，讀取站點資料…`)
  const records = []
  const stopErrors = []
  await mapWithConcurrency([...stopRoutes.keys()], CONCURRENCY, async (stopId) => {
    try {
      const json = await fetchJson(`${CTB_BASE}/stop/${stopId}`)
      const stop = json.data
      if (!stop) return
      const lat = Number(stop.lat)
      const lng = Number(stop.long)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      records.push([
        stop.stop,
        stop.name_tc,
        stop.name_en,
        Number(lat.toFixed(6)),
        Number(lng.toFixed(6)),
        [...stopRoutes.get(stopId)].sort(),
      ])
    } catch (error) {
      stopErrors.push(`${stopId}: ${error.message}`)
    }
  })
  warnSample('站點', stopErrors)

  records.sort((a, b) => a[0].localeCompare(b[0]))
  await writeJson(path.join(PUBLIC_DATA_DIR, 'citybus-stops.json'), records)
  console.log(`      ✔ public/data/citybus-stops.json（${records.length} 筆）`)
}

/* ------------------------------------------------------------------ */
/* 2. 專線小巴 (GMB) 路線／站點索引                                     */
/* ------------------------------------------------------------------ */
async function buildGmbData() {
  console.log('\n[GMB] 取得小巴路線清單…')
  const list = await fetchJson(`${GMB_BASE}/route/`)
  const regionMap = list.data?.routes ?? {}
  const regionCodes = Object.entries(regionMap).flatMap(([region, codes]) =>
    (codes ?? []).map((code) => ({ region, code })),
  )
  console.log(`      共 ${regionCodes.length} 條小巴路線（${Object.keys(regionMap).join(' / ')}）`)

  // 2-1 路線細節：route_id 與 route_seq（1 = 去程、2 = 回程）
  const routeErrors = []
  const routeDetails = await mapWithConcurrency(regionCodes, CONCURRENCY, async ({ region, code }) => {
    try {
      const json = await fetchJson(`${GMB_BASE}/route/${region}/${code}`)
      return { region, code, variants: json.data ?? [] }
    } catch (error) {
      routeErrors.push(`${region}/${code}: ${error.message}`)
      return null
    }
  })
  warnSample('路線資料', routeErrors)

  const routeRows = []
  const routeJobs = []

  for (const detail of routeDetails) {
    if (!detail) continue
    for (const variant of detail.variants) {
      if (!variant?.route_id) continue
      for (const direction of variant.directions ?? []) {
        routeRows.push([
          variant.route_id,
          direction.route_seq,
          detail.code,
          detail.region,
          direction.orig_tc ?? '',
          direction.dest_tc ?? '',
          direction.orig_en ?? '',
          direction.dest_en ?? '',
        ])
        routeJobs.push({ routeId: variant.route_id, routeSeq: direction.route_seq, code: detail.code })
      }
    }
  }

  // 2-2 掃描每條路線方向的站序，建立「站點 → 路線」索引
  console.log(`      掃描 ${routeJobs.length} 組路線／方向的站序…`)
  const stopRoutes = new Map()
  const stopNames = new Map()
  const stopErrors = []

  await mapWithConcurrency(routeJobs, CONCURRENCY, async ({ routeId, routeSeq, code }) => {
    try {
      const json = await fetchJson(`${GMB_BASE}/route-stop/${routeId}/${routeSeq}`)
      for (const item of json.data?.route_stops ?? []) {
        const stopId = String(item.stop_id)
        if (!stopRoutes.has(stopId)) stopRoutes.set(stopId, new Set())
        stopRoutes.get(stopId).add(code)
        if (!stopNames.has(stopId)) {
          stopNames.set(stopId, { nameTc: item.name_tc ?? '', nameEn: item.name_en ?? '' })
        }
      }
    } catch (error) {
      stopErrors.push(`${routeId}/${routeSeq}: ${error.message}`)
    }
  })
  warnSample('路線站序', stopErrors)

  // 2-3 站點座標（/stop/{id} 只提供座標，站名來自 route-stop）
  //     沿用既有快照的座標，重跑腳本時可少打數千個請求
  const previous = await readExisting('gmb-stops.json')
  const coordinateCache = new Map()
  for (const row of previous ?? []) {
    if (Array.isArray(row) && Number.isFinite(row?.[3]) && Number.isFinite(row?.[4])) {
      coordinateCache.set(String(row[0]), { lat: row[3], lng: row[4] })
    }
  }
  const idsToFetch = [...stopRoutes.keys()].filter((id) => !coordinateCache.has(id))
  console.log(
    `      共 ${stopRoutes.size} 個小巴站牌；需查詢座標 ${idsToFetch.length} 個（沿用快照 ${
      stopRoutes.size - idsToFetch.length
    } 個）…`,
  )

  const coordinateErrors = []
  await mapWithConcurrency(idsToFetch, GMB_STOP_CONCURRENCY, async (stopId) => {
    try {
      const json = await fetchJson(`${GMB_BASE}/stop/${stopId}`)
      const wgs84 = json.data?.coordinates?.wgs84
      const lat = Number(wgs84?.latitude)
      const lng = Number(wgs84?.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      coordinateCache.set(stopId, { lat, lng })
    } catch (error) {
      coordinateErrors.push(`${stopId}: ${error.message}`)
    }
  })
  warnSample('站點座標', coordinateErrors)

  const stopRows = []
  for (const [stopId, routes] of stopRoutes) {
    const coordinate = coordinateCache.get(stopId)
    if (!coordinate) continue
    const names = stopNames.get(stopId) ?? { nameTc: '', nameEn: '' }
    stopRows.push([
      stopId,
      names.nameTc,
      names.nameEn,
      Number(coordinate.lat.toFixed(6)),
      Number(coordinate.lng.toFixed(6)),
      [...routes].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    ])
  }

  routeRows.sort((a, b) => a[2].localeCompare(b[2], 'en', { numeric: true }) || a[1] - b[1])
  stopRows.sort((a, b) => a[0].localeCompare(b[0]))

  await writeJson(path.join(PUBLIC_DATA_DIR, 'gmb-routes.json'), routeRows)
  await writeJson(path.join(PUBLIC_DATA_DIR, 'gmb-stops.json'), stopRows)
  console.log(`      ✔ public/data/gmb-routes.json（${routeRows.length} 筆）`)
  console.log(`      ✔ public/data/gmb-stops.json（${stopRows.length} 筆）`)
}


/* ------------------------------------------------------------------ */
/* 3. KMB/CTB 票價表 (TD ROUTE_BUS.xml)                                */
/* ------------------------------------------------------------------ */
function pick(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match ? match[1].trim() : ''
}

/**
 * 運輸署資料以 COMPANY_CODE 區分營運商，聯營路線會出現 "KMB+CTB" 這種代碼，
 * 需要對應回前端的兩個業者，否則聯營路線會查不到票價。
 */
const COMPANY_TO_OPERATORS = {
  KMB: ['KMB'],
  CTB: ['CTB'],
  'KMB+CTB': ['KMB', 'CTB'],
  'LWB+CTB': ['CTB'],
}

async function buildFares() {
  console.log('\n[Fares] 取得運輸署票價資料 (ROUTE_BUS.xml)…')
  const res = await fetch(TD_FARE_XML)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${TD_FARE_XML}`)
  const xml = await res.text()

  const operators = { KMB: {}, CTB: {} }
  let parsed = 0

  for (const match of xml.matchAll(/<ROUTE>([\s\S]*?)<\/ROUTE>/g)) {
    const block = match[1]
    const targets = COMPANY_TO_OPERATORS[pick(block, 'COMPANY_CODE')]
    if (!targets) continue
    const route = pick(block, 'ROUTE_NAMEC').toUpperCase()
    const serviceType = pick(block, 'ROUTE_TYPE') || '1'
    const fare = Number.parseFloat(pick(block, 'FULL_FARE'))
    if (!route || !Number.isFinite(fare)) continue
    for (const operator of targets) {
      operators[operator][`${route}|${serviceType}`] = fare
      parsed += 1
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: TD_FARE_XML,
    note: 'FULL_FARE = 全程收費（HKD）。上車收費可能因分段收費而較低；聯營路線 (KMB+CTB) 兩者共用同一票價。專線小巴不在此份資料內。',
    operators,
  }
  await writeJson(path.join(SRC_DATA_DIR, 'fares.json'), payload)
  console.log(
    `      ✔ src/data/fares.json（KMB ${Object.keys(operators.KMB).length} 條、CTB ${
      Object.keys(operators.CTB).length
    } 條，共解析 ${parsed} 筆）`,
  )
}

/* ------------------------------------------------------------------ */
async function main() {
  const startedAt = Date.now()
  const faresOnly = hasFlag('--fares-only')

  if (!faresOnly) {
    const onlyGmb = hasFlag('--gmb-only')
    const onlyCtb = hasFlag('--ctb-only')
    if (!onlyGmb) await buildCitybusStops()
    if (!onlyCtb) await buildGmbData()
  }

  await buildFares()
  console.log(`\n完成，耗時 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒。`)
}

main().catch((error) => {
  console.error('資料同步失敗：', error)
  process.exitCode = 1
})

