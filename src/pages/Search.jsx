import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, MapPin, Star } from 'lucide-react'
import OperatorBadge from '../components/OperatorBadge.jsx'
import RouteStopsPanel from '../components/RouteStopsPanel.jsx'
import SearchBar from '../components/SearchBar.jsx'
import { EmptyState, ErrorState, RouteSkeleton } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import useLanguage from '../hooks/useLanguage.js'
import useMapCollapse from '../hooks/useMapCollapse.js'
import { getRouteIndex, getRouteStops } from '../services/api.js'

/** Leaflet 只在站序地圖出現時才載入，搜尋結果頁不必付地圖程式碼的成本 */
const StopMap = lazy(() => import('../components/StopMap.jsx'))

/** 常見路線，讓使用者不用打字就能試用 */
const POPULAR_ROUTES = ['1A', '6', '101', '112', '680', '962', 'A21', 'E33']

const MAX_RESULTS = 60

function routeKey(row) {
  return row.id ?? `${row.operator}:${row.route}:${row.direction}:${row.serviceType}`
}

function matchesQuery(row, keyword) {
  if (!keyword) return false
  const code = row.route
  if (code.startsWith(keyword)) return true
  return keyword.length > 1 && (code.includes(keyword) || row.destination.includes(keyword) || row.orig?.includes(keyword))
}

/**
 * 搜尋頁：路線號碼 → 選方向 → 站序清單 → 展開查看該站的到站時間
 */
export default function Search() {
  const { favorites, toggleFavorite, isFavoriteRoute, toggleFavoriteRoute } = useFavorites()
  const { t, pickLang } = useLanguage()
  const [query, setQuery] = useState('')
  const [routeIndex, setRouteIndex] = useState(null)
  const [indexStatus, setIndexStatus] = useState('idle')
  const [indexError, setIndexError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [stops, setStops] = useState([])
  const [stopsError, setStopsError] = useState(null)
  // 已完成的站序請求（路線＋重試次數）；loading 由「目前請求 vs 已完成請求」推導，
  // 避免在 effect 內同步 setState（react/set-state-in-effect）。
  const [loadedStopsKey, setLoadedStopsKey] = useState(null)
  const [stopsReloadToken, setStopsReloadToken] = useState(0)
  // 可同時展開多個站點，打開下面的站不會收起上面的
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // 「推算各站到站時間」的狀態提升到頁面層：基準站在開啟推算時固定下來，
  // 之後展開／收合其他站點都不會改變推算輸入，避免推算時間隨 UI 狀態跳動。
  const [planEnabled, setPlanEnabled] = useState(false)
  const [planBaseStopId, setPlanBaseStopId] = useState(null)
  // 開啟站序面板前的路線清單捲動位置：返回清單時還原，站序滑到深處按「返回」才不會跳到別處
  const resultsScrollRef = useRef(0)
  // 站序頁全線軌跡地圖：focusedStopId 為 null 時顯示全線，點選站點後聚焦該站
  const [focusedStopId, setFocusedStopId] = useState(null)
  const { collapsed, toggleCollapse, resetCollapse } = useMapCollapse()

  const keyword = query.trim().toUpperCase()
  const stopsRequestKey = selected ? `${routeKey(selected)}|${stopsReloadToken}` : null
  let stopsStatus = 'idle'
  if (stopsRequestKey !== null) {
    stopsStatus =
      loadedStopsKey === stopsRequestKey ? (stopsError ? 'error' : 'ready') : 'loading'
  }

  const loadIndex = useCallback(() => {
    setIndexStatus('loading')
    setIndexError(null)
    getRouteIndex()
      .then((rows) => {
        setRouteIndex(rows)
        setIndexStatus('ready')
      })
      .catch((error) => {
        setIndexStatus('error')
        setIndexError(error?.message ?? t('search.indexError'))
      })
  }, [t])

  const handleQueryChange = (value) => {
    setQuery(value)
    if (value.trim() && !routeIndex && indexStatus !== 'loading') loadIndex()
  }

  const results = useMemo(() => {
    if (!routeIndex || !keyword) return []
    const seen = new Set()
    const rows = []
    for (const row of routeIndex) {
      if (!matchesQuery(row, keyword)) continue
      const key = routeKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
    rows.sort(
      (a, b) =>
        a.route.localeCompare(b.route, 'en', { numeric: true }) ||
        a.operator.localeCompare(b.operator) ||
        a.direction.localeCompare(b.direction),
    )
    return rows.slice(0, MAX_RESULTS)
  }, [routeIndex, keyword])

  useEffect(() => {
    if (stopsRequestKey === null) return undefined

    let cancelled = false

    getRouteStops(selected)
      .then((list) => {
        if (cancelled) return
        setStops(list)
        setStopsError(null)
        setLoadedStopsKey(stopsRequestKey)
      })
      .catch((error) => {
        if (cancelled) return
        setStops([])
        setStopsError(error?.message ?? t('search.stopsError'))
        setLoadedStopsKey(stopsRequestKey)
      })

    return () => {
      cancelled = true
    }
  }, [selected, stopsRequestKey, t])

  // 展開中的站點（可同時多個）；帶完整站點物件，展開後站名才不會退回站點編號
  const expandedStops = useMemo(
    () => stops.filter((stop) => expandedIds.has(stop.id)),
    [stops, expandedIds],
  )

  // 推算基準站：只在「開啟推算」那一刻決定（優先目前展開的站點，否則由第一站起算），
  // 之後不再跟隨 expandedIds 變動。推算輸入因此與 UI 展開／收合完全解耦，
  // 不會因為多開或少開一站而換基準、令後續各站時間大幅跳動。
  const planBaseStop = useMemo(() => {
    if (!planEnabled || stops.length === 0) return null
    return stops.find((stop) => String(stop.id) === String(planBaseStopId)) ?? stops[0]
  }, [planEnabled, stops, planBaseStopId])

  // 輪詢清單＝已展開站點＋推算基準站：基準站即使被收合也要持續更新，
  // 否則基準班次會過期，後續推算會突然退回純幾何估算。
  const etaRefs = useMemo(() => {
    if (!selected) return []
    const refs = expandedStops.map((stop) => ({ ...stop }))
    if (planBaseStop) {
      const baseKey = favoriteKey(planBaseStop)
      if (!refs.some((stop) => favoriteKey(stop) === baseKey)) refs.push({ ...planBaseStop })
    }
    return refs
  }, [expandedStops, planBaseStop, selected])

  const { groups, updatedAt: etaUpdatedAt } = useBusData(etaRefs, {
    enabled: etaRefs.length > 0,
    routeFilter: selected?.route ?? null,
  })

  const favoriteKeys = useMemo(() => new Set(favorites.map(favoriteKey)), [favorites])
  const etaGroupsByKey = useMemo(
    () => new Map(groups.map((group) => [favoriteKey(group.stop), group])),
    [groups],
  )

  const toggleStop = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 開啟推算時把基準站固定為「目前展開的最前面站點」，沒有展開任何站點則由路線第一站起算。
  // 基準站之後不再跟隨展開狀態；要改用其他站推算就把該站展開，關閉再重新開啟推算。
  const togglePlan = useCallback(() => {
    if (planEnabled) {
      setPlanEnabled(false)
      return
    }
    setPlanBaseStopId(expandedStops[0]?.id ?? stops[0]?.id ?? null)
    setPlanEnabled(true)
  }, [planEnabled, expandedStops, stops])

  // 選擇路線（事件處理器內重置站序狀態，讓面板立即回到 loading）
  const chooseRoute = useCallback(
    (row) => {
      // 記住清單的捲動位置，並把畫面帶回頂端，站序面板一打開就從第一站開始看
      resultsScrollRef.current = window.scrollY
      setSelected(row)
      setStops([])
      setStopsError(null)
      setLoadedStopsKey(null)
      setExpandedIds(new Set())
      setPlanEnabled(false)
      setPlanBaseStopId(null)
      setFocusedStopId(null)
      resetCollapse()
      window.scrollTo({ top: 0 })
    },
    [resetCollapse],
  )

  // 返回路線清單：等清單重新渲染後還原原本的捲動位置
  const backToResults = useCallback(() => {
    setSelected(null)
    setFocusedStopId(null)
    resetCollapse()
    window.requestAnimationFrame(() => window.scrollTo({ top: resultsScrollRef.current }))
  }, [resetCollapse])

  // 點站點列：展開／收合 ETA、把地圖聚焦到該站；展開時讓置頂地圖回到完整高度，
  // 配合 StopSection 的 scroll-margin-top 精準貼合在地圖（及 sticky 返回列）下方。
  const handleToggleStop = useCallback(
    (id) => {
      const willExpand = !expandedIds.has(id)
      if (willExpand) resetCollapse()
      setFocusedStopId(id)
      toggleStop(id)
    },
    [expandedIds, resetCollapse, toggleStop],
  )

  // 點地圖上的站點圖釘：只聚焦（不展開），右上 Google Maps 連結會跟著指向該站
  const handleSelectMapStop = useCallback((stop) => setFocusedStopId(stop.id), [])
  const clearMapFocus = useCallback(() => setFocusedStopId(null), [])

  const retryStops = useCallback(() => {
    setExpandedIds(new Set())
    setStopsReloadToken((token) => token + 1)
  }, [])

  if (selected) {
    const showMapArea = stopsStatus === 'loading' || stops.length > 0
    return (
      <>
        {showMapArea && (
          <div
            className="sticky top-2 z-20 mb-2"
            style={{ top: 'calc(var(--app-header-h, 3.5rem) + 0.5rem)' }}
          >
            {stops.length > 0 ? (
              <Suspense
                fallback={
                  <div className="skeleton h-[210px] w-full rounded-[22px]" aria-hidden="true" />
                }
              >
                <StopMap
                  routeStops={stops}
                  focusedStopId={focusedStopId}
                  onClearFocus={clearMapFocus}
                  onSelectStop={handleSelectMapStop}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                />
              </Suspense>
            ) : (
              <div className="skeleton h-[210px] w-full rounded-[22px]" aria-hidden="true" />
            )}
          </div>
        )}

        <RouteStopsPanel
          selected={selected}
          stops={stops}
          status={stopsStatus}
          error={stopsError}
          etaGroupsByKey={etaGroupsByKey}
          expandedIds={expandedIds}
          onToggleStop={handleToggleStop}
          onBack={backToResults}
          isFavorite={(stop) => favoriteKeys.has(favoriteKey(stop))}
          onToggleFavorite={(stop) => toggleFavorite({ ...stop, routes: [selected.route] })}
          onRetry={retryStops}
          etaUpdatedAt={etaUpdatedAt}
          planEnabled={planEnabled}
          onTogglePlan={togglePlan}
          planBaseStopId={planBaseStopId}
          topOffset={showMapArea ? (collapsed ? '146px' : '218px') : null}
        />
      </>
    )
  }

  return (
    <div className="space-y-3">
      <SearchBar value={query} onChange={handleQueryChange} onClear={() => setQuery('')} />

      {!keyword && (
        <section className="card p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Hash className="h-3.5 w-3.5" aria-hidden="true" />
            {t('search.popular')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {POPULAR_ROUTES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => handleQueryChange(code)}
                className="chip bg-slate-100 px-3 py-1 text-slate-700 transition hover:bg-sky-100 hover:text-sky-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-sky-500/20 dark:hover:text-sky-300"
              >
                {code}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            {t('search.popularDesc')}
          </p>
        </section>
      )}

      {keyword && indexStatus === 'loading' && <RouteSkeleton rows={5} />}

      {keyword && indexStatus === 'error' && <ErrorState message={indexError} onRetry={loadIndex} />}

      {keyword && indexStatus === 'ready' && results.length === 0 && (
        <EmptyState
          title={t('search.notFound', { query: query.trim() })}
          description={t('search.notFoundDesc')}
        />
      )}

      {keyword && results.length > 0 && (
        <>
          <p className="px-1 text-[11px] text-slate-400 dark:text-slate-500">
            {t('search.found', { n: results.length })}
          </p>
          <ul className="space-y-2">
            {results.map((row) => {
              const routeFavorite = isFavoriteRoute(row)
              return (
              <li key={routeKey(row)}>
                <div className="card flex w-full items-center gap-1 p-2.5 transition hover:border-slate-300 dark:hover:border-slate-700">
                <button
                  type="button"
                  onClick={() => chooseRoute(row)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-slate-100/80 px-1 py-1.5 dark:bg-slate-800/80">
                    <span className="whitespace-nowrap text-lg font-extrabold leading-none text-slate-900 dark:text-white">
                      {row.route}
                    </span>
                    <OperatorBadge operator={row.operator} className="mt-1" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {t('search.to', { dest: pickLang(row.destination, row.destinationEn) })}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{pickLang(row.orig, row.origEn)}</span>
                      <span className="chip shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {row.direction === 'inbound'
                          ? t('direction.inbound')
                          : t('direction.outbound')}
                      </span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavoriteRoute(row)}
                  aria-label={
                    routeFavorite ? t('route.unfavoriteRoute') : t('route.favoriteRoute')
                  }
                  aria-pressed={routeFavorite}
                  title={routeFavorite ? t('route.unfavoriteRoute') : t('route.favoriteRoute')}
                  className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-500/10"
                >
                  <Star
                    className={`h-4 w-4 ${
                      routeFavorite ? 'fill-amber-400 text-amber-400' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>
                </div>
              </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
