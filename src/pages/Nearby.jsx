import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LocateFixed, MapPin, RefreshCw, Star, TriangleAlert } from 'lucide-react'
import StopSection from '../components/StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import useLocation from '../hooks/useLocation.js'
import { DEFAULT_RADIUS, getFareUpdatedAt, getNearbyStops } from '../services/api.js'
import { formatClock, formatDateTime } from '../utils/format.js'

/** Leaflet 只在地圖區塊需要，動態載入讓首屏（定位＋站點列表）不必等地圖程式碼 */
const StopMap = lazy(() => import('../components/StopMap.jsx'))

const RADIUS_OPTIONS = [
  { value: 300, label: '300 公尺' },
  { value: 500, label: '500 公尺' },
  { value: 1000, label: '1 公里' },
]

/**
 * 附近頁：GPS 定位 → 半徑內 KMB + CTB 站點 → 展開查看路線 ETA
 * 只有被展開的站點才會發出 ETA 請求，避免一次打出數十個 API 呼叫。
 */
export default function Nearby() {
  const {
    coords,
    status: locationStatus,
    accuracy,
    error: locationError,
    isFallback,
    updatedAt,
    locate,
  } = useLocation()
  const { favorites, toggleFavorite } = useFavorites()

  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const [stops, setStops] = useState([])
  const [error, setError] = useState(null)
  // 已完成的請求識別（座標＋半徑＋更新次數）；loading 由「目前請求 vs 已完成請求」推導，
  // 避免在 effect 內同步 setState（react/set-state-in-effect）。
  const [loadedRequestKey, setLoadedRequestKey] = useState(null)
  // 可同時展開多個站點（打開下面站點時不會收起上面已打開的）
  const [expandedKeys, setExpandedKeys] = useState(() => new Set())
  const [reloadToken, setReloadToken] = useState(0)
  // 地圖聚焦的站點（列表點擊 → 地圖 flyTo；地圖圖釘 → 展開卡片並捲動）
  const [mapFocus, setMapFocus] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const stopCardRefs = useRef(new Map())
  const focusSeq = useRef(0)

  // 地圖與列表共用「目前聚焦站點」；seq 讓同一站點可以重複觸發 flyTo
  const focusStop = useCallback((stop, { scroll = false } = {}) => {
    if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return
    const key = favoriteKey(stop)
    focusSeq.current += 1
    setSelectedKey(key)
    setMapFocus({ key, lat: stop.lat, lng: stop.lng, seq: focusSeq.current })
    if (scroll) {
      window.requestAnimationFrame(() => {
        stopCardRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }, [])

  const lat = coords?.lat
  const lng = coords?.lng
  const requestKey =
    Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng},${radius},${reloadToken}` : null
  let status = 'idle'
  if (requestKey !== null) {
    status = loadedRequestKey === requestKey ? (error ? 'error' : 'ready') : 'loading'
  }

  useEffect(() => {
    if (requestKey === null) return undefined

    let cancelled = false

    getNearbyStops({ lat, lng, radius, limit: 20 })
      .then((list) => {
        if (cancelled) return
        setStops(list)
        setError(null)
        setLoadedRequestKey(requestKey)
        // 預設展開最近（排序前）的站點，並把地圖中心移到該站
        setExpandedKeys(new Set(list.length > 0 ? [favoriteKey(list[0])] : []))
        if (list.length > 0) focusStop(list[0])
      })
      .catch((err) => {
        if (cancelled) return
        setStops([])
        setError(err?.message ?? '無法取得附近站點')
        setLoadedRequestKey(requestKey)
      })

    return () => {
      cancelled = true
    }
  }, [requestKey, lat, lng, radius, focusStop])

  // 展開中的站點（可同時多個）；refs 必須帶完整站點物件（站名等），
  // 否則展開後 StopSection 只能拿到站點編號，標題會從中文站名變成「5B1C2D3E」這種代碼。
  const expandedStops = useMemo(
    () => stops.filter((stop) => expandedKeys.has(favoriteKey(stop))),
    [stops, expandedKeys],
  )
  const etaRefs = useMemo(() => expandedStops.map((stop) => ({ ...stop })), [expandedStops])

  const {
    groups,
    refreshing,
    error: etaError,
    updatedAt: etaUpdatedAt,
    refresh,
  } = useBusData(etaRefs, { enabled: etaRefs.length > 0 })

  // 以站點 key 對應各自的 ETA；仍然載入中的站點沒有 group 就顯示 skeleton
  const groupsByKey = useMemo(
    () => new Map(groups.map((group) => [favoriteKey(group.stop), group])),
    [groups],
  )

  const favoriteKeys = useMemo(() => new Set(favorites.map(favoriteKey)), [favorites])

  // 附近站點排序：小巴一律排最後；同組內已收藏站點優先（即使距離較遠），其餘依距離。
  // 收藏狀態改變時會即時重排。
  const orderedStops = useMemo(() => {
    const isGmb = (stop) => stop.operator === 'GMB'
    return [...stops].sort((a, b) => {
      const gmbDiff = Number(isGmb(a)) - Number(isGmb(b))
      if (gmbDiff !== 0) return gmbDiff
      const favoriteDiff =
        Number(favoriteKeys.has(favoriteKey(b))) - Number(favoriteKeys.has(favoriteKey(a)))
      if (favoriteDiff !== 0) return favoriteDiff
      return (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)
    })
  }, [stops, favoriteKeys])

  const reloadAll = useCallback(() => {
    setReloadToken((token) => token + 1)
    refresh()
  }, [refresh])

  // 列表點擊站點：切換展開；若是「展開」就同步把地圖飛到該站
  const handleToggleStop = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      if (!expandedKeys.has(key)) focusStop(stop)
      setExpandedKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [expandedKeys, focusStop],
  )

  // 點擊地圖圖釘：展開該站（已展開則保持）並捲動到對應卡片
  const handleSelectStop = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      setExpandedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
      focusStop(stop, { scroll: true })
    },
    [focusStop],
  )

  const mapCenter = useMemo(
    () => (Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null),
    [lat, lng],
  )

  const isLocating = locationStatus === 'locating'

  return (
    <div className="space-y-3">
      <Suspense fallback={<div className="skeleton h-52 w-full rounded-2xl" aria-hidden="true" />}>
        <StopMap
          center={mapCenter}
          userLocation={mapCenter}
          stops={stops}
          selectedKey={selectedKey}
          focus={mapFocus}
          onSelectStop={handleSelectStop}
          onLocate={locate}
          locating={isLocating}
        />
      </Suspense>

      <section className="card p-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            <MapPin className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isLocating ? '正在定位…' : isFallback ? '使用預設位置' : '已取得你的位置'}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {Number.isFinite(lat) && Number.isFinite(lng)
                ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                : '等待定位結果…'}
              {Number.isFinite(accuracy) && ` · 誤差約 ${Math.round(accuracy)} 公尺`}
              {updatedAt ? ` · ${formatClock(updatedAt)} 更新` : ''}
            </p>
            {(locationError || etaError) && (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{locationError || etaError}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={locate}
              disabled={isLocating}
              className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 disabled:opacity-40 dark:hover:bg-slate-800"
              aria-label="重新定位"
              title="重新定位"
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={reloadAll}
              disabled={status === 'loading' || refreshing}
              className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 disabled:opacity-40 dark:hover:bg-slate-800"
              aria-label="更新附近站點"
              title="更新"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5">
          {RADIUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRadius(option.value)}
              aria-pressed={radius === option.value}
              className={`chip px-3 py-1 transition ${
                radius === option.value
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">
            {status === 'ready' ? `${stops.length} 個站點` : ' '}
          </span>
        </div>
      </section>

      {status === 'loading' && <StopSkeleton rows={4} />}

      {status === 'error' && <ErrorState message={error} onRetry={reloadAll} />}

      {status === 'ready' && stops.length === 0 && (
        <EmptyState
          title="附近找不到站點"
          description={`${radius} 公尺內沒有可查詢的九巴、城巴或小巴站點，試試擴大搜尋範圍。`}
          action={
            radius < 1000 ? (
              <button
                type="button"
                onClick={() => setRadius(1000)}
                className="mt-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                擴大至 1 公里
              </button>
            ) : null
          }
        />
      )}

      {status === 'ready' && stops.length > 0 && (
        <div className="space-y-2">
          {orderedStops.map((stop) => {
            const key = favoriteKey(stop)
            const isExpanded = expandedKeys.has(key)
            const group = groupsByKey.get(key) ?? { stop, routes: [], error: null }
            // 已展開但 ETA 尚未回來 → 顯示骨架；回來後即使沒有班次也顯示空狀態
            const isLoading = isExpanded && !groupsByKey.has(key)

            return (
              <div
                key={key}
                ref={(element) => {
                  if (element) stopCardRefs.current.set(key, element)
                  else stopCardRefs.current.delete(key)
                }}
              >
                <StopSection
                  group={group}
                  distance={stop.distance}
                  expanded={isExpanded}
                  onToggle={() => handleToggleStop(stop)}
                  isFavorite={favoriteKeys.has(key)}
                  onToggleFavorite={toggleFavorite}
                  loading={isLoading}
                  onRetry={refresh}
                />
              </div>
            )
          })}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 pb-2 text-center text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
        <Star className="h-3 w-3" aria-hidden="true" />
        <span>資料來源：DATA.GOV.HK（九巴／城巴／小巴實時到站、運輸署票價）</span>
        {etaUpdatedAt && <span>· 到站資料 {formatDateTime(etaUpdatedAt)}</span>}
        {getFareUpdatedAt() && <span>· 票價表 {formatDateTime(getFareUpdatedAt())}</span>}
      </footer>
    </div>
  )
}
