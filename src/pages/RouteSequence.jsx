import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  MapPin,
  RefreshCw,
  Route as RouteIcon,
  Star,
  TriangleAlert,
} from 'lucide-react'
import EtaSlots from '../components/EtaSlots.jsx'
import OperatorBadge from '../components/OperatorBadge.jsx'
import { EmptyState, ErrorState, StopSkeleton } from '../components/StateViews.jsx'
import { TravelPlanBanner, TravelPlanChips, TravelPlanToggle } from '../components/TravelPlan.jsx'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import useLanguage from '../hooks/useLanguage.js'
import useMapCollapse from '../hooks/useMapCollapse.js'
import {
  distanceInMeters,
  filterByRoute,
  findSiblingStopIds,
  getRouteIndex,
  getRouteStops,
  getStopEtas,
} from '../services/api.js'
import { formatClock } from '../utils/format.js'
import { buildTravelPlan, pickBaseEta } from '../utils/travelPlan.js'

/** 與 useBusData 相同的 30 秒輪詢節奏 */
const REFRESH_INTERVAL = 30000

/** Leaflet 只在站序頁需要，動態載入避免拖慢第一次可互動時間 */
const StopMap = lazy(() => import('../components/StopMap.jsx'))

/** 站名正規化：去掉九巴站牌編號（例如「創紀之城 (KT342)」→「創紀之城」）、空白與大小寫差異 */
function normalizeName(value) {
  return String(value ?? '')
    .replace(/\s*[(（][A-Z0-9]{2,10}[)）]\s*$/i, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase()
}

/** 反向站序中「同一站」的容許距離（公尺）；反向月台通常在馬路對面 */
const SAME_STATION_RADIUS = 200

/**
 * 在站序清單中找回與目前站點相同的站。
 *
 * 1. 正規化站名完全相同（優先）
 * 2. 座標最近且距離在 SAME_STATION_RADIUS 內（反向月台站名可能不同，例如「觀塘轉車站 - 創紀之城」對「創紀之城」）
 * 3. 正規化站名互相包含且唯一（處理「A - B」與「B」這類命名差異）
 *
 * @param {Array} stops 站序清單
 * @param {{name?:string, lat?:number, lng?:number}} target
 * @returns {object|null}
 */
function findMatchingStop(stops, target) {
  if (!stops || stops.length === 0) return null
  const name = normalizeName(target?.name)
  if (name) {
    const exact = stops.find(
      (stop) => normalizeName(stop.nameTc) === name || normalizeName(stop.nameEn) === name,
    )
    if (exact) return exact
  }

  const { lat, lng } = target ?? {}
  let closestStop = null
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let bestDistance = Number.POSITIVE_INFINITY
    for (const stop of stops) {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue
      const distance = distanceInMeters({ lat, lng }, { lat: stop.lat, lng: stop.lng })
      if (distance < bestDistance) {
        bestDistance = distance
        closestStop = stop
      }
    }
    if (closestStop && bestDistance <= SAME_STATION_RADIUS) return closestStop
  }

  if (name.length >= 4) {
    const loose = stops.filter((stop) => {
      const candidate = normalizeName(stop.nameTc)
      return candidate.length >= 4 && (candidate.includes(name) || name.includes(candidate))
    })
    if (loose.length === 1) return loose[0]
  }

  if (closestStop) return closestStop

  return null
}

function directionLabel(direction, t) {
  return direction === 'inbound' ? t('direction.inbound') : t('direction.outbound')
}

/** 站序列 DOM id：scrollIntoView 對齊時使用（站名可能重複，帶 seq 才唯一） */
function stopRowDomId(stop) {
  const id = String(stop?.id ?? '').replace(/[^A-Za-z0-9_-]+/g, '-')
  return `route-stop-${id}-${stop?.seq ?? ''}`
}

/**
 * 在路線索引中找出「同一路線的另一方向」。
 *
 * - 九巴：優先沿用目前 serviceType，其次 serviceType '1'（正線），最後才取第一筆。
 * - 城巴：索引固定有 outbound／inbound 兩筆。
 * - 小巴：同一路線號碼可能有多個 route_id（不同班次描述），先以「起點／終點互換」評分，
 *   再以相同 routeId、相反 routeSeq 加分，選出真正折返的那一條。
 *
 * @param {Array} rows getRouteIndex() 的結果
 * @param {{operator:string, route:string, direction:string, serviceType?:string, routeId?:string|number, routeSeq?:string|number, orig?:string, destination?:string}} current
 * @returns {object|null} 反向的路線索引列
 */
function findReverseRoute(rows, current) {
  const { operator, route, direction, serviceType, routeId, routeSeq, orig, destination } = current
  const opposite = direction === 'inbound' ? 'outbound' : 'inbound'
  const routeCode = String(route ?? '').trim().toUpperCase()
  const candidates = rows.filter(
    (row) => row.operator === operator && row.route === routeCode && row.direction === opposite,
  )
  if (candidates.length === 0) return null

  if (operator === 'KMB') {
    const sameService = candidates.find((row) => String(row.serviceType) === String(serviceType))
    if (sameService) return sameService
    return candidates.find((row) => String(row.serviceType) === '1') ?? candidates[0]
  }

  if (operator === 'GMB') {
    const routeIdValue = routeId == null || routeId === '' ? null : String(routeId)
    const routeSeqValue = routeSeq == null || routeSeq === '' ? null : String(routeSeq)
    const oppositeSeq = routeSeqValue === '1' ? '2' : routeSeqValue === '2' ? '1' : null
    const score = (row) => {
      let value = 0
      // 真正折返的路線：反向的起點就是目前的終點
      if (destination && row.orig && normalizeName(row.orig) === normalizeName(destination)) value += 4
      if (orig && row.destination && normalizeName(row.destination) === normalizeName(orig)) value += 4
      if (routeIdValue && String(row.routeId) === routeIdValue) value += 2
      if (oppositeSeq && String(row.routeSeq) === oppositeSeq) value += 1
      return value
    }
    return [...candidates].sort((a, b) => score(b) - score(a))[0]
  }

  return candidates[0]
}

/**
 * 從同一路線（可能已依目的地拆成多筆）挑出這一站要顯示的 ETA 群組：
 * 優先選「ETA 站序與本站站序相符」的一組（循環線同一站名的兩次經過），其次取第一筆。
 * 回傳 multiple 表示同一方向有多個目的地，面板需加上「往 X」標示。
 *
 * @param {Array} entries filterByRoute 之後的路線群組
 * @param {string} direction outbound／inbound
 * @param {number|string|null} stopSeq 本站站序
 */
function pickEtaEntry(entries, direction, stopSeq) {
  const matched = entries.filter((entry) => entry.direction === direction)
  const destinations = new Set(matched.map((entry) => entry.destination ?? ''))
  const multiple = destinations.size > 1
  if (matched.length === 0) return { entry: null, multiple: false }

  const targetSeq = Number(stopSeq)
  if (Number.isFinite(targetSeq)) {
    const sameSeq = matched.find((entry) =>
      entry.etas.some((eta) => Number(eta.stopSeq) === targetSeq),
    )
    if (sameSeq) return { entry: sameSeq, multiple }
  }
  return { entry: matched[0], multiple }
}

/**
 * 單一站點的最近三班 ETA（30 秒輪詢）。
 *
 * 切換站點時由父層以 key 重新掛載整個面板，舊的請求／計時器會在 cleanup 中取消，
 * 因此不會出現「上一站的班次蓋掉這一站」或背景繼續輪詢的問題。
 *
 * @param {{stop:object, route:string, direction:string, siblingParam?:string, fallbackError?:string}} params
 */
function useStopEtas({ stop, route, direction, siblingParam, fallbackError }) {
  const [state, setState] = useState({
    etas: [],
    destination: '',
    destinationEn: '',
    showDestination: false,
    loading: true,
    updating: false,
    error: null,
    updatedAt: null,
  })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!stop) return undefined

    let cancelled = false
    let timer = null

    const load = async ({ silent }) => {
      setState((prev) => ({
        ...prev,
        loading: !silent && prev.updatedAt == null,
        updating: silent || prev.updatedAt != null,
        error: null,
      }))

      try {
        // 城巴必須帶 routes:[route] 才查得到；九巴／小巴會忽略 routes 並使用 siblingIds 合併月台
        const entries = await getStopEtas({
          operator: stop.operator,
          id: stop.id,
          seq: stop.seq,
          routes: [route],
          siblingIds: siblingParam ? siblingParam.split(',') : [],
        })
        if (cancelled) return
        const { entry: matched, multiple } = pickEtaEntry(
          filterByRoute(entries, route),
          direction,
          stop.seq,
        )
        // 合併同名月台後，同一群組可能仍混合兩個站序（幾何條件不成立而未拆分時）；
        // 這一站的面板只顯示本站站序的班次，避免把反方向的車混進來
        let etas = matched?.etas ?? []
        const targetSeq = Number(stop.seq)
        if (Number.isFinite(targetSeq) && new Set(etas.map((eta) => eta.stopSeq)).size > 1) {
          const ownSeq = etas.filter((eta) => Number(eta.stopSeq) === targetSeq)
          if (ownSeq.length > 0) etas = ownSeq
        }
        setState({
          etas: etas.slice(0, 3),
          destination: matched?.destination ?? '',
          destinationEn: matched?.destinationEn ?? '',
          showDestination: multiple,
          loading: false,
          updating: false,
          error: null,
          updatedAt: Date.now(),
        })
      } catch (error) {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          loading: false,
          updating: false,
          error: error?.message ?? fallbackError,
        }))
      }

      if (!cancelled) timer = setTimeout(() => load({ silent: true }), REFRESH_INTERVAL)
    }

    load({ silent: false })

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [stop, route, direction, siblingParam, reloadToken, fallbackError])

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  return { ...state, refresh }
}

/**
 * 展開某站時顯示的最近三班車＋資料更新時間
 *
 * 開啟「推算各站到站時間」模式時，ETA 格會變成按鈕（點擊即把該班車設為推算基準）；
 * 同時透過 `onEtasChange` 把本站的實時 ETA 回報給頁面，下游各站推算時可優先參考
 * 官方同一班車的遞增時間，不必再額外發請求。
 *
 * @param {object} props
 * @param {string} props.id 面板 DOM id（aria-controls 用）
 * @param {object} props.stop 站點
 * @param {string} props.route 路線號碼
 * @param {string} props.direction outbound／inbound
 * @param {string[]} props.siblingIds 同站其他月台 id
 * @param {boolean} [props.planSelectable] ETA 格是否可點擊切換推算基準
 * @param {number|null} [props.planSelectedIndex] 目前基準班次索引
 * @param {(index:number) => void} [props.onSelectEta] 點擊 ETA 格
 * @param {(stopId:string, record:{etas:Array, updatedAt:number}|null) => void} [props.onEtasChange]
 *        回報本站實時 ETA；收合時以 null 移除
 */
function StopEtaPanel({
  id,
  stop,
  route,
  direction,
  siblingIds,
  planSelectable = false,
  planSelectedIndex = null,
  onSelectEta,
  onEtasChange,
}) {
  const { t, pickLang } = useLanguage()
  const {
    etas,
    destination,
    destinationEn,
    showDestination,
    loading,
    updating,
    error,
    updatedAt,
    refresh,
  } = useStopEtas({
    stop,
    route,
    direction,
    siblingParam: siblingIds.join(','),
    fallbackError: t('route.etaError'),
  })

  // 把最新的實時 ETA 往上回報（只在資料真的變動時觸發，不會無限迴圈）
  useEffect(() => {
    if (!onEtasChange) return
    onEtasChange(stop.id, { etas, updatedAt, loading, error })
  }, [onEtasChange, stop.id, etas, updatedAt, loading, error])

  // 面板收合／換站時清掉，避免推算用到已不在畫面上的舊資料
  useEffect(() => {
    if (!onEtasChange) return undefined
    const stopId = stop.id
    return () => onEtasChange(stopId, null)
  }, [onEtasChange, stop.id])

  return (
    <div
      id={id}
      className="animate-fade-in mb-1 mt-1.5 rounded-xl bg-white px-2 pb-1.5 pt-2 ring-1 ring-inset ring-slate-100 dark:bg-slate-900 dark:ring-slate-800"
    >
      {loading ? (
        <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
          <div className="skeleton h-11" />
          <div className="skeleton h-11" />
          <div className="skeleton h-11" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="chip shrink-0 bg-white px-2 py-0.5 text-rose-600 transition hover:bg-rose-100 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <EtaSlots
            etas={etas}
            selectable={planSelectable}
            selectedIndex={planSelectedIndex}
            onSelect={onSelectEta}
            destination={pickLang(destination, destinationEn)}
            showDestination={showDestination}
          />
          {etas.length === 0 && (
            <p className="mt-1.5 px-1 text-xs text-slate-500 dark:text-slate-400">
              {t('route.noEta')}
            </p>
          )}
        </>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-xs text-slate-400 dark:text-slate-500">
        <span>
          {updatedAt
            ? t('route.updated', { time: formatClock(updatedAt) })
            : t('route.loadingEta')}
        </span>
        <button
          type="button"
          onClick={refresh}
          aria-label={t('route.refreshAria')}
          title={t('common.refresh')}
          className="rounded-full p-0.5 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <RefreshCw className={`h-3 w-3 ${updating ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * 路線站序頁（原視窗導覽）
 *
 * 所有狀態都來自 URL（路徑的 operator／route／direction 與 query 的 stop／name／
 * siblings／serviceType／routeId／routeSeq／orig／dest），因此可直接分享、重新整理，
 * 反轉方向也是以 replace 導覽更新 URL，不依賴前一個視窗的 React state。
 */

/**
 * 背景監聽推算基準站的 ETA：
 * 當推算開啟、且使用者展開其他站時，手風琴會將基準站收合。
 * 此元件在背景持續 30 秒輪詢基準站，確保推算時間原點不中斷、不逾期。
 */
function PlanBaseEtaWatcher({ stop, route, direction, siblingIds, onEtasChange }) {
  const { t } = useLanguage()
  const { etas, updatedAt, loading, error } = useStopEtas({
    stop,
    route,
    direction,
    siblingParam: siblingIds.join(','),
    fallbackError: t('route.etaError'),
  })

  useEffect(() => {
    if (!stop?.id) return
    onEtasChange(stop.id, { etas, updatedAt, loading, error })
  }, [stop?.id, etas, updatedAt, loading, error, onEtasChange])

  return null
}

export default function RouteSequence() {
  const { operator, route, direction } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t, pickLang } = useLanguage()

  const stopParam = searchParams.get('stop') ?? ''
  const nameParam = searchParams.get('name') ?? ''
  const siblingsParam = searchParams.get('siblings') ?? ''
  const serviceType = searchParams.get('serviceType') ?? '1'
  const routeId = searchParams.get('routeId') ?? ''
  const routeSeq = searchParams.get('routeSeq') ?? ''
  const origParam = searchParams.get('orig') ?? ''
  const destParam = searchParams.get('dest') ?? ''
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const coordLat = latParam != null && latParam !== '' ? Number(latParam) : undefined
  const coordLng = lngParam != null && lngParam !== '' ? Number(lngParam) : undefined
  const directionValue = direction === 'inbound' ? 'inbound' : 'outbound'
  const isGmb = operator === 'GMB'
  const isGmbMissingMeta = isGmb && (!routeId || !routeSeq)

  // 來源站比對：query 的 stop 與 siblings 都比對站點 ID，九巴同站不同月台也能高亮
  const highlightedIds = useMemo(() => {
    const siblings = siblingsParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    return new Set([stopParam, ...siblings].filter(Boolean))
  }, [stopParam, siblingsParam])

  const [stops, setStops] = useState([])
  const [stopsStatus, setStopsStatus] = useState('loading')
  const [stopsError, setStopsError] = useState(null)
  const [stopsReloadToken, setStopsReloadToken] = useState(0)
  const [reverseStatus, setReverseStatus] = useState('idle')
  const [reverseError, setReverseError] = useState(null)
  const { favorites, toggleFavorite, isFavoriteRoute, toggleFavoriteRoute } = useFavorites()
  const favoriteKeys = useMemo(() => new Set(favorites.map(favoriteKey)), [favorites])
  // 手風琴：同一時間只有一個站點展開（expandedStopId）。初始值為來源站，
  // 沒有來源站時預設展開第一站；URL 的 stop 只作「來源站」高亮／分享與重新載入的依據。
  const [expandedStopId, setExpandedStopId] = useState(null)
  // 「推算各站到站時間」模式：以某一站某一班車為基準，推算後續各站的車程與預計到達時間
  const [planEnabled, setPlanEnabled] = useState(false)
  const [planBaseStopId, setPlanBaseStopId] = useState(null)
  const [planEtaIndex, setPlanEtaIndex] = useState(0)
  // 各站已取得的實時 ETA（由展開中的站點面板回報）；推算時優先參考同一班車的遞增時間
  const [liveEtasByStopId, setLiveEtasByStopId] = useState(() => new Map())
  const listRef = useRef(null)
  const sourceRef = useRef(null)
  // 全線軌跡地圖：focusedStopId 為 null 時顯示全線，點選站點後聚焦該站
  const [focusedStopId, setFocusedStopId] = useState(null)
  const { collapsed, toggleCollapse, handleScroll, resetCollapse } = useMapCollapse()
  // 站序載入後會用程式把來源站捲到清單中央，那次 scroll 不應觸發地圖收起
  const ignoreNextListScrollRef = useRef(false)

  // 站序載入完成時要用「當下」的 URL 參數找回來源站；以 ref 保存可避免把 stop／name
  // 變成站序請求的依賴（否則每次點站點更新 URL 都會重新抓一次全線站序）。
  const urlParamsRef = useRef({ nameParam: '', highlightedIds: new Set(), lat: undefined, lng: undefined })
  useEffect(() => {
    urlParamsRef.current = { nameParam, highlightedIds, lat: coordLat, lng: coordLng }
  }, [nameParam, highlightedIds, coordLat, coordLng])

  // 取得全線站序；小巴缺少 routeId/routeSeq 時直接顯示可理解的錯誤
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setStopsStatus('loading')
      setStopsError(null)
      try {
        if (!operator || !route) throw new Error(t('route.missingParams'))
        if (isGmbMissingMeta) {
          throw new Error(t('route.gmbMissing'))
        }
        const list = await getRouteStops({
          operator,
          route,
          direction: directionValue,
          serviceType,
          routeId: routeId || undefined,
          routeSeq: routeSeq || undefined,
        })
        if (cancelled) return
        setStops(list)
        setStopsStatus('ready')

        // 反轉方向／重新載入站序時，優先展開新方向找回的來源站（收藏頁聚焦站點），
        // 找不到就預設展開第一站。
        const { nameParam: currentName, highlightedIds: currentHighlightedIds } = urlParamsRef.current
        const matchedStop =
          list.find((stop) => currentHighlightedIds.has(stop.id)) ??
          findMatchingStop(list, { name: currentName })
        setExpandedStopId(matchedStop?.id ?? list[0]?.id ?? null)
      } catch (error) {
        if (cancelled) return
        setStops([])
        setExpandedStopId(null)
        setStopsStatus('error')
        setStopsError(error?.message ?? t('route.loadError'))
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [operator, route, directionValue, serviceType, routeId, routeSeq, stopsReloadToken, isGmbMissingMeta, t])

  // 來源站：以 URL 的 stop／siblings 比對站點 ID，反轉方向後改以正規化站名／座標找回。
  // 「本站」chip 與 sky 高亮只標示這一站；其他已展開的站不會被搶走高亮。
  const activeStop = useMemo(() => {
    if (stops.length === 0) return null
    const byId = stops.find((stop) => highlightedIds.has(stop.id))
    if (byId) return byId
    return findMatchingStop(stops, { name: nameParam, lat: coordLat, lng: coordLng })
  }, [stops, highlightedIds, nameParam, coordLat, coordLng])

  const activeStopId = activeStop?.id ?? null

  // 來源站若由多個月台合併（siblings），展開它的 ETA 時要帶上其他月台 ID，
  // 九巴合併月台才查得準；其他點開的站只知道自己的 ID。
  const activeSiblingIds = useMemo(() => {
    if (!activeStop) return []
    return [...highlightedIds].filter((id) => id && id !== activeStop.id)
  }, [activeStop, highlightedIds])

  // 循環線同名站出現兩次時，每一列查 ETA 都要帶上同日同名月台才能拆出方向
  const siblingIdsByStopId = useMemo(
    () => (isGmb ? new Map() : findSiblingStopIds(stops)),
    [stops, isGmb],
  )

  /* ---------------------------------------------------------------- */
  /* 推算各站到站時間（App 1933 風格）                                 */
  /* ---------------------------------------------------------------- */

  // 推算基準站：使用者點過的站優先 → 來源站（本站）→ 全線第一站
  const planBaseStop = useMemo(() => {
    if (stops.length === 0) return null
    if (planBaseStopId != null) {
      const picked = stops.find((stop) => String(stop.id) === String(planBaseStopId))
      if (picked) return picked
    }
    return activeStop ?? stops[0]
  }, [stops, planBaseStopId, activeStop])

  const planBaseIndex = planBaseStop
    ? stops.findIndex((stop) => String(stop.id) === String(planBaseStop.id))
    : -1

  // 以「最近一次 ETA 更新時間」當作現在：避免在 render 期間呼叫 Date.now()，
  // 也讓推算結果跟畫面上的資料同步（每 30 秒輪詢就會更新一次）。
  const liveNow = useMemo(() => {
    let latest = 0
    for (const record of liveEtasByStopId.values()) {
      if (Number.isFinite(record?.updatedAt)) latest = Math.max(latest, record.updatedAt)
    }
    return latest
  }, [liveEtasByStopId])

  // 基準班次：該站最近三班中，被選中的那一班（同時附上被夾回後的實際索引）
  const planBase = useMemo(
    () =>
      planBaseStop
        ? pickBaseEta(liveEtasByStopId.get(String(planBaseStop.id)), planEtaIndex, liveNow)
        : null,
    [planBaseStop, liveEtasByStopId, planEtaIndex, liveNow],
  )

  // 基準站的實時 ETA 是否還在載入（用來顯示「正在取得基準班次」而不是「暫無班次」）
  const planBaseRecord = planBaseStop ? liveEtasByStopId.get(String(planBaseStop.id)) : null
  const planBaseLoading = Boolean(planBaseRecord?.loading) && planBase == null

  // 後續各站的累計車程與預計到達時間（沒有實時班次時只算車程）
  const travelPlan = useMemo(() => {
    if (!planEnabled || !planBaseStop) return null
    return buildTravelPlan({
      stops,
      baseIndex: planBaseIndex,
      baseTime: planBase?.time ?? null,
      liveEtas: liveEtasByStopId,
      now: liveNow,
      operator,
      route,
      direction: directionValue,
    })
  }, [planEnabled, planBaseStop, planBaseIndex, planBase, stops, liveEtasByStopId, liveNow, operator, route, directionValue])

  // 回報某一站的最新實時 ETA（收合站點時 record 為 null）
  const handleEtasChange = useCallback((stopId, record) => {
    const key = String(stopId)
    setLiveEtasByStopId((prev) => {
      if (!record) {
        // 若該站是開啟推算中的基準站，保留其最新 ETA，避免因展開其他站而被清空
        if (planEnabled && planBaseStop != null && String(planBaseStop.id) === key) {
          return prev
        }
        if (!prev.has(key)) return prev
        const next = new Map(prev)
        next.delete(key)
        return next
      }
      const next = new Map(prev)
      next.set(key, record)
      return next
    })
  }, [planEnabled, planBaseStop])

  // 點擊任一站點的班次：以「那一站的這一班」為推算基準（並自動開啟推算模式）
  const handleSelectPlanEta = useCallback((stop, index) => {
    setPlanEnabled(true)
    setPlanBaseStopId(stop.id)
    setPlanEtaIndex(index)
  }, [])

  // 開啟推算模式時先展開基準站，才能取得它的最近三班 ETA 作為基準
  const togglePlanMode = useCallback(() => {
    if (planEnabled) {
      setPlanEnabled(false)
      setLiveEtasByStopId((prev) => {
        if (expandedStopId == null) return new Map()
        const currentExpandedKey = String(expandedStopId)
        const record = prev.get(currentExpandedKey)
        const next = new Map()
        if (record) next.set(currentExpandedKey, record)
        return next
      })
      return
    }
    setPlanEnabled(true)
    const baseId = planBaseStop?.id
    if (baseId == null) return
    setPlanBaseStopId((current) => current ?? baseId)
    setExpandedStopId((current) => current ?? baseId)
  }, [expandedStopId, planBaseStop, planEnabled])

  // 站序載入後把來源站捲到清單中央（只改 scrollTop，避免 scrollIntoView 讓整頁跳動）
  const stopsSignature = `${stops.length}|${stops[0]?.id ?? ''}|${stops[stops.length - 1]?.id ?? ''}`
  useEffect(() => {
    const list = listRef.current
    const item = sourceRef.current
    if (!list || !item) return
    const target = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2)
    // 這是程式捲動（把來源站置中），標記起來避免觸發地圖自動收起；
    // 若目標位置與目前相同（例如來源站就是第一站）就不會觸發 scroll，不必標記。
    if (Math.abs(list.scrollTop - target) > 1) {
      ignoreNextListScrollRef.current = true
      list.scrollTop = target
    }
  }, [stopsSignature])

  const firstStop = stops[0]
  const lastStop = stops[stops.length - 1]
  const headerOrig =
    pickLang(firstStop?.nameTc, firstStop?.nameEn) || origParam || ''
  const headerDest =
    pickLang(lastStop?.nameTc, lastStop?.nameEn) || destParam || ''

  // 收藏路線用：以目前方向／服務類型作唯一鍵，並附上來源站（若有）方便下次直接展開
  const favoriteRouteEntry = useMemo(
    () => ({
      operator,
      route,
      direction: directionValue,
      serviceType,
      routeId: routeId || null,
      routeSeq: routeSeq || null,
      orig: firstStop?.nameTc || origParam || '',
      origEn: firstStop?.nameEn || '',
      destination: lastStop?.nameTc || destParam || '',
      destinationEn: lastStop?.nameEn || '',
      stop: activeStop
        ? {
            id: activeStop.id,
            nameTc: activeStop.nameTc ?? '',
            nameEn: activeStop.nameEn ?? '',
            lat: activeStop.lat ?? null,
            lng: activeStop.lng ?? null,
            siblingIds: activeSiblingIds,
          }
        : null,
    }),
    [
      operator,
      route,
      directionValue,
      serviceType,
      routeId,
      routeSeq,
      firstStop,
      lastStop,
      origParam,
      destParam,
      activeStop,
      activeSiblingIds,
    ],
  )
  const isRouteFavorite = isFavoriteRoute(favoriteRouteEntry)

  useEffect(() => {
    if (!route) return undefined
    const previous = document.title
    const directionText = directionLabel(directionValue, t)
    const towardDestination = headerDest ? ` ${t('route.to', { dest: headerDest })}` : ''
    document.title = `${route} ${directionText}${towardDestination}｜${t('route.title')}`
    return () => {
      document.title = previous
    }
  }, [route, directionValue, headerDest, t])

  const retryStops = useCallback(() => setStopsReloadToken((token) => token + 1), [])

  // 點站點列：手風琴式切換（同一時間只展開一站）。
  // 展開時讓置頂地圖回到完整高度，並把該列平滑對齊到清單頂端（地圖下方），
  // 之後使用者繼續往下滑，useMapCollapse 的縮小邏輯仍會照常觸發。
  // URL 的 stop／name 仍會 replace 更新（分享／重新整理用）。
  const handleToggleStop = useCallback(
    (stop) => {
      // 點選任一站點時，置頂地圖立即聚焦該站（可再按「顯示全線軌跡」回到全線）
      setFocusedStopId(stop.id)
      const isExpanded = expandedStopId === stop.id
      setExpandedStopId(isExpanded ? null : stop.id)

      if (!isExpanded) {
        resetCollapse()
        window.requestAnimationFrame(() => {
          document
            .getElementById(stopRowDomId(stop))
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }

      const next = new URLSearchParams(searchParams)
      if (!isExpanded) {
        // 展開：URL 記錄最後打開的站，方便分享給朋友直接看到這一站
        next.set('stop', stop.id)
        next.set('name', stop.nameTc || stop.nameEn || stop.id)
        next.delete('siblings')
      } else if ((searchParams.get('stop') ?? '') === stop.id) {
        // 收合的是 URL 指向的站：清掉 URL 的 stop／name（重新整理時不會再展開）
        next.delete('stop')
        next.delete('name')
        next.delete('siblings')
      } else {
        // 收合的不是 URL 指向的站：URL 不用變
        return
      }

      navigate({ search: next.toString() ? `?${next.toString()}` : '' }, { replace: true })
    },
    [expandedStopId, navigate, resetCollapse, searchParams],
  )

  // 站序清單內部捲動 → 地圖縮小 1/3（忽略程式置中那次 scroll）
  const handleListScroll = useCallback(
    (event) => {
      if (ignoreNextListScrollRef.current) {
        ignoreNextListScrollRef.current = false
        return
      }
      handleScroll(event)
    },
    [handleScroll],
  )

  // 點地圖圖釘：聚焦該站；左上角「顯示全線軌跡」可清除
  const handleMapSelectStop = useCallback((stop) => setFocusedStopId(stop.id), [])
  const clearMapFocus = useCallback(() => setFocusedStopId(null), [])

  // 反轉方向：以路線索引找出另一方向，更新 URL（replace），沿用站名讓新方向自動展開同一站
  const handleReverse = useCallback(async () => {
    if (reverseStatus === 'loading') return
    setReverseStatus('loading')
    setReverseError(null)
    try {
      const rows = await getRouteIndex()
      const target = findReverseRoute(rows, {
        operator,
        route,
        direction: directionValue,
        serviceType,
        routeId,
        routeSeq,
        orig: headerOrig,
        destination: headerDest,
      })
      if (!target) {
        setReverseStatus('error')
        setReverseError(t('route.reverseNotFound', { route }))
        return
      }

      // 反向站序的站點 ID 通常不同：先抓反向站序，以站名／座標找回同一站，
      // 比對結果寫回 URL 的 stop，重新整理或分享後仍可還原高亮與展開。
      const currentStop =
        stops.find((s) => s.id === expandedStopId) ?? activeStop ?? stops[0]
      const currentStopName =
        currentStop?.nameTc || currentStop?.nameEn || nameParam
      const currentLat = currentStop?.lat
      const currentLng = currentStop?.lng

      let matchedStop = null
      try {
        const reverseStops = await getRouteStops({
          operator,
          route: target.route,
          direction: target.direction,
          serviceType: target.serviceType ?? '1',
          routeId: target.routeId,
          routeSeq: target.routeSeq,
        })
        matchedStop = findMatchingStop(reverseStops, {
          name: currentStopName,
          lat: currentLat,
          lng: currentLng,
        })
      } catch {
        // 反向站序暫時載入失敗：仍切換方向，由頁面顯示錯誤與重試
      }

      const next = new URLSearchParams()
      if (matchedStop?.id) next.set('stop', matchedStop.id)
      const stopName =
        matchedStop?.nameTc || matchedStop?.nameEn || currentStopName
      if (stopName) next.set('name', stopName)
      if (Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
        next.set('lat', String(currentLat))
        next.set('lng', String(currentLng))
      }
      if (target.serviceType) next.set('serviceType', target.serviceType)
      if (target.routeId != null) next.set('routeId', target.routeId)
      if (target.routeSeq != null) next.set('routeSeq', target.routeSeq)
      if (target.orig) next.set('orig', target.orig)
      if (target.destination) next.set('dest', target.destination)

      const pathname = `/route/${encodeURIComponent(operator)}/${encodeURIComponent(target.route)}/${target.direction}`
      // 換方向後地圖回到全線總覽、高度也回到展開狀態
      setFocusedStopId(null)
      resetCollapse()
      navigate(
        { pathname, search: next.toString() ? `?${next.toString()}` : '' },
        { replace: true },
      )
      setReverseStatus('idle')
    } catch (error) {
      setReverseStatus('error')
      setReverseError(error?.message ?? t('route.indexError'))
    }
  }, [
    activeStop,
    expandedStopId,
    stops,
    directionValue,
    headerDest,
    headerOrig,
    nameParam,
    navigate,
    operator,
    reverseStatus,
    route,
    routeId,
    routeSeq,
    serviceType,
    t,
    resetCollapse,
  ])

  // 「返回」：站內已改為原視窗導覽，因此直接用 Router 返回上一頁，
  // 不再處理 window.opener／window.close()（新視窗早已不存在）。
  // - 由站點卡切換過來：history 有上一筆（idx > 0 或 length > 1）→ navigate(-1)，
  //   回到原頁面並保留它原本的捲動與展開狀態。
  // - 直接貼網址／重新整理開啟：沒有上一頁 → 導回首頁。
  const handleBack = useCallback(() => {
    const historyIndex = Number(window.history.state?.idx)
    const canGoBack =
      (Number.isFinite(historyIndex) && historyIndex > 0) || window.history.length > 1
    if (canGoBack) {
      navigate(-1)
      return
    }
    navigate('/')
  }, [navigate])

  // 切換站內頁面（含反轉方向造成的 route／direction 變更）時一律捲回頂部，
  // 不沿用上一頁或上一個方向的捲動位置。
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [operator, route, directionValue])

  const isReversing = reverseStatus === 'loading'

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-sky-100 via-sky-50 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/90">
      <header className="sticky top-0 z-20 shrink-0 px-3 pt-2">
        <div className="mx-auto w-full max-w-lg rounded-[22px] border border-white/80 bg-white/85 px-3 py-2.5 shadow-sm backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-800/80">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={handleBack}
              aria-label={t('route.backAria')}
              title={t('route.back')}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('route.back')}
            </button>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="text-xl font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
                  {route || t('route.title')}
                </span>
                <OperatorBadge operator={operator} />
                <span className="chip bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  {directionLabel(directionValue, t)}
                </span>
                {stopsStatus === 'ready' && stops.length > 0 && (
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    · {t('common.stops', { n: stops.length })}
                  </span>
                )}
              </p>
              <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                <RouteIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {headerOrig || t('route.origin')} → {headerDest || t('route.destination')}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('route.refreshNote')}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleFavoriteRoute(favoriteRouteEntry)}
                aria-label={
                  isRouteFavorite ? t('route.unfavoriteRoute') : t('route.favoriteRoute')
                }
                aria-pressed={isRouteFavorite}
                title={isRouteFavorite ? t('route.unfavoriteRoute') : t('route.favoriteRoute')}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-slate-400 shadow-sm ring-1 ring-inset ring-slate-200 transition hover:text-amber-500 dark:bg-slate-900/70 dark:text-slate-300 dark:ring-slate-700"
              >
                <Star
                  className={`h-4 w-4 ${isRouteFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={handleReverse}
                disabled={isReversing}
                className="chip shrink-0 bg-sky-600 px-2.5 py-1 text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-400"
              >
                {isReversing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isReversing ? t('route.reversing') : t('route.reverse')}
              </button>
            </div>
          </div>
        </div>
      </header>

      {reverseError && (
        <div className="mx-auto w-full max-w-lg shrink-0 px-3 pt-2">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{reverseError}</span>
            <button
              type="button"
              onClick={handleReverse}
              className="chip shrink-0 bg-white px-2 py-0.5 text-amber-700 transition hover:bg-amber-100 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {t('common.retry')}
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-2 px-3 py-2.5">
        {stopsStatus === 'loading' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StopSkeleton rows={6} />
          </div>
        )}

        {stopsStatus === 'error' && (
          <ErrorState
            title={isGmbMissingMeta ? t('route.missingMetaTitle') : t('route.loadTitle')}
            message={stopsError}
            onRetry={isGmbMissingMeta ? undefined : retryStops}
          />
        )}

        {stopsStatus === 'ready' && stops.length === 0 && (
          <EmptyState title={t('route.emptyTitle')} description={t('route.emptyDesc')} />
        )}

        {stopsStatus === 'ready' && stops.length > 0 && (
          <>
            {/* 全線軌跡地圖固定在站序清單上方（清單本身滾動，地圖不會被捲走） */}
            <div className="sticky top-0 z-10 shrink-0">
              <Suspense
                fallback={
                  <div className="skeleton h-[210px] w-full rounded-[22px]" aria-hidden="true" />
                }
              >
                <StopMap
                  routeStops={stops}
                  focusedStopId={focusedStopId}
                  onClearFocus={clearMapFocus}
                  onSelectStop={handleMapSelectStop}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                />
              </Suspense>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 px-1">
              <span className="flex min-w-0 items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {t('route.stopsLabel', { n: stops.length })}
                </span>
              </span>
              <TravelPlanToggle active={planEnabled} onClick={togglePlanMode} />
            </div>

            {planEnabled && travelPlan && (
              <TravelPlanBanner
                plan={travelPlan}
                etaLabel={t('plan.etaLabel', { n: (planBase?.index ?? 0) + 1 })}
                baseLoading={planBaseLoading}
                className="shrink-0"
              />
            )}

            {planEnabled && planBaseStop && expandedStopId !== planBaseStop.id && (
              <PlanBaseEtaWatcher
                stop={planBaseStop}
                route={route}
                direction={directionValue}
                siblingIds={
                  planBaseStop.id === activeStopId
                    ? activeSiblingIds
                    : (siblingIdsByStopId.get(String(planBaseStop.id)) ?? [])
                }
                onEtasChange={handleEtasChange}
              />
            )}

            <ol
              ref={listRef}
              onScroll={handleListScroll}
              aria-label={t('route.full')}
              className="card relative min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5"
            >
              {stops.map((stop) => {
                const isExpanded = expandedStopId === stop.id
                const isSource = activeStopId === stop.id
                const isFavorite = favoriteKeys.has(favoriteKey(stop))
                // 同一站名在循環線出現兩次時（例如順天總站 seq8／seq18），
                // 兩列是不同的站牌 ID 或站序，DOM id／key 要帶上 seq 才不會重複
                const panelId = `stop-eta-${String(stop.id).replace(/[^A-Za-z0-9_-]+/g, '-')}-${stop.seq ?? ''}`
                const siblingIds = [
                  ...new Set([
                    ...(isSource ? activeSiblingIds : []),
                    ...(siblingIdsByStopId.get(String(stop.id)) ?? []),
                  ]),
                ].filter((id) => id && id !== stop.id)
                const planEntry = travelPlan?.byStopId.get(String(stop.id)) ?? null
                const isPlanBase =
                  planEnabled && planBaseStop != null && String(planBaseStop.id) === String(stop.id)
                return (
                  <li
                    key={`${stop.id}-${stop.seq}`}
                    id={stopRowDomId(stop)}
                    ref={isSource ? sourceRef : null}
                    className="scroll-mt-2"
                  >
                    <div
                      className={`flex items-center gap-0.5 rounded-xl pr-1 transition ${
                        isExpanded
                          ? 'bg-sky-50 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/30'
                          : isSource
                            ? 'bg-sky-50/60 ring-1 ring-inset ring-sky-100 dark:bg-sky-500/5 dark:ring-sky-500/20'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleStop(stop)}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 pl-2 pr-0.5 text-left"
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                            isExpanded || isSource
                              ? 'bg-sky-600 text-white dark:bg-sky-500'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {stop.seq}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-lg ${
                              isExpanded
                                ? 'font-semibold text-sky-900 dark:text-sky-100'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {pickLang(stop.nameTc, stop.nameEn) || stop.id}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                            {isExpanded ? t('route.next3') : t('route.viewNext3')}
                            {isSource && (
                              <span className="chip bg-sky-600 px-1.5 py-0 text-[11px] text-white dark:bg-sky-500">
                                {t('route.current')}
                              </span>
                            )}
                          </span>
                          {(isPlanBase || planEntry) && (
                            <span className="mt-1 flex flex-wrap items-center gap-1">
                              {isPlanBase ? (
                                <span className="chip bg-sky-600 px-1.5 py-0 text-[9px] text-white dark:bg-sky-500">
                                  {travelPlan?.baseTime != null
                                    ? t('route.planBaseArrival', {
                                        time: formatClock(travelPlan.baseTime),
                                      })
                                    : planBaseLoading
                                      ? t('route.planBaseLoading')
                                      : t('route.planBaseNone')}
                                </span>
                              ) : (
                                <TravelPlanChips entry={planEntry} />
                              )}
                            </span>
                          )}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleFavorite(stop)}
                        aria-label={isFavorite ? t('stop.unfavorite') : t('stop.favorite')}
                        aria-pressed={isFavorite}
                        title={isFavorite ? t('stop.unfavorite') : t('stop.favorite')}
                        className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-white/70 hover:text-amber-500 dark:text-slate-500 dark:hover:bg-slate-700/60"
                      >
                        <Star
                          className={`h-4 w-4 ${
                            isFavorite ? 'fill-amber-400 text-amber-400' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleStop(stop)}
                        aria-label={
                          isExpanded ? t('route.collapseStop') : t('route.expandStop')
                        }
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-white/70 hover:text-sky-600 dark:hover:bg-slate-700/60"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            isExpanded ? 'rotate-180 text-sky-500' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>

                    {isExpanded && (
                      <StopEtaPanel
                        key={`${stop.operator}:${stop.id}:${stop.seq ?? ''}`}
                        id={panelId}
                        stop={stop}
                        route={route}
                        direction={directionValue}
                        siblingIds={siblingIds}
                        planSelectable={planEnabled}
                        planSelectedIndex={isPlanBase ? (planBase?.index ?? null) : null}
                        onSelectEta={(index) => handleSelectPlanEta(stop, index)}
                        onEtasChange={handleEtasChange}
                      />
                    )}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </main>

      <footer className="shrink-0 border-t border-white/60 bg-white/60 px-3 py-1.5 text-center text-[10px] text-slate-400 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/60 dark:text-slate-500">
        {t('route.source')}
      </footer>
    </div>
  )
}
