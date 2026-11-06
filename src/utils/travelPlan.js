import { distanceInMeters } from '../services/api.js'

/**
 * 車程／預計到達時間推算（類似九巴 App 1933 的「後續各站到達時間」）
 *
 * 策略（由便宜到精確）：
 *   1. 幾何推算（通用、不額外發 API）：相鄰站點道路里程 ÷ 目前車速 + 每站停靠時間，
 *      以「上一站預計到達 + 相鄰路段耗時」逐站累加（不是一次過由基準站加總）。
 *   2. 實時 ETA 校準（Sequential ETA Matching）：頁面上已展開的站點會取得實時到站時間。
 *      以「上一站到達時間」為基準，同一班車到達下一站的合理區間為：
 *        [上一站 + 最短行車時間, 上一站 + 相鄰路段預計耗時 + 10 分鐘寬鬆容錯]
 *      落在區間內的官方 ETA 視為同一班車；再取加權後最接近預測的一班。
 *   3. 動態車速（Dynamic Speed）：連續兩個成功配對的官方 ETA（允許中間站缺 ETA，
 *      以累計道路里程計）可算出實際車速 `距離 ÷ (本次 ETA - 上次 ETA)`，
 *      扣除區間停站時間後即時更新 `currentSpeedKmh`；之後缺少 ETA 的站改用最新車速做幾何 fallback。
 *
 * 所有數值都是「估算」：香港市區路況、站距、燈位差異都會影響實際到站時間，
 * UI 一律以「推算／約」呈現，不可當成官方承諾。
 */

/** 香港市區巴士平均行駛速度（km/h）：市區走走停停，約 19 km/h；尚未學到動態車速時使用 */
export const AVG_BUS_SPEED_KMH = 19

/** 直線距離換算實際道路里程的繞行係數（市區道路多彎且需繞行） */
export const ROAD_DETOUR_FACTOR = 1.3

/** 每經過一站的平均停靠時間（秒）：開關門＋上落客 */
export const DWELL_SECONDS_PER_STOP = 35

/**
 * Sequential ETA Matching 的寬鬆容錯（分鐘）：相鄰路段的幾何預測本身有誤差，
 * 只要官方 ETA 落在「上一站 + 相鄰耗時 + 容錯」之內就視為同一班車。
 */
export const LIVE_ETA_HOP_TOLERANCE_MINUTES = 10

/** 實時 ETA 超過這個時間沒有更新就不再採用（毫秒；約等於兩次 30 秒輪詢） */
export const LIVE_ETA_MAX_AGE_MS = 90000

/** 相鄰兩站之間「同一班車」最少需要的行駛時間（毫秒）：比上一站還早的班次不可能同一班車 */
const MIN_HOP_MS = 60000

/**
 * 配對誤差的權重：幾何推算的預設 19 km/h 偏保守（通常會高估車程），
 * 因此「比預測早一點」比「比預測晚一點」更可能仍是同一班車，權重調低。
 * （避免在班距小的路線上，被幾何高估牽著配到下一班車。）
 */
const EARLY_DEVIATION_WEIGHT = 0.5

/** 動態車速的安全上下限（km/h）：避免實時 ETA 抖動造成離譜車速 */
const DYNAMIC_SPEED_MIN_KMH = 5
const DYNAMIC_SPEED_MAX_KMH = 65

/** 相鄰站點缺少座標時的後備直線距離（公尺）：約為市區平均站距 */
const FALLBACK_STRAIGHT_METERS = 450

/** 缺少座標時的後備道路里程（已套用繞行係數） */
const FALLBACK_SEGMENT_METERS = FALLBACK_STRAIGHT_METERS * ROAD_DETOUR_FACTOR

function hasCoordinate(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
}

/**
 * 沿線各段估計道路里程（公尺）：`segments[k]` 是第 k 站 → 第 k+1 站。
 * 兩端都有座標時用 Haversine 直線距離 × 繞行係數；缺少座標時以平均站距代替並標記 fallback。
 *
 * @param {Array<{lat?:number|null, lng?:number|null}>} stops
 * @returns {Array<{meters:number, fallback:boolean}>} 長度為 stops.length - 1
 */
export function buildSegments(stops = []) {
  const segments = []
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index]
    const to = stops[index + 1]
    const straight = hasCoordinate(from) && hasCoordinate(to) ? distanceInMeters(from, to) : null
    segments.push(
      Number.isFinite(straight)
        ? { meters: straight * ROAD_DETOUR_FACTOR, fallback: false }
        : { meters: FALLBACK_SEGMENT_METERS, fallback: true },
    )
  }
  return segments
}

/** 實時 ETA 記錄是否仍新鮮（太舊的資料不拿來校準，避免用了已收班／背景暫停前的時間） */
function isLiveRecordFresh(record, now) {
  if (!record) return false
  if (!Number.isFinite(record.updatedAt)) return true
  return now - record.updatedAt <= LIVE_ETA_MAX_AGE_MS
}

/**
 * 在某一站的實時 ETA 中，找出最可能是「上一站那班車」的下一站到達時間。
 *
 * Sequential Matching：以 `previousArrival`（上一站實際／推算到達時間）為基準，
 * 同一班車到達下一站的合理區間為：
 *   - 最早：`previousArrival + MIN_HOP_MS`（不可能比上一站更早到）
 *   - 最晚：`previousArrival + 相鄰路段預計耗時 + LIVE_ETA_HOP_TOLERANCE_MINUTES`
 * 區間內取「加權後最接近 predictedArrival」的一班；比預測早的誤差權重較低
 * （幾何車速偏保守，容易高估車程）。
 *
 * @param {{etas?:Array, updatedAt?:number}|undefined} record
 * @param {{previousArrival:number, predictedArrival:number, hopMinutes:number, now:number}} context
 * @returns {number|null} 實時到站時間（毫秒）
 */
function pickLiveArrival(record, { previousArrival, predictedArrival, hopMinutes, now }) {
  if (!isLiveRecordFresh(record, now) || !Array.isArray(record.etas)) return null
  if (!Number.isFinite(previousArrival) || !Number.isFinite(predictedArrival)) return null

  const hopMs = Number.isFinite(hopMinutes)
    ? Math.max(MIN_HOP_MS, hopMinutes * 60000)
    : MIN_HOP_MS
  const toleranceMs = LIVE_ETA_HOP_TOLERANCE_MINUTES * 60000
  const earliest = previousArrival + MIN_HOP_MS
  const latest = previousArrival + hopMs + toleranceMs
  let best = null

  for (const eta of record.etas) {
    const time = Date.parse(eta?.time ?? '')
    if (!Number.isFinite(time)) continue
    // 比上一站還早（或幾乎同時）→ 一定是前方的另一班車
    if (time < earliest) continue
    // 已過去的時間不可能再是「預計到達」
    if (time < now - 60000) continue
    // 超出「上一站 + 相鄰耗時 + 容錯」→ 較可能是下一班車，寧可沿用幾何推算
    if (time > latest) continue
    const deviation = time - predictedArrival
    const cost = deviation >= 0 ? deviation : -deviation * EARLY_DEVIATION_WEIGHT
    if (best == null || cost < best.cost) best = { time, cost }
  }

  return best ? best.time : null
}

/**
 * 取基準班次：`index` 是「最近三班」中的第幾班（0 = 第 1 班）。
 * 班次數不足時退回最後一班；沒有實時資料時回傳 null（代表只能做純車程推算）。
 *
 * @param {{etas?:Array, updatedAt?:number}|undefined} record 該站已取得的實時 ETA
 * @param {number} [index] 0-based 班次索引
 * @param {number} [now] 目前時間（毫秒），供測試注入
 * @returns {{eta:object, time:number|null, index:number}|null}
 */
export function pickBaseEta(record, index = 0, now = Date.now()) {
  if (!isLiveRecordFresh(record, now) || !Array.isArray(record.etas) || record.etas.length === 0) {
    return null
  }
  const clamped = Math.min(Math.max(0, Math.trunc(index) || 0), record.etas.length - 1)
  const eta = record.etas[clamped]
  const time = Date.parse(eta?.time ?? '')
  return { eta, time: Number.isFinite(time) ? time : null, index: clamped }
}

/**
 * 以基準站的班次時間，逐站（相鄰站相對配對）推算後續各站的預計到達時間。
 *
 * 核心迴圈（Sequential Matching）：
 *   1. 相鄰路段耗時 = 該段道路里程 ÷ 目前車速（動態車速，未學到時用 AVG_BUS_SPEED_KMH）
 *      + 每站停靠時間；`predictedArrival = previousArrival + 這段耗時`。
 *   2. 該站有新鮮實時 ETA、且時間落在「上一站 + 最短行車 ~ 上一站 + 相鄰耗時 + 10 分鐘」
 *      區間內時，視為同一班車並直接採用官方時間（`source = 'live'`）。
 *   3. 連續兩個成功配對的 live 站（允許中間站缺 ETA，以累計里程計）可算出實際車速，
 *      扣除區間停站耗時後即時更新 `currentSpeedKmh`；之後缺少 ETA 的站用最新車速做幾何 fallback。
 *   4. 沒有基準班次時間（`baseTime` 非有限數字）時，只回傳累計車程分鐘，`arrivalMs` 為 null，
 *      UI 會以「+X 分鐘車程」呈現。
 *
 * @param {object} params
 * @param {Array<{id:string|number, lat?:number|null, lng?:number|null}>} [params.stops] 依官方站序排列的站點
 * @param {number} [params.baseIndex] 起算站在 stops 中的索引
 * @param {number|null} [params.baseTime] 基準班次到站時間（毫秒）
 * @param {Map<string, {etas:Array, updatedAt?:number|null, loading?:boolean}>} [params.liveEtas]
 *        各站已取得的實時 ETA（key 為站點 id；`updatedAt` 缺失時視為新鮮）
 * @param {number} [params.now] 目前時間（毫秒），供測試注入
 * @returns {{
 *   baseStop: object|null,
 *   baseIndex: number,
 *   baseTime: number|null,
 *   entries: Array<{stop:object, index:number, travelMinutes:number, arrivalMs:number|null, source:'geometry'|'live'}>,
 *   byStopId: Map<string, object>,
 *   approximate: boolean,
 *   terminusMinutes: number|null,
 *   speedKmh: number,
 *   dynamicSpeed: boolean,
 * }}
 */
export function buildTravelPlan({
  stops = [],
  baseIndex = -1,
  baseTime = null,
  liveEtas = null,
  now = Date.now(),
} = {}) {
  const byStopId = new Map()
  const safeIndex = Number.isInteger(baseIndex) && baseIndex >= 0 ? baseIndex : -1
  const baseStop = safeIndex >= 0 ? (stops[safeIndex] ?? null) : null
  const hasBaseTime = Number.isFinite(baseTime)

  if (!baseStop) {
    return {
      baseStop: null,
      baseIndex: -1,
      baseTime: null,
      entries: [],
      byStopId,
      approximate: false,
      terminusMinutes: null,
      speedKmh: AVG_BUS_SPEED_KMH,
      dynamicSpeed: false,
    }
  }

  const segments = buildSegments(stops)
  const approximate = segments.some((segment) => segment.fallback)

  // 目前採用的車速：預設 19 km/h，學到連續兩站的實際車速後即時更新
  let currentSpeedKmh = AVG_BUS_SPEED_KMH
  let dynamicSpeed = false
  // 上一站到達時間（基準站時間或上一次配對／推算結果）
  let previousArrival = hasBaseTime ? baseTime : null
  let previousMinutes = 0
  // 沒有基準班次時間時，改用累計耗時換算車程分鐘
  let accumulatedMs = 0
  // 最近一次「官方 ETA」的到達時間，以及自那時起累計的道路里程與站數（用來學動態車速）
  let lastLiveArrival = hasBaseTime ? baseTime : null
  let metersSinceLastLive = 0
  let hopsSinceLastLive = 0
  const entries = []

  for (let index = safeIndex + 1; index < stops.length; index += 1) {
    const hopMeters = segments[index - 1]?.meters ?? FALLBACK_SEGMENT_METERS
    const driveMinutes = (hopMeters / 1000 / currentSpeedKmh) * 60
    const dwellMinutes = DWELL_SECONDS_PER_STOP / 60
    const hopMinutes = driveMinutes + dwellMinutes
    const hopMs = Math.max(MIN_HOP_MS, Math.round(hopMinutes * 60000))

    // 核心：預測到達 = 上一站到達 + 相鄰路段耗時（不是由基準站一次過加幾何總和）
    let arrivalMs = previousArrival != null ? previousArrival + hopMs : null
    let source = 'geometry'
    let travelMinutes

    if (hasBaseTime && previousArrival != null) {
      metersSinceLastLive += hopMeters
      hopsSinceLastLive += 1

      const liveArrival = pickLiveArrival(
        stops[index]?.id != null ? liveEtas?.get(String(stops[index].id)) : undefined,
        {
          previousArrival,
          predictedArrival: arrivalMs,
          hopMinutes,
          now,
        },
      )
      if (liveArrival != null) {
        arrivalMs = liveArrival
        source = 'live'
      }

      // 後面的站不可早於前一站（實時資料抖動或四捨五入都可能造成非遞增）；
      // 被夾回的時間是推算值，不可再標成官方資料。
      if (arrivalMs <= previousArrival) {
        arrivalMs = previousArrival + 60000
        source = 'geometry'
      }

      // 動態車速：以「上一次成功配對的官方 ETA」到「本次官方 ETA」的實際時間與里程計算；
      // 中間站缺 ETA 時使用累計里程與站數扣除停靠時間，避免雙重累加停站耗時。
      if (source === 'live') {
        if (
          lastLiveArrival != null &&
          arrivalMs > lastLiveArrival &&
          metersSinceLastLive > 0
        ) {
          const travelSeconds = (arrivalMs - lastLiveArrival) / 1000
          // 扣除這段區間累積的預期停站時間（至少保留 40% 的時間作純行駛時間），算出純行車速度
          const totalDwellSeconds = hopsSinceLastLive * DWELL_SECONDS_PER_STOP
          const pureDriveSeconds = Math.max(travelSeconds * 0.4, travelSeconds - totalDwellSeconds)
          const speedKmh = (metersSinceLastLive / pureDriveSeconds) * 3.6
          if (Number.isFinite(speedKmh)) {
            currentSpeedKmh = Math.min(
              DYNAMIC_SPEED_MAX_KMH,
              Math.max(DYNAMIC_SPEED_MIN_KMH, speedKmh),
            )
            dynamicSpeed = true
          }
        }
        lastLiveArrival = arrivalMs
        metersSinceLastLive = 0
        hopsSinceLastLive = 0
      }

      // 車程分鐘與 formatClock 鐘點時間對齊：
      // 避免 Math.round 四捨五入造成 "+3 分" 卻顯示 "12:02 到達" 的 1 分鐘視覺矛盾
      const baseClockMinutes = Math.floor(baseTime / 60000)
      const arrivalClockMinutes = Math.floor(arrivalMs / 60000)
      travelMinutes = Math.max(1, arrivalClockMinutes - baseClockMinutes)
    } else {
      // 沒有基準班次時間：只累加相鄰路段耗時，供「+X 分鐘車程」顯示
      accumulatedMs += hopMs
      travelMinutes = Math.max(1, Math.round(accumulatedMs / 60000))
    }

    if (travelMinutes <= previousMinutes) {
      travelMinutes = previousMinutes + 1
      // 若有基準時間，到達時間也同步前推至至少該分鐘，確保 HH:mm 與 travelMinutes 一致
      if (hasBaseTime && arrivalMs != null) {
        const minArrivalMs = baseTime + travelMinutes * 60000
        if (arrivalMs < minArrivalMs) {
          arrivalMs = minArrivalMs
        }
      }
    }
    previousMinutes = travelMinutes
    previousArrival = arrivalMs

    const entry = { stop: stops[index], index, travelMinutes, arrivalMs, source }
    entries.push(entry)
    if (stops[index]?.id != null) byStopId.set(String(stops[index].id), entry)
  }

  return {
    baseStop,
    baseIndex: safeIndex,
    baseTime: hasBaseTime ? baseTime : null,
    entries,
    byStopId,
    approximate,
    terminusMinutes: entries.length > 0 ? entries[entries.length - 1].travelMinutes : null,
    speedKmh: currentSpeedKmh,
    dynamicSpeed,
  }
}
