import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  ExternalLink,
  MapPin,
  RefreshCw,
  Route as RouteIcon,
  Star,
  TriangleAlert,
} from 'lucide-react'
import EtaSlots from '../components/EtaSlots.jsx'
import OperatorBadge from '../components/OperatorBadge.jsx'
import { EmptyState, ErrorState, StopSkeleton } from '../components/StateViews.jsx'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import {
  distanceInMeters,
  filterByRoute,
  getRouteIndex,
  getRouteStops,
  getStopEtas,
} from '../services/api.js'
import { formatClock } from '../utils/format.js'

/** 與 useBusData 相同的 30 秒輪詢節奏 */
const REFRESH_INTERVAL = 30000
/** 首頁網址（子路徑部署時由 Vite 的 BASE_URL 提供） */
const HOME_URL = import.meta.env.BASE_URL

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
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const stop of stops) {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue
      const distance = distanceInMeters({ lat, lng }, { lat: stop.lat, lng: stop.lng })
      if (distance < bestDistance) {
        bestDistance = distance
        best = stop
      }
    }
    if (best && bestDistance <= SAME_STATION_RADIUS) return best
  }

  if (name.length >= 4) {
    const loose = stops.filter((stop) => {
      const candidate = normalizeName(stop.nameTc)
      return candidate.length >= 4 && (candidate.includes(name) || name.includes(candidate))
    })
    if (loose.length === 1) return loose[0]
  }

  return null
}

function directionLabel(direction) {
  return direction === 'inbound' ? '回程' : '去程'
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
 * 單一站點的最近三班 ETA（30 秒輪詢）。
 *
 * 切換站點時由父層以 key 重新掛載整個面板，舊的請求／計時器會在 cleanup 中取消，
 * 因此不會出現「上一站的班次蓋掉這一站」或背景繼續輪詢的問題。
 *
 * @param {{stop:object, route:string, direction:string, siblingParam?:string}} params
 */
function useStopEtas({ stop, route, direction, siblingParam }) {
  const [state, setState] = useState({
    etas: [],
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
          routes: [route],
          siblingIds: siblingParam ? siblingParam.split(',') : [],
        })
        if (cancelled) return
        const matched = filterByRoute(entries, route).find((entry) => entry.direction === direction)
        setState({
          etas: (matched?.etas ?? []).slice(0, 3),
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
          error: error?.message ?? '無法取得實時到站資料',
        }))
      }

      if (!cancelled) timer = setTimeout(() => load({ silent: true }), REFRESH_INTERVAL)
    }

    load({ silent: false })

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [stop, route, direction, siblingParam, reloadToken])

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  return { ...state, refresh }
}

/** 展開某站時顯示的最近三班車＋資料更新時間 */
function StopEtaPanel({ id, stop, route, direction, siblingIds }) {
  const { etas, loading, updating, error, updatedAt, refresh } = useStopEtas({
    stop,
    route,
    direction,
    siblingParam: siblingIds.join(','),
  })

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
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="chip shrink-0 bg-white px-2 py-0.5 text-rose-600 transition hover:bg-rose-100 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            重試
          </button>
        </div>
      ) : (
        <>
          <EtaSlots etas={etas} />
          {etas.length === 0 && (
            <p className="mt-1.5 px-1 text-[11px] text-slate-500 dark:text-slate-400">
              此方向暫無實時到站資料，可能已收班或班次未開始。
            </p>
          )}
        </>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[10px] text-slate-400 dark:text-slate-500">
        <span>
          {updatedAt ? `資料更新 ${formatClock(updatedAt)} · 每 30 秒自動更新` : '正在取得實時到站資料…'}
        </span>
        <button
          type="button"
          onClick={refresh}
          aria-label="立即更新到站時間"
          title="立即更新"
          className="rounded-full p-0.5 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <RefreshCw className={`h-3 w-3 ${updating ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * 新視窗路線站序頁
 *
 * 所有狀態都來自 URL（路徑的 operator／route／direction 與 query 的 stop／name／
 * siblings／serviceType／routeId／routeSeq／orig／dest），因此可直接分享、重新整理，
 * 反轉方向也是以 replace 導覽更新 URL，不依賴前一個視窗的 React state。
 */
export default function RouteSequence() {
  const { operator, route, direction } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const stopParam = searchParams.get('stop') ?? ''
  const nameParam = searchParams.get('name') ?? ''
  const siblingsParam = searchParams.get('siblings') ?? ''
  const serviceType = searchParams.get('serviceType') ?? '1'
  const routeId = searchParams.get('routeId') ?? ''
  const routeSeq = searchParams.get('routeSeq') ?? ''
  const origParam = searchParams.get('orig') ?? ''
  const destParam = searchParams.get('dest') ?? ''
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
  const { favorites, toggleFavorite } = useFavorites()
  const favoriteKeys = useMemo(() => new Set(favorites.map(favoriteKey)), [favorites])
  // 展開狀態改由元件 state 管理，可同時展開多站；URL 的 stop 只作為「來源站」
  // （高亮＋本站 chip＋分享用）與重新載入時的初始展開依據，不再限制同時展開的站數。
  const [expandedStopIds, setExpandedStopIds] = useState(() => new Set())
  const listRef = useRef(null)
  const sourceRef = useRef(null)

  // 站序載入完成時要用「當下」的 URL 參數找回來源站；以 ref 保存可避免把 stop／name
  // 變成站序請求的依賴（否則每次點站點更新 URL 都會重新抓一次全線站序）。
  const urlParamsRef = useRef({ nameParam: '', highlightedIds: new Set() })
  useEffect(() => {
    urlParamsRef.current = { nameParam, highlightedIds }
  }, [nameParam, highlightedIds])

  // 取得全線站序；小巴缺少 routeId/routeSeq 時直接顯示可理解的錯誤
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setStopsStatus('loading')
      setStopsError(null)
      try {
        if (!operator || !route) throw new Error('網址缺少業者或路線資料，請由站點的路線卡片重新開啟。')
        if (isGmbMissingMeta) {
          throw new Error('此小巴路線缺少 routeId／routeSeq 參數，請由站點的路線卡片重新開啟。')
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

        // 反轉方向／重新載入站序時，把展開狀態重設為新方向找回的來源站（找不到就空 Set）
        const { nameParam: currentName, highlightedIds: currentHighlightedIds } = urlParamsRef.current
        const matchedStop =
          list.find((stop) => currentHighlightedIds.has(stop.id)) ??
          findMatchingStop(list, { name: currentName })
        setExpandedStopIds(new Set(matchedStop ? [matchedStop.id] : []))
      } catch (error) {
        if (cancelled) return
        setStops([])
        setExpandedStopIds(new Set())
        setStopsStatus('error')
        setStopsError(error?.message ?? '無法取得站序資料')
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [operator, route, directionValue, serviceType, routeId, routeSeq, stopsReloadToken, isGmbMissingMeta])

  // 來源站：以 URL 的 stop／siblings 比對站點 ID，反轉方向後改以正規化站名／座標找回。
  // 「本站」chip 與 sky 高亮只標示這一站；其他已展開的站不會被搶走高亮。
  const activeStop = useMemo(() => {
    if (stops.length === 0) return null
    const byId = stops.find((stop) => highlightedIds.has(stop.id))
    if (byId) return byId
    return findMatchingStop(stops, { name: nameParam })
  }, [stops, highlightedIds, nameParam])

  const activeStopId = activeStop?.id ?? null

  // 來源站若由多個月台合併（siblings），展開它的 ETA 時要帶上其他月台 ID，
  // 九巴合併月台才查得準；其他點開的站只知道自己的 ID。
  const activeSiblingIds = useMemo(() => {
    if (!activeStop) return []
    return [...highlightedIds].filter((id) => id && id !== activeStop.id)
  }, [activeStop, highlightedIds])

  // 站序載入後把來源站捲到清單中央（只改 scrollTop，避免 scrollIntoView 讓整頁跳動）
  const stopsSignature = `${stops.length}|${stops[0]?.id ?? ''}|${stops[stops.length - 1]?.id ?? ''}`
  useEffect(() => {
    const list = listRef.current
    const item = sourceRef.current
    if (!list || !item) return
    list.scrollTop = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2)
  }, [stopsSignature])

  const headerOrig = origParam || stops[0]?.nameTc || stops[0]?.nameEn || ''
  const headerDest =
    destParam || stops[stops.length - 1]?.nameTc || stops[stops.length - 1]?.nameEn || ''

  useEffect(() => {
    if (!route) return undefined
    const previous = document.title
    document.title = `${route} ${directionLabel(directionValue)}${headerDest ? ` 往 ${headerDest}` : ''}｜香港巴士站序`
    return () => {
      document.title = previous
    }
  }, [route, directionValue, headerDest])

  const retryStops = useCallback(() => setStopsReloadToken((token) => token + 1), [])

  // 點站點列：切換該站的展開狀態（可同時展開多站）。
  // URL 的 stop／name 仍會 replace 更新（分享／重新整理用），但不影響目前已展開的站。
  const handleToggleStop = useCallback(
    (stop) => {
      const isExpanded = expandedStopIds.has(stop.id)
      setExpandedStopIds((prev) => {
        const next = new Set(prev)
        if (next.has(stop.id)) next.delete(stop.id)
        else next.add(stop.id)
        return next
      })

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
    [expandedStopIds, navigate, searchParams],
  )

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
        setReverseError(`找不到 ${route} 的另一方向資料，這條路線可能只有單方向行駛。`)
        return
      }

      // 反向站序的站點 ID 通常不同：先抓反向站序，以站名／座標找回同一站，
      // 比對結果寫回 URL 的 stop，重新整理或分享後仍可還原高亮與展開。
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
          name: activeStop?.nameTc || activeStop?.nameEn || nameParam,
          lat: activeStop?.lat,
          lng: activeStop?.lng,
        })
      } catch {
        // 反向站序暫時載入失敗：仍切換方向，由頁面顯示錯誤與重試
      }

      const next = new URLSearchParams()
      if (matchedStop?.id) next.set('stop', matchedStop.id)
      const stopName =
        matchedStop?.nameTc || matchedStop?.nameEn || activeStop?.nameTc || activeStop?.nameEn || nameParam
      if (stopName) next.set('name', stopName)
      if (target.serviceType) next.set('serviceType', target.serviceType)
      if (target.routeId != null) next.set('routeId', target.routeId)
      if (target.routeSeq != null) next.set('routeSeq', target.routeSeq)
      if (target.orig) next.set('orig', target.orig)
      if (target.destination) next.set('dest', target.destination)

      const pathname = `/route/${encodeURIComponent(operator)}/${encodeURIComponent(target.route)}/${target.direction}`
      navigate(
        { pathname, search: next.toString() ? `?${next.toString()}` : '' },
        { replace: true },
      )
      setReverseStatus('idle')
    } catch (error) {
      setReverseStatus('error')
      setReverseError(error?.message ?? '無法載入路線索引，請稍後再試。')
    }
  }, [
    activeStop,
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
  ])

  // 「返回」依序嘗試：回到開啟此視窗的原分頁 → 上一頁 → 首頁。
  // 站序頁通常是從 App 以 window.open 開啟，保留 window.opener 才能聚焦並關閉本視窗；
  // 若 popup 被封鎖而改成同視窗導覽，就用 history.back() 回到原本的頁面。
  const handleBack = useCallback(() => {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.focus()
      } catch {
        // 忽略：跨來源或瀏覽器不允許 focus 時，仍嘗試關閉本視窗
      }
      window.close()
      // 有些環境（PWA／被使用者設定攔截）不允許 script 關閉視窗：退回 App 首頁
      window.setTimeout(() => {
        if (!window.closed) window.location.assign(HOME_URL)
      }, 200)
      return
    }

    // 同視窗 fallback：只有 referrer 是同源 App 頁面時才 history.back()，
    // 避免「直接貼網址開新分頁」時 back 回到空白頁或外部網站。
    const sameOriginReferrer = (() => {
      try {
        return (
          Boolean(document.referrer) &&
          new URL(document.referrer).origin === window.location.origin
        )
      } catch {
        return false
      }
    })()
    if (window.history.length > 1 && sameOriginReferrer) {
      window.history.back()
      return
    }

    window.location.assign(HOME_URL)
  }, [])

  const isReversing = reverseStatus === 'loading'

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200/70 bg-white/90 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto w-full max-w-lg px-3 py-2.5">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={handleBack}
              aria-label="返回上一頁"
              title="返回"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              返回
            </button>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="text-xl font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
                  {route || '路線站序'}
                </span>
                <OperatorBadge operator={operator} />
                <span className="chip bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  {directionLabel(directionValue)}
                </span>
                {stopsStatus === 'ready' && stops.length > 0 && (
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    · {stops.length} 站
                  </span>
                )}
              </p>
              <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                <RouteIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {headerOrig || '起點'} → {headerDest || '終點'}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 truncate text-[10px] text-slate-400 dark:text-slate-500">
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              獨立視窗 · 到站資料每 30 秒自動更新
            </span>
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
              {isReversing ? '尋找反向…' : '反轉方向'}
            </button>
          </div>
        </div>
      </header>

      {reverseError && (
        <div className="mx-auto w-full max-w-lg shrink-0 px-3 pt-2">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{reverseError}</span>
            <button
              type="button"
              onClick={handleReverse}
              className="chip shrink-0 bg-white px-2 py-0.5 text-amber-700 transition hover:bg-amber-100 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              重試
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
            title={isGmbMissingMeta ? '缺少小巴路線參數' : '無法載入站序'}
            message={stopsError}
            onRetry={isGmbMissingMeta ? undefined : retryStops}
          />
        )}

        {stopsStatus === 'ready' && stops.length === 0 && (
          <EmptyState
            title="此方向暫無站序資料"
            description="官方目前沒有這條路線此方向的站點，請嘗試反轉方向或重新開啟。"
          />
        )}

        {stopsStatus === 'ready' && stops.length > 0 && (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 px-1 text-[10px] text-slate-400 dark:text-slate-500">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                全線站序 · {stops.length} 站
              </span>
              <span>點擊站點可同時展開多站</span>
            </div>

            <ol
              ref={listRef}
              aria-label="全線站序"
              className="card relative min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5"
            >
              {stops.map((stop) => {
                const isExpanded = expandedStopIds.has(stop.id)
                const isSource = activeStopId === stop.id
                const isFavorite = favoriteKeys.has(favoriteKey(stop))
                const panelId = `stop-eta-${String(stop.id).replace(/[^A-Za-z0-9_-]+/g, '-')}`
                return (
                  <li key={`${stop.id}-${stop.seq}`} ref={isSource ? sourceRef : null}>
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
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums ${
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
                            {stop.nameTc || stop.nameEn || stop.id}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                            {isExpanded ? '最近三班車' : '查看最近三班車'}
                            {isSource && (
                              <span className="chip bg-sky-600 px-1.5 py-0 text-[9px] text-white dark:bg-sky-500">
                                本站
                              </span>
                            )}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleFavorite(stop)}
                        aria-label={isFavorite ? '取消收藏此站' : '收藏此站'}
                        aria-pressed={isFavorite}
                        title={isFavorite ? '取消收藏此站' : '收藏此站'}
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
                        aria-label={isExpanded ? '收合此站到站時間' : '展開此站到站時間'}
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
                        key={`${stop.operator}:${stop.id}`}
                        id={panelId}
                        stop={stop}
                        route={route}
                        direction={directionValue}
                        siblingIds={isSource ? activeSiblingIds : []}
                      />
                    )}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </main>

      <footer className="shrink-0 border-t border-slate-200/70 bg-white/70 px-3 py-1.5 text-center text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-500">
        資料來源：DATA.GOV.HK · 九巴 KMB／城巴 CTB／專線小巴 GMB
      </footer>
    </div>
  )
}
