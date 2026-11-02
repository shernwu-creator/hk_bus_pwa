import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, MapPin } from 'lucide-react'
import OperatorBadge from '../components/OperatorBadge.jsx'
import RouteStopsPanel from '../components/RouteStopsPanel.jsx'
import SearchBar from '../components/SearchBar.jsx'
import { EmptyState, ErrorState, RouteSkeleton } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import { getRouteIndex, getRouteStops } from '../services/api.js'

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
  const { favorites, toggleFavorite } = useFavorites()
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
  // 開啟站序面板前的路線清單捲動位置：返回清單時還原，站序滑到深處按「返回」才不會跳到別處
  const resultsScrollRef = useRef(0)

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
        setIndexError(error?.message ?? '無法取得路線清單')
      })
  }, [])

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
        setStopsError(error?.message ?? '無法取得站序資料')
        setLoadedStopsKey(stopsRequestKey)
      })

    return () => {
      cancelled = true
    }
  }, [selected, stopsRequestKey])

  // 展開中的站點（可同時多個）；帶完整站點物件，展開後站名才不會退回站點編號
  const expandedStops = useMemo(
    () => stops.filter((stop) => expandedIds.has(stop.id)),
    [stops, expandedIds],
  )
  const etaRefs = useMemo(
    () => (selected ? expandedStops.map((stop) => ({ ...stop })) : []),
    [expandedStops, selected],
  )

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

  // 選擇路線（事件處理器內重置站序狀態，讓面板立即回到 loading）
  const chooseRoute = useCallback((row) => {
    // 記住清單的捲動位置，並把畫面帶回頂端，站序面板一打開就從第一站開始看
    resultsScrollRef.current = window.scrollY
    setSelected(row)
    setStops([])
    setStopsError(null)
    setLoadedStopsKey(null)
    setExpandedIds(new Set())
    window.scrollTo({ top: 0 })
  }, [])

  // 返回路線清單：等清單重新渲染後還原原本的捲動位置
  const backToResults = useCallback(() => {
    setSelected(null)
    window.requestAnimationFrame(() => window.scrollTo({ top: resultsScrollRef.current }))
  }, [])

  const retryStops = useCallback(() => {
    setExpandedIds(new Set())
    setStopsReloadToken((token) => token + 1)
  }, [])

  if (selected) {
    return (
      <RouteStopsPanel
        selected={selected}
        stops={stops}
        status={stopsStatus}
        error={stopsError}
        etaGroupsByKey={etaGroupsByKey}
        expandedIds={expandedIds}
        onToggleStop={toggleStop}
        onBack={backToResults}
        isFavorite={(stop) => favoriteKeys.has(favoriteKey(stop))}
        onToggleFavorite={(stop) => toggleFavorite({ ...stop, routes: [selected.route] })}
        onRetry={retryStops}
        etaUpdatedAt={etaUpdatedAt}
      />
    )
  }

  return (
    <div className="space-y-3">
      <SearchBar
        value={query}
        onChange={handleQueryChange}
        placeholder="輸入路線號碼，例如 1A、680、A21"
        onClear={() => setQuery('')}
      />

      {!keyword && (
        <section className="card p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Hash className="h-3.5 w-3.5" aria-hidden="true" />
            熱門路線
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
            輸入完整或部分路線號碼即可同時搜尋九巴、城巴與專線小巴路線；選定方向後可展開任一站點，查看該路線最近三班車。
          </p>
        </section>
      )}

      {keyword && indexStatus === 'loading' && <RouteSkeleton rows={5} />}

      {keyword && indexStatus === 'error' && <ErrorState message={indexError} onRetry={loadIndex} />}

      {keyword && indexStatus === 'ready' && results.length === 0 && (
        <EmptyState
          title={`找不到「${query.trim()}」路線`}
          description="請確認路線號碼，或改用部分號碼搜尋（例如 68、A2）。"
        />
      )}

      {keyword && results.length > 0 && (
        <>
          <p className="px-1 text-[11px] text-slate-400 dark:text-slate-500">
            找到 {results.length} 個路線方向，點選後查看站序
          </p>
          <ul className="space-y-2">
            {results.map((row) => (
              <li key={routeKey(row)}>
                <button
                  type="button"
                  onClick={() => chooseRoute(row)}
                  className="card flex w-full items-center gap-2.5 p-2.5 text-left transition hover:border-slate-300 dark:hover:border-slate-700"
                >
                  <span className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-slate-100/80 px-1 py-1.5 dark:bg-slate-800/80">
                    <span className="whitespace-nowrap text-lg font-extrabold leading-none text-slate-900 dark:text-white">
                      {row.route}
                    </span>
                    <OperatorBadge operator={row.operator} className="mt-1" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      往 {row.destination}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{row.orig}</span>
                      <span className="chip shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {row.direction === 'inbound' ? '回程' : '去程'}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
