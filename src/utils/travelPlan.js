import { distanceInMeters } from '../services/api.js'

/**
 * 車程／預計到達時間推算（類似九巴 App 1933 的「後續各站到達時間」）
 *
 * 策略（由便宜到精確）：
 *   1. 幾何推算（通用、不額外發 API）：相鄰站點直線距離 × 道路繞行係數 ÷ 平均車速，
 *      每經過一站再加平均停靠時間，累加出「從基準站到第 N 站的車程分鐘數」。
 *   2. 實時 ETA 校準：頁面上已展開的站點會透過批次 ETA API 取得實時到站時間。
 *      以「晚於上一個錨點、且不晚於幾何預測 + 容許誤差」為候選，再取加權後最接近幾何預測的
 *      一班（偏早的誤差權重較低，因為幾何車速偏保守），推測為同一班車並直接採用官方實時時間
 *      （比純幾何準，也不用再發請求）。採用後以該站為新錨點，上遊的實際延誤會往下游傳遞。
 *
 * 所有數值都是「估算」：香港市區路況、站距、燈位差異都會影響實際到站時間，
 * UI 一律以「推算／約」呈現，不可當成官方承諾。
 */

/** 香港市區巴士平均行駛速度（km/h）：市區走走停停，約 19 km/h */
export const AVG_BUS_SPEED_KMH = 19

/** 直線距離換算實際道路里程的繞行係數（市區道路多彎且需繞行） */
export const ROAD_DETOUR_FACTOR = 1.3

/** 每經過一站的平均停靠時間（秒）：開關門＋上落客 */
export const DWELL_SECONDS_PER_STOP = 35

/**
 * 實時 ETA 校準的容許誤差：以「上一錨點到此站的幾何車程」按比例放大，
 * 太近的站要求嚴格（避免誤配到前後另一班車），太遠的站放寬（幾何誤差本來就大）。
 * 公式：clamp(車程分鐘 × `LIVE_ETA_MATCH_RATIO`, MIN, MAX)
 */
export const LIVE_ETA_MATCH_RATIO = 0.35

/** 實時 ETA 校準的最小容許誤差（分鐘） */
export const LIVE_ETA_MATCH_MIN_MINUTES = 4

/** 實時 ETA 校準的最大容許誤差（分鐘） */
export const LIVE_ETA_MATCH_MAX_MINUTES = 15

/** 實時 ETA 超過這個時間沒有更新就不再採用（毫秒；約等於兩次 30 秒輪詢） */
export const LIVE_ETA_MAX_AGE_MS = 90000

/** 相鄰兩站之間「同一班車」最少需要的行駛時間（毫秒）：比錨點還早的班次不可能同一班車 */
const MIN_HOP_MS = 60000

/**
 * 配對誤差的權重：幾何推算的 19 km/h 偏保守（通常會高估車程），
 * 因此「比預測早一點」比「比預測晚一點」更可能仍是同一班車，權重調低。
 * （避免在班距小的路線上，被幾何高估牽著配到下一班車。）
 */
const EARLY_DEVIATION_WEIGHT = 0.5

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
 * 在某一站的實時 ETA 中，找出最可能是「基準班次」的那一班。
 *
 * 條件（依序過濾）：
 *   1. 必須晚於錨點（上一個有官方時間的站）至少一分鐘——比錨點還早到的班次一定不是同一班車。
 *   2. 必須還沒過去。
 *   3. 不可晚於幾何預測 + 容許誤差（避免班次資料缺漏時抓到「下一班車」）。
 *   4. 符合條件者取「加權後最接近幾何預測」的一班；比預測早的誤差權重較低
 *      （幾何車速偏保守，容易高估車程）。
 *
 * 單純取「最接近幾何預測」在班距小於容許誤差時會配到下一班車
 * （實測：基準 +3 分、下一站官方 +5／+10／+15 分、幾何預測 +5 分時會誤抓 +10 分）；
 * 單純取「最早」則在上一班車還在前方路段時會配錯，因此改以上述加權規則。
 *
 * @param {{etas?:Array, updatedAt?:number}|undefined} record
 * @param {{anchorArrival:number, predictedArrival:number, deltaMinutes:number, now:number}} context
 * @returns {number|null} 實時到站時間（毫秒）
 */
function pickLiveArrival(record, { anchorArrival, predictedArrival, deltaMinutes, now }) {
  if (!isLiveRecordFresh(record, now) || !Array.isArray(record.etas)) return null
  const tolerance =
    Math.min(
      LIVE_ETA_MATCH_MAX_MINUTES,
      Math.max(LIVE_ETA_MATCH_MIN_MINUTES, deltaMinutes * LIVE_ETA_MATCH_RATIO),
    ) * 60000
  const earliest = anchorArrival + MIN_HOP_MS
  const latest = predictedArrival + tolerance
  let best = null

  for (const eta of record.etas) {
    const time = Date.parse(eta?.time ?? '')
    if (!Number.isFinite(time)) continue
    // 比錨點還早（或幾乎同時）→ 一定是前方的另一班車
    if (time < earliest) continue
    // 已過去的時間不可能再是「預計到達」
    if (time < now - 60000) continue
    // 比幾何預測晚太多 → 較可能是下一班車，寧可沿用幾何推算
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
 * 以基準站的班次時間，推算後續各站的累計車程與預計到達時間。
 *
 * 每一站的演算法：
 *   累計道路里程 = Σ(相鄰站直線距離 × 繞行係數)
 *   車程分鐘     = 累計里程 ÷ 平均車速 + 經過站數 × 停靠時間（四捨五入，最少 1 分）
 *   預計到達     = 基準班次到站時間 + 車程分鐘
 * 若該站有新鮮的實時 ETA 且能配對到同一班車，優先採用實時時間（source = 'live'）。
 *
 * 沒有基準班次時間（`baseTime` 非有限數字）時，只回傳車程分鐘，`arrivalMs` 為 null，
 * UI 會以「+X 分鐘車程」呈現。
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
    }
  }

  const segments = buildSegments(stops)
  const approximate = segments.some((segment) => segment.fallback)

  // 以起算站為原點的累計里程前綴和：prefix[k] = 起算站走到「起算站 + k 站」的估計道路里程
  const prefix = [0]
  for (let index = safeIndex; index < stops.length - 1; index += 1) {
    prefix.push(prefix[prefix.length - 1] + segments[index].meters)
  }
  const metersBetween = (fromIndex, toIndex) =>
    prefix[toIndex - safeIndex] - prefix[fromIndex - safeIndex]

  // 錨點：最近一個「有官方實時時間」的站（沒有就用起算站）。
  // 錨點之後的站以「錨點時間 + 幾何車程」推算，因此上遊的實際延誤會往下游傳遞，
  // 不會出現「前面站誤點、後面站卻變回準時」的矛盾。
  let anchorIndex = safeIndex
  let anchorArrival = hasBaseTime ? baseTime : null
  let previousMinutes = 0
  let previousArrival = hasBaseTime ? baseTime : null
  const entries = []

  for (let index = safeIndex + 1; index < stops.length; index += 1) {
    const deltaMeters = metersBetween(anchorIndex, index)
    const driveMinutes = (deltaMeters / 1000 / AVG_BUS_SPEED_KMH) * 60
    const dwellMinutes = ((index - anchorIndex) * DWELL_SECONDS_PER_STOP) / 60
    const deltaMinutes = Math.max(1, Math.round(driveMinutes + dwellMinutes))

    let arrivalMs = anchorArrival != null ? anchorArrival + deltaMinutes * 60000 : null
    let source = 'geometry'
    let travelMinutes = deltaMinutes

    if (hasBaseTime) {
      // 優先策略：已有實時 ETA 且能配對到同一班車時，直接用官方的遞增時間差
      const liveArrival = pickLiveArrival(liveEtas?.get(String(stops[index].id)), {
        anchorArrival,
        predictedArrival: arrivalMs,
        deltaMinutes,
        now,
      })
      if (liveArrival != null) {
        arrivalMs = liveArrival
        source = 'live'
      }
      // 後面的站不可早於前一站（實時資料抖動或四捨五入都可能造成非遞增）；
      // 被夾回的時間是推算值，不可再標成官方資料
      if (previousArrival != null && arrivalMs <= previousArrival) {
        arrivalMs = previousArrival + 60000
        source = 'geometry'
      }
      // 只有官方實時時間才移動錨點，避免幾何四捨五入誤差逐站累積
      if (source === 'live') {
        anchorIndex = index
        anchorArrival = arrivalMs
      }
      travelMinutes = Math.max(1, Math.round((arrivalMs - baseTime) / 60000))
    }

    if (travelMinutes <= previousMinutes) travelMinutes = previousMinutes + 1
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
  }
}
