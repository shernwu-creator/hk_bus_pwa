/**
 * 資料同步腳本 (npm run sync:data)
 *
 * 目的：DATA.GOV.HK 的城巴 (CTB) API 沒有「全部站點」與「站點 → 路線」的端點，
 *       因此需要一次性由官方 API 建立本地索引，讓前端可以在 500 公尺內找到城巴站點。
 *       同時由運輸署 (TD) 的 ROUTE_BUS.xml 建立路線票價表（KMB / CTB 全程收費）。
 *
 * 產出：
 *   src/data/citybus-stops.json  [[stopId, name_tc, name_en, lat, lng, [[route, dir], ...]], ...]
 *   src/data/fares.json          { generatedAt, source, operators: { KMB: { "1A|1": 6.7 }, CTB: {...} } }
 *
 * 使用方式：node scripts/sync-data.mjs（或 npm run sync:data）
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const CTB_BASE = 'https://rt.data.gov.hk/v2/transport/citybus'
const TD_FARE_XML = 'https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml'
const OUTPUT_DIR = path.resolve('src/data')

const CONCURRENCY = 12
const RETRY = 3

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

async function buildCitybusStops() {
  console.log('[1/3] 取得城巴路線清單…')
  const routeList = await fetchJson(`${CTB_BASE}/route/CTB`)
  const routes = [...new Set(routeList.data.map((item) => item.route))]
  console.log(`      共 ${routes.length} 條城巴路線`)

  const directions = ['outbound', 'inbound']
  const jobs = routes.flatMap((route) => directions.map((direction) => ({ route, direction })))

  console.log(`[2/3] 掃描 ${jobs.length} 組路線／方向，建立「站點 → 路線」索引…`)
  const stopRoutes = new Map()
  let done = 0
  await mapWithConcurrency(jobs, CONCURRENCY, async ({ route, direction }) => {
    try {
      const json = await fetchJson(`${CTB_BASE}/route-stop/CTB/${route}/${direction}`)
      for (const item of json.data ?? []) {
        const key = item.stop
        if (!stopRoutes.has(key)) stopRoutes.set(key, new Set())
        stopRoutes.get(key).add(route)
      }
    } catch (error) {
      console.warn(`      ! ${route}/${direction} 失敗：${error.message}`)
    } finally {
      done += 1
      if (done % 100 === 0) console.log(`      ${done}/${jobs.length}`)
    }
  })

  const stopIds = [...stopRoutes.keys()]
  console.log(`      共 ${stopIds.length} 個城巴站點，開始取得站點座標…`)

  const records = []
  let fetched = 0
  await mapWithConcurrency(stopIds, CONCURRENCY, async (stopId) => {
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
      console.warn(`      ! 站點 ${stopId} 失敗：${error.message}`)
    } finally {
      fetched += 1
      if (fetched % 500 === 0) console.log(`      ${fetched}/${stopIds.length}`)
    }
  })

  records.sort((a, b) => a[0].localeCompare(b[0]))
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(path.join(OUTPUT_DIR, 'citybus-stops.json'), `${JSON.stringify(records)}\n`)
  console.log(`      已寫入 src/data/citybus-stops.json（${records.length} 筆）`)
}

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
  console.log('[3/3] 取得運輸署票價資料 (ROUTE_BUS.xml)…')
  const res = await fetch(TD_FARE_XML)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${TD_FARE_XML}`)
  const xml = await res.text()

  const operators = { KMB: {}, CTB: {} }
  let parsed = 0
  for (const match of xml.matchAll(/<ROUTE>([\s\S]*?)<\/ROUTE>/g)) {
    const block = match[1]
    const companyCode = pick(block, 'COMPANY_CODE')
    const targets = COMPANY_TO_OPERATORS[companyCode]
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
    note: 'FULL_FARE = 全程收費（HKD）。上車收費可能因分段收費而較低；聯營路線 (KMB+CTB) 兩者共用同一票價。',
    operators,
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(path.join(OUTPUT_DIR, 'fares.json'), `${JSON.stringify(payload)}\n`)
  console.log(
    `      已寫入 src/data/fares.json（KMB ${Object.keys(operators.KMB).length} 條、CTB ${
      Object.keys(operators.CTB).length
    } 條，共解析 ${parsed} 筆）`,
  )
}

async function main() {
  const startedAt = Date.now()
  const faresOnly = process.argv.includes('--fares-only')
  if (faresOnly) {
    console.log('（--fares-only：只更新票價表）')
  } else {
    await buildCitybusStops()
  }
  await buildFares()
  console.log(`\n完成，耗時 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒。`)
}

main().catch((error) => {
  console.error('資料同步失敗：', error)
  process.exitCode = 1
})
