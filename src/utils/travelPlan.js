import { distanceInMeters } from '../services/api.js'

/**
 * 車程／預計到達時間推算（類似九巴 App 1933 的「後續各站到達時間」）
 *
 * 策略（由便宜到精確）：
 *   1. 幾何推算（階段 1：路段分級與時段加權模型）：
 *      - 站距分級：長站距（快速公路／隧道，>= 1.6km）、中站距（主幹道，0.6~1.6km）、短站距（密集市區，< 0.6km）
 *        各自套用專屬的繞行係數（1.12 / 1.25 / 1.35）、巡航車速（62 / 30 / 17 km/h）與停站秒數（0 / 28 / 35 秒）。
 *      - 時段加權：早繁／晚繁市區車速降低 20%、停站拉長；深夜車速提高 20%、停站縮短；日間平峰基準 1.0。
 *   2. 實時 ETA 校準（Sequential ETA Matching）：頁面上已展開的站點會取得實時到站時間。
 *      以「上一站到達時間」為基準，同一班車到達下一站的合理區間為：
 *        [上一站 + 最短行車時間, 上一站 + 相鄰路段預計耗時 + 10 分鐘寬鬆容錯]
 *      落在區間內的官方 ETA 視為同一班車；再取加權後最接近預測的一班。
 *   3. 動態路況調節（Dynamic Traffic Ratio）：連續兩個成功配對的官方 ETA（允許中間站缺 ETA，
 *      以累計道路里程計）計算「實際行駛時間 vs 預期行駛時間」的動態路況比率，
 *      扣除區間停站時間後自適應調節後續各種不同等級路段；之後缺少 ETA 的站以動態比率做幾何 fallback。
 *
 * 所有數值都是「估算」：香港市區路況、站距、燈位差異都會影響實際到站時間，
 * UI 一律以「推算／約」呈現，不可當成官方承諾。
 */

/** 香港市區巴士平均行駛速度（km/h）：向後相容預設值 */
export const AVG_BUS_SPEED_KMH = 19

/** 直線距離換算實際道路里程的繞行係數：向後相容預設值 */
export const ROAD_DETOUR_FACTOR = 1.3

/** 每經過一站的平均停靠時間（秒）：向後相容預設值 */
export const DWELL_SECONDS_PER_STOP = 35

/**
 * 站距分級常數（Stage 1 路網分級模型）：
 *   - 市區短站距（< 600m）：多彎道、紅綠燈密集、客量大，繞行 1.35，基礎車速 17 km/h，停靠 35 秒
 *   - 幹道中站距（600m ~ 1600m）：主幹道暢通、路網寬，繞行 1.25，基礎車速 30 km/h，停靠 28 秒
 *   - 高速長站距（>= 1600m）：快速公路、隧道、無中間站，繞行 1.12，基礎車速 62 km/h，停靠 0 秒
 */
export const ROAD_DETOUR_FACTOR_URBAN = 1.35
export const ROAD_DETOUR_FACTOR_ARTERIAL = 1.25
export const ROAD_DETOUR_FACTOR_EXPRESS = 1.12

export const SPEED_URBAN_KMH = 17
export const SPEED_ARTERIAL_KMH = 30
export const SPEED_EXPRESS_KMH = 62

export const DWELL_URBAN_SEC = 35
export const DWELL_ARTERIAL_SEC = 28
export const DWELL_EXPRESS_SEC = 0

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
 * 配對誤差的權重：幾何推算的預設速度偏保守（通常會高估車程），
 * 因此「比預測早一點」比「比預測晚一點」更可能仍是同一班車，權重調低。
 * （避免在班距小的路線上，被幾何高估牽著配到下一班車。）
 */
const EARLY_DEVIATION_WEIGHT = 0.5

/** 動態車速的安全上下限（km/h）：避免實時 ETA 抖動造成離譜車速 */
const DYNAMIC_SPEED_MIN_KMH = 5
const DYNAMIC_SPEED_MAX_KMH = 68

/** 相鄰站點缺少座標時的後備直線距離（公尺）：約為市區平均站距 */
const FALLBACK_STRAIGHT_METERS = 450

/** 缺少座標時的後備道路里程（已套用市區繞行係數） */
const FALLBACK_SEGMENT_METERS = FALLBACK_STRAIGHT_METERS * ROAD_DETOUR_FACTOR_URBAN

function hasCoordinate(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
}

/**
 * 依當前時段取得交通調節係數（時段感知模型）
 *
 * @param {number} [now] 當前時間戳（毫秒）
 * @returns {{speedFactor:number, dwellFactor:number, period:'night'|'morningPeak'|'eveningPeak'|'regular'}}
 */
export function getTimeOfDayTrafficFactor(now = Date.now()) {
  const date = new Date(now)
  const hour = date.getHours() + date.getMinutes() / 60
  const day = date.getDay()
  const isWeekend = day === 0 || day === 6

  // 1. 深夜／清晨暢通時段（23:30 ～ 06:30）：路面無車，車速提升 20%，停站客量少
  if (hour >= 23.5 || hour < 6.5) {
    return { speedFactor: 1.2, dwellFactor: 0.6, period: 'night' }
  }

  // 2. 早繁擁堵時段（平日 07:30 ～ 09:30）：市區與過海嚴重擁堵
  if (!isWeekend && hour >= 7.5 && hour < 9.5) {
    return { speedFactor: 0.8, dwellFactor: 1.2, period: 'morningPeak' }
  }

  // 3. 晚繁擁堵時段（平日 17:30 ～ 19:30）：下班放工高峰
  if (!isWeekend && hour >= 17.5 && hour < 19.5) {
    return { speedFactor: 0.8, dwellFactor: 1.2, period: 'eveningPeak' }
  }

  // 4. 一般日間平峰（離峰）
  return { speedFactor: 1.0, dwellFactor: 1.0, period: 'regular' }
}

/**
 * 沿線各段估計道路里程（公尺）：`segments[k]` 是第 k 站 → 第 k+1 站。
 * 兩端都有座標時依直線距離分級套用繞行係數；缺少座標時以平均市區站距代替並標記 fallback。
 *
 * @param {Array<{lat?:number|null, lng?:number|null}>} stops
 * @returns {Array<{meters:number, straightMeters:number, category:'urban'|'arterial'|'express', fallback:boolean}>}
 */
export function buildSegments(stops = []) {
  const segments = []
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index]
    const to = stops[index + 1]
    const straight = hasCoordinate(from) && hasCoordinate(to) ? distanceInMeters(from, to) : null
    if (Number.isFinite(straight)) {
      let detour = ROAD_DETOUR_FACTOR_URBAN
      let category = 'urban'
      if (straight >= 1600) {
        detour = ROAD_DETOUR_FACTOR_EXPRESS
        category = 'express'
      } else if (straight >= 600) {
        detour = ROAD_DETOUR_FACTOR_ARTERIAL
        category = 'arterial'
      }
      segments.push({
        meters: straight * detour,
        straightMeters: straight,
        category,
        fallback: false,
      })
    } else {
      segments.push({
        meters: FALLBACK_SEGMENT_METERS,
        straightMeters: FALLBACK_STRAIGHT_METERS,
        category: 'urban',
        fallback: true,
      })
    }
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
 * 核心演算法（Stage 1 路網分級 + 時段加權 + Sequential Matching）：
 *   1. 依相鄰路段等級（市區/主幹道/快速公路）決定基準車速（17/30/62 km/h）與停站時間（35/28/0 秒），
 *      並乘上時段係數（早晚繁/離峰/深夜），以「上一站到達 + 相鄰路段耗時」逐站累加。
 *   2. 該站有新鮮實時 ETA、且時間落在「上一站 + 最短行車 ~ 上一站 + 相鄰耗時 + 10 分鐘」
 *      區間內時，視為同一班車並直接採用官方時間（`source = 'live'`）。
 *   3. 連續兩個成功配對的 live 站可計算出動態路況比率 `liveTrafficRatio`，自適應調節
 *      後續所有不同等級的路段，避免單一車速把高速路段與市區街道互相混淆。
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
  const traffic = getTimeOfDayTrafficFactor(now)

  // 即時路況調節比率（由連續 live 站學出「實際純行駛秒數 vs 預期行駛秒數」，預設 1.0）
  let liveTrafficRatio = 1.0
  let dynamicSpeed = false

  // 上一站到達時間（基準站時間或上一次配對／推算結果）
  let previousArrival = hasBaseTime ? baseTime : null
  let previousMinutes = 0
  // 沒有基準班次時間時，改用累計耗時換算車程分鐘
  let accumulatedMs = 0

  // 追蹤最近一次 live ETA 到現在的累積狀態（用以學動態路況比率）
  let lastLiveArrival = hasBaseTime ? baseTime : null
  let expectedDriveSecondsSinceLastLive = 0
  let expectedDwellSecondsSinceLastLive = 0
  let metersSinceLastLive = 0

  const entries = []

  for (let index = safeIndex + 1; index < stops.length; index += 1) {
    const segment = segments[index - 1] ?? {
      meters: FALLBACK_SEGMENT_METERS,
      category: 'urban',
      fallback: true,
    }
    const hopMeters = segment.meters

    // 依據該路段等級（市區/主幹道/快速公路）決定基準車速與停站秒數
    let baseSpeed = SPEED_URBAN_KMH
    let baseDwell = DWELL_URBAN_SEC
    if (segment.category === 'express') {
      baseSpeed = SPEED_EXPRESS_KMH
      baseDwell = DWELL_EXPRESS_SEC
    } else if (segment.category === 'arterial') {
      baseSpeed = SPEED_ARTERIAL_KMH
      baseDwell = DWELL_ARTERIAL_SEC
    }

    // 結合時段係數與實時校準比率（限制在安全上下限之間）
    const effectiveSpeedKmh = Math.min(
      DYNAMIC_SPEED_MAX_KMH,
      Math.max(DYNAMIC_SPEED_MIN_KMH, baseSpeed * traffic.speedFactor * liveTrafficRatio),
    )
    const effectiveDwellSec = baseDwell * traffic.dwellFactor

    const driveMinutes = (hopMeters / 1000 / effectiveSpeedKmh) * 60
    const dwellMinutes = effectiveDwellSec / 60
    const hopMinutes = driveMinutes + dwellMinutes
    const hopMs = Math.max(MIN_HOP_MS, Math.round(hopMinutes * 60000))

    // 預測到達 = 上一站到達 + 相鄰路段耗時
    let arrivalMs = previousArrival != null ? previousArrival + hopMs : null
    let source = 'geometry'
    let travelMinutes

    if (hasBaseTime && previousArrival != null) {
      metersSinceLastLive += hopMeters
      expectedDriveSecondsSinceLastLive += (hopMeters / 1000 / (baseSpeed * traffic.speedFactor)) * 3600
      expectedDwellSecondsSinceLastLive += effectiveDwellSec

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

      // 動態路況比率學習：
      // 當遇到連續成功配對的官方 ETA 時，比較「實際純行車耗時」與「模型預期耗時」，
      // 算出當前路線的擁堵／暢通比率，用以自適應調節後續所有不同路段。
      if (source === 'live') {
        if (
          lastLiveArrival != null &&
          arrivalMs > lastLiveArrival &&
          metersSinceLastLive > 0 &&
          expectedDriveSecondsSinceLastLive > 0
        ) {
          const actualTotalSeconds = (arrivalMs - lastLiveArrival) / 1000
          // 扣除此區間停靠耗時，保底保留 30% 避免負數
          const actualDriveSeconds = Math.max(
            actualTotalSeconds * 0.3,
            actualTotalSeconds - expectedDwellSecondsSinceLastLive,
          )
          // 實時速度比率 = 預期行駛秒數 / 實際行駛秒數（>1 表示比平時快，<1 表示塞車）
          const rawRatio = expectedDriveSecondsSinceLastLive / actualDriveSeconds
          if (Number.isFinite(rawRatio)) {
            // 安全限制在 0.4x（嚴重塞車）到 1.6x（極度順暢）之間
            liveTrafficRatio = Math.min(1.6, Math.max(0.4, rawRatio))
            dynamicSpeed = true
          }
        }
        lastLiveArrival = arrivalMs
        metersSinceLastLive = 0
        expectedDriveSecondsSinceLastLive = 0
        expectedDwellSecondsSinceLastLive = 0
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

  // 計算整段行程的加權有效均速，供 UI Banner 呈現真實有感的平均行車速度
  let weightedSpeedKmh = AVG_BUS_SPEED_KMH
  if (entries.length > 0) {
    const totalMeters = segments
      .slice(safeIndex, stops.length - 1)
      .reduce((sum, seg) => sum + (seg?.meters ?? FALLBACK_SEGMENT_METERS), 0)
    const lastMinutes = entries[entries.length - 1].travelMinutes
    if (lastMinutes > 0) {
      const calcSpeed = (totalMeters / 1000) / (lastMinutes / 60)
      if (Number.isFinite(calcSpeed) && calcSpeed > 0) {
        weightedSpeedKmh = Math.round(Math.min(DYNAMIC_SPEED_MAX_KMH, Math.max(DYNAMIC_SPEED_MIN_KMH, calcSpeed)))
      }
    }
  }

  return {
    baseStop,
    baseIndex: safeIndex,
    baseTime: hasBaseTime ? baseTime : null,
    entries,
    byStopId,
    approximate,
    terminusMinutes: entries.length > 0 ? entries[entries.length - 1].travelMinutes : null,
    speedKmh: weightedSpeedKmh,
    dynamicSpeed,
  }
}
