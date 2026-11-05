import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star, TriangleAlert } from 'lucide-react'
import StopSection from '../components/StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import useLocation from '../hooks/useLocation.js'
import useLanguage from '../hooks/useLanguage.js'
import { getFareUpdatedAt, getNearbyStops } from '../services/api.js'
import { formatDateTime } from '../utils/format.js'

/** Leaflet 只在地圖區塊需要，動態載入讓首屏（定位＋站點列表）不必等地圖程式碼 */
const StopMap = lazy(() => import('../components/StopMap.jsx'))

/**
 * 附近頁：GPS 定位 → 500 公尺內 KMB + CTB 站點 → 展開查看路線 ETA
 * 搜尋半徑固定為 500 公尺（見 services/api.js 的 DEFAULT_RADIUS），不提供使用者調整。
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
  const { t } = useLanguage()

  const [stops, setStops] = useState([])
  const [error, setError] = useState(null)
  // 已完成的請求識別（座標＋更新次數）；loading 由「目前請求 vs 已完成請求」推導，
  // 避免在 effect 內同步 setState（react/set-state-in-effect）。
  const [loadedRequestKey, setLoadedRequestKey] = useState(null)
  // 可同時展開多個站點（打開下面站點時不會收起上面已打開的）
  const [expandedKeys, setExpandedKeys] = useState(() => new Set())
  const [reloadToken, setReloadToken] = useState(0)
  // 地圖聚焦的站點（列表點擊 → 地圖 flyTo；地圖圖釘 → 展開卡片並捲動）
  const [mapFocus, setMapFocus] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  // 地圖置頂時往下滑會收起 1/3（210px → 138px），回到頂部附近才展開；
  // manualExpandRef 記錄使用者是否按過「展開全圖」，暫停自動收起直到再次大幅往下捲動。
  const [collapsed, setCollapsed] = useState(false)
  const manualExpandRef = useRef(false)
  // 自動貼合平滑捲動期間暫停「滑動即收起」，貼合完成後恢復正常偵測
  const suppressCollapseUntilRef = useRef(0)
  // 按下「展開全圖」當下的 scrollY：之後要再往下滑 >120px 才重新自動收起
  const manualExpandYRef = useRef(0)
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
    Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng},${reloadToken}` : null
  let status = 'idle'
  if (requestKey !== null) {
    status = loadedRequestKey === requestKey ? (error ? 'error' : 'ready') : 'loading'
  }

  useEffect(() => {
    if (requestKey === null) return undefined

    let cancelled = false

    getNearbyStops({ lat, lng, limit: 20 })
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
        setError(err?.message ?? t('nearby.error'))
        setLoadedRequestKey(requestKey)
      })

    return () => {
      cancelled = true
    }
  }, [requestKey, lat, lng, focusStop, t])

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

  // 捲動偵測（passive + requestAnimationFrame 防抖）：
  // scrollY > 36 收起地圖、<= 12 展開；手動「展開全圖」後要再大幅下滑（> 160）才重新收起。
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      if (Date.now() < suppressCollapseUntilRef.current) return
      const y = window.scrollY
      if (y <= 12) {
        manualExpandRef.current = false
        setCollapsed(false)
        return
      }
      if (manualExpandRef.current) {
        if (y > manualExpandYRef.current + 120) {
          manualExpandRef.current = false
          setCollapsed(true)
        }
        return
      }
      if (y > 36) setCollapsed(true)
    }
    const handleScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // 點「展開全圖」：暫時解除自動收起，直到使用者再次大幅往下捲動（>120px）
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      if (prev) {
        manualExpandRef.current = true
        manualExpandYRef.current = window.scrollY
        return false
      }
      manualExpandRef.current = false
      return true
    })
  }, [])

  // 列表點擊站點：切換展開；若是「展開」就同步把地圖飛到該站、並讓置頂地圖回到完整高度，
  // 這樣 StopSection 的 scroll-margin-top 才能把站點精準貼合在展開的地圖下方。
  const handleToggleStop = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      const willExpand = !expandedKeys.has(key)
      if (willExpand) {
        focusStop(stop)
        setCollapsed(false)
        manualExpandRef.current = false
        // 讓 StopSection 的 smooth scrollIntoView 完成前不要觸發地圖縮小
        suppressCollapseUntilRef.current = Date.now() + 1600
      }
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
      {/* 置頂常駐地圖：避開固定 Header 的高度（--app-header-h）後貼在其下緣 */}
      <div
        className="sticky top-2 z-20"
        style={{ top: 'calc(var(--app-header-h, 3.5rem) + 0.5rem)' }}
      >
        <Suspense
          fallback={
            <div className="skeleton h-[210px] w-full rounded-[22px]" aria-hidden="true" />
          }
        >
          <StopMap
            center={mapCenter}
            userLocation={mapCenter}
            stops={stops}
            selectedKey={selectedKey}
            focus={mapFocus}
            onSelectStop={handleSelectStop}
            onLocate={locate}
            onRefresh={reloadAll}
            locating={isLocating}
            refreshing={refreshing || status === 'loading'}
            isFallback={isFallback}
            accuracy={accuracy}
            updatedAt={updatedAt}
            collapsed={collapsed}
            onToggleCollapse={handleToggleCollapse}
          />
        </Suspense>
      </div>

      {/* 位置錯誤（例如拒絕授權的 iOS 提示）以單行提示顯示，不佔用大卡片 */}
      {(locationError || etaError) && (
        <p className="flex items-start gap-1 px-1 text-[11px] text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{locationError || etaError}</span>
        </p>
      )}

      {status === 'loading' && <StopSkeleton rows={4} />}

      {status === 'error' && <ErrorState message={error} onRetry={reloadAll} />}

      {status === 'ready' && stops.length === 0 && (
        <EmptyState title={t('nearby.emptyTitle')} description={t('nearby.emptyDesc')} />
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
                  isExpanded={isExpanded}
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
        <span>{t('nearby.source')}</span>
        {etaUpdatedAt && (
          <span>· {t('nearby.etaData', { time: formatDateTime(etaUpdatedAt) })}</span>
        )}
        {getFareUpdatedAt() && (
          <span>· {t('nearby.fareData', { time: formatDateTime(getFareUpdatedAt()) })}</span>
        )}
      </footer>
    </div>
  )
}
