/**
 * 官方全線歷史耗時採樣腳本 (Phase 2 - Travel Time Sampling)
 * ------------------------------------------------------------------
 * 透過 DATA.GOV.HK 的九巴 `/route-eta/{route}/{service_type}` 端點，
 * 一次性取得一條路線全線所有站點的即時 ETA。
 * 比對同一班車在相鄰站點的抵達時間差，計算出「站與站之間的真實行駛分鐘數」，
 * 並依照當前時段（早繁、午間、晚繁、深夜）平滑累加更新至 `src/data/travelTimes.json`。
 *
 * 執行方式：
 *   node scripts/sample-travel-times.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb'
const TRAVEL_TIMES_FILE = path.resolve('src/data/travelTimes.json')

/** 目標重點採樣路線（涵蓋市區幹道、過海隧道、新界特快與機場線） */
const TARGET_ROUTES = [
  '1A', '2A', '6', '14', '16', '27', '30X', '40', '42C', '74X', '87D',
  '101', '102', '104', '112', '118', '171', '601', '680', '681', '960', '968', '962',
  '269D', '277X', '278X', '290', '290A', '798',
  'A21', 'E21', 'E33',
]

const RETRY = 2
const CONCURRENCY = 6

/** 判斷當前香港時間所屬的時段 */
function getCurrentPeriod() {
  const now = new Date()
  // 香港為 UTC+8
  const hkHours = (now.getUTCHours() + 8) % 24 + now.getUTCMinutes() / 60
  const day = (now.getUTCDay() + (now.getUTCHours() + 8 >= 24 ? 1 : 0)) % 7
  const isWeekend = day === 0 || day === 6

  if (hkHours >= 23.5 || hkHours < 6.5) return 'night'
  if (!isWeekend && hkHours >= 7.5 && hkHours < 9.5) return 'morningPeak'
  if (!isWeekend && hkHours >= 17.5 && hkHours < 19.5) return 'eveningPeak'
  return 'regular'
}

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    if (attempt + 1 >= RETRY) return null
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
    return fetchJson(url, attempt + 1)
  }
}

/** 併發限制器 */
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

/** 分析單一路線單一方向的相鄰站點耗時 */
function calculateDirectionSegments(rows) {
  const stopsBySeq = new Map()
  for (const row of rows) {
    const seq = Number(row.seq)
    if (!Number.isFinite(seq)) continue
    if (!stopsBySeq.has(seq)) stopsBySeq.set(seq, {})
    if (row.eta_seq && row.eta) {
      const time = Date.parse(row.eta)
      if (Number.isFinite(time)) {
        stopsBySeq.get(seq)[row.eta_seq] = time
      }
    }
  }

  const sortedSeqs = [...stopsBySeq.keys()].sort((a, b) => a - b)
  if (sortedSeqs.length < 2) return []

  const segmentMinutes = []
  for (let i = 0; i < sortedSeqs.length - 1; i += 1) {
    const seqFrom = sortedSeqs[i]
    const seqTo = sortedSeqs[i + 1]
    const etasFrom = stopsBySeq.get(seqFrom)
    const etasTo = stopsBySeq.get(seqTo)

    const diffsSec = []
    for (let busIndex = 1; busIndex <= 3; busIndex += 1) {
      const timeFrom = etasFrom[busIndex]
      const timeTo = etasTo[busIndex]
      if (timeFrom && timeTo && timeTo > timeFrom) {
        const diff = (timeTo - timeFrom) / 1000
        // 合理單段站距耗時介於 30 秒至 25 分鐘
        if (diff >= 30 && diff <= 1500) {
          diffsSec.push(diff)
        }
      }
    }

    if (diffsSec.length > 0) {
      const avgSec = diffsSec.reduce((a, b) => a + b, 0) / diffsSec.length
      segmentMinutes.push(Math.max(1, Math.round(avgSec / 60)))
    } else {
      segmentMinutes.push(null)
    }
  }

  return segmentMinutes
}

async function main() {
  const period = getCurrentPeriod()
  console.log(`[Phase 2] 開始採樣官方全線歷史到站耗時... (時段: ${period})`)

  let db = { updatedAt: null, routes: {} }
  try {
    const raw = await fs.readFile(TRAVEL_TIMES_FILE, 'utf8')
    db = JSON.parse(raw)
  } catch {
    // 檔案不存在或損毀時以空結構開始
  }

  let updatedRoutesCount = 0

  await mapWithConcurrency(TARGET_ROUTES, CONCURRENCY, async (route) => {
    try {
      const json = await fetchJson(`${KMB_BASE}/route-eta/${encodeURIComponent(route)}/1`)
      const rows = json?.data ?? []
      if (rows.length === 0) return

      const outboundRows = rows.filter((r) => r.dir === 'O')
      const inboundRows = rows.filter((r) => r.dir === 'I')

      const directions = [
        { key: `KMB:${route}:outbound`, rows: outboundRows },
        { key: `KMB:${route}:inbound`, rows: inboundRows },
      ]

      for (const { key, rows: dirRows } of directions) {
        if (dirRows.length === 0) continue
        const segments = calculateDirectionSegments(dirRows)
        if (segments.length === 0 || segments.every((v) => v === null)) continue

        if (!db.routes[key]) db.routes[key] = {}
        const existing = db.routes[key][period] ?? []

        // 平滑融合新舊數據：新採樣以 40% 權重平滑更新
        const merged = new Array(Math.max(existing.length, segments.length))
        for (let i = 0; i < merged.length; i += 1) {
          const oldVal = existing[i]
          const newVal = segments[i]
          if (newVal != null && oldVal != null) {
            merged[i] = Math.max(1, Math.round(oldVal * 0.6 + newVal * 0.4))
          } else if (newVal != null) {
            merged[i] = newVal
          } else {
            merged[i] = oldVal ?? null
          }
        }

        db.routes[key][period] = merged
        updatedRoutesCount += 1
      }
    } catch (err) {
      console.warn(`[Phase 2] 路線 ${route} 採樣失敗: ${err.message}`)
    }
  })

  db.updatedAt = Date.now()
  await fs.writeFile(TRAVEL_TIMES_FILE, JSON.stringify(db, null, 2), 'utf8')
  console.log(`[Phase 2] 採樣完成！共更新 ${updatedRoutesCount} 個路線方向數據。`)
}

main().catch((err) => {
  console.error('[Phase 2] 執行發生未預期錯誤:', err)
  process.exit(1)
})
