import { useCallback, useEffect, useMemo, useState } from 'react'
import { LocateFixed, MapPin, RefreshCw, Star, TriangleAlert } from 'lucide-react'
import StopSection from '../components/StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import useLocation from '../hooks/useLocation.js'
import { DEFAULT_RADIUS, getFareUpdatedAt, getNearbyStops } from '../services/api.js'
import { formatClock, formatDateTime } from '../utils/format.js'

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
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  const lat = coords?.lat
  const lng = coords?.lng

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined

    let cancelled = false
    setStatus('loading')
    setError(null)

    getNearbyStops({ lat, lng, radius, limit: 20 })
      .then((list) => {
        if (cancelled) return
        setStops(list)
        setStatus('ready')
        setExpandedKey(list.length > 0 ? favoriteKey(list[0]) : null)
      })
      .catch((err) => {
        if (cancelled) return
        setStops([])
        setStatus('error')
        setError(err?.message ?? '無法取得附近站點')
      })

    return () => {
      cancelled = true
    }
  }, [lat, lng, radius, reloadToken])

  const expandedStop = useMemo(
    () => stops.find((stop) => favoriteKey(stop) === expandedKey) ?? null,
    [stops, expandedKey],
  )

  // 注意：refs 必須帶完整站點物件（站名等），否則展開後 StopSection 只能拿到站點編號，
  // 標題會從中文站名變成「5B1C2D3E」這種代碼。
  const etaRefs = useMemo(() => (expandedStop ? [{ ...expandedStop }] : []), [expandedStop])

  const {
    groups,
    loading: etaLoading,
    refreshing,
    error: etaError,
    updatedAt: etaUpdatedAt,
    refresh,
  } = useBusData(etaRefs, { enabled: Boolean(expandedStop) })

  const favoriteKeys = useMemo(() => new Set(favorites.map(favoriteKey)), [favorites])

  const reloadAll = useCallback(() => {
    setReloadToken((token) => token + 1)
    refresh()
  }, [refresh])

  const isLocating = locationStatus === 'locating'
  const etaGroup = groups[0] ?? null

  return (
    <div className="space-y-3">
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
          {stops.map((stop) => {
            const key = favoriteKey(stop)
            const isExpanded = key === expandedKey
            const group = isExpanded
              ? (etaGroup ?? { stop, routes: [], error: null })
              : { stop, routes: [], error: null }

            return (
              <StopSection
                key={key}
                group={group}
                distance={stop.distance}
                expanded={isExpanded}
                onToggle={() => setExpandedKey((prev) => (prev === key ? null : key))}
                isFavorite={favoriteKeys.has(key)}
                onToggleFavorite={toggleFavorite}
                loading={isExpanded && etaLoading}
                onRetry={refresh}
              />
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
