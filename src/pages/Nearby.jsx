import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Star, TriangleAlert } from 'lucide-react'
import StopSection from '../components/StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import useLocation from '../hooks/useLocation.js'
import useLanguage from '../hooks/useLanguage.js'
import useMapCollapse from '../hooks/useMapCollapse.js'
import { getFareUpdatedAt, getNearbyStops } from '../services/api.js'
import { formatDateTime } from '../utils/format.js'

/** Leaflet 只在地圖區塊需要，動態載入讓首屏（定位＋站點列表）不必等地圖程式碼 */
const StopMap = lazy(() => import('../components/StopMap.jsx'))

/**
 * 附近頁：GPS 定位 → 500 公尺內 KMB + CTB + GMB 站點 → 單一站點手風琴展開查看路線 ETA
 * 搜尋半徑固定為 500 公尺（見 services/api.js 的 DEFAULT_RADIUS），不提供使用者調整。
 * 預設不展開任何站點；同一時間只展開一站，展開時平滑貼合置頂地圖下緣且不跳動。
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
  const { collapsed, toggleCollapse, resetCollapse } = useMapCollapse()

  const [stops, setStops] = useState([])
  const [error, setError] = useState(null)
  // 已完成的請求識別（座標＋更新次數）；loading 由「目前請求 vs 已完成請求」推導，
  // 避免在 effect 內同步 setState（react/set-state-in-effect）。
  const [loadedRequestKey, setLoadedRequestKey] = useState(null)
  // 手風琴：同一時間只展開一個站點，初始預設不開啟任何站點
  const [activeStopKey, setActiveStopKey] = useState(null)
  const [alignSeq, setAlignSeq] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  // 地圖聚焦的站點（列表點擊 → 地圖 flyTo；地圖圖釘 → 展開卡片並貼合地圖下緣）
  const [mapFocus, setMapFocus] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)

  const mapStickyRef = useRef(null)
  const listRef = useRef(null)
  const stopCardRefs = useRef(new Map())
  const pendingAlignRef = useRef(null)
  const flipTimerRef = useRef(0)
  const focusSeq = useRef(0)

  const clearFlipStyles = useCallback(() => {
    window.clearTimeout(flipTimerRef.current)
    flipTimerRef.current = 0
    const listEl = listRef.current
    if (listEl) {
      listEl.style.transition = ''
      listEl.style.transform = ''
    }
    for (const el of stopCardRefs.current.values()) {
      el.style.transition = ''
      el.style.transform = ''
    }
  }, [])

  useEffect(() => () => clearFlipStyles(), [clearFlipStyles])

  // 地圖與列表共用「目前聚焦站點」；seq 讓同一站點可以重複觸發 flyTo
  const focusStop = useCallback((stop) => {
    if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return
    const key = favoriteKey(stop)
    focusSeq.current += 1
    setSelectedKey(key)
    setMapFocus({ key, lat: stop.lat, lng: stop.lng, seq: focusSeq.current })
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
        // 預設不開啟任何站點；若背景定位刷新前使用者已手動展開某站且該站仍在清單內，則予以保留，
        // 避免第一次進入網站時剛點開的站點被背景定位更新洗掉而瞬間縮回。
        setActiveStopKey((prev) =>
          prev && list.some((stop) => favoriteKey(stop) === prev) ? prev : null,
        )
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
  }, [requestKey, lat, lng, t])

  // 目前展開的單一站點；refs 必須帶完整站點物件（站名等），
  // 否則展開後 StopSection 只能拿到站點編號，標題會從中文站名變成「5B1C2D3E」這種代碼。
  const expandedStops = useMemo(
    () => (activeStopKey ? stops.filter((stop) => favoriteKey(stop) === activeStopKey) : []),
    [stops, activeStopKey],
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

  // 展開站點時記錄點擊前的畫面座標，交由 useLayoutEffect 在繪製前補償捲動並執行 FLIP 平滑移動
  const prepareStopAlign = useCallback(
    (key) => {
      const listEl = listRef.current
      const cardEl = stopCardRefs.current.get(key)
      pendingAlignRef.current = {
        key,
        prevKey: activeStopKey,
        firstListTop: listEl ? listEl.getBoundingClientRect().top : null,
        firstCardTop: cardEl ? cardEl.getBoundingClientRect().top : null,
      }
      setAlignSeq((seq) => seq + 1)
    },
    [activeStopKey],
  )

  // 列表點擊站點：單一展開手風琴；展開新站時自動收起上一站，並平滑貼合置頂地圖下緣
  const handleToggleStop = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      const willExpand = activeStopKey !== key
      if (!willExpand) {
        pendingAlignRef.current = null
        clearFlipStyles()
        setActiveStopKey(null)
        return
      }
      prepareStopAlign(key)
      focusStop(stop)
      resetCollapse()
      setActiveStopKey(key)
    },
    [activeStopKey, clearFlipStyles, focusStop, prepareStopAlign, resetCollapse],
  )

  // 點擊地圖圖釘：展開該站（已展開則重新對齊）並平滑貼合置頂地圖下緣
  const handleSelectStop = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      prepareStopAlign(key)
      focusStop(stop)
      resetCollapse()
      setActiveStopKey(key)
    },
    [focusStop, prepareStopAlign, resetCollapse],
  )

  // 在瀏覽器繪製前同步完成「收起舊站＋對齊新站至地圖下緣」的 scrollY 定位，
  // 再用 FLIP transform 讓清單與下方卡片從點擊當下的視覺位置平滑滑入定位，徹底消除畫面跳動。
  useLayoutEffect(() => {
    const listEl = listRef.current
    if (!activeStopKey) {
      if (listEl) listEl.style.paddingBottom = ''
      return
    }

    const pending = pendingAlignRef.current
    if (!pending || pending.key !== activeStopKey) return
    pendingAlignRef.current = null

    const cardEl = stopCardRefs.current.get(activeStopKey)
    const mapStickyEl = mapStickyRef.current
    if (!listEl || !cardEl || !mapStickyEl) return

    clearFlipStyles()

    const cardRect = cardEl.getBoundingClientRect()
    const mapRect = mapStickyEl.getBoundingClientRect()
    const currentDocTop = cardRect.top + window.scrollY
    const currentStickyBottom = mapRect.bottom + 8
    const targetScrollY = Math.max(0, Math.round(currentDocTop - currentStickyBottom))

    // 確保頁面底部有足夠可捲動空間（避免點開最末幾站或骨架較短時被瀏覽器截斷 scrollY）
    listEl.style.paddingBottom = ''
    const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const neededExtra = Math.ceil(targetScrollY + 180 - maxScrollY)
    if (neededExtra > 0) {
      listEl.style.paddingBottom = `${neededExtra}px`
    }

    window.scrollTo({ top: targetScrollY, behavior: 'instant' })

    const lastListTop = listEl.getBoundingClientRect().top
    const lastCardTop = cardEl.getBoundingClientRect().top
    const listDeltaY = pending.firstListTop != null ? pending.firstListTop - lastListTop : 0
    const cardDeltaY = pending.firstCardTop != null ? pending.firstCardTop - lastCardTop : 0
    const collapseDeltaY = cardDeltaY - listDeltaY

    const shiftedCards = []
    if (
      Math.abs(collapseDeltaY) > 1 &&
      pending.prevKey &&
      pending.prevKey !== activeStopKey
    ) {
      const prevIndex = orderedStops.findIndex((s) => favoriteKey(s) === pending.prevKey)
      if (prevIndex >= 0) {
        for (let i = prevIndex + 1; i < orderedStops.length; i += 1) {
          const el = stopCardRefs.current.get(favoriteKey(orderedStops[i]))
          if (el) shiftedCards.push(el)
        }
      }
    }

    const hasListShift = Math.abs(listDeltaY) > 1
    const hasCardShift = shiftedCards.length > 0
    if (!hasListShift && !hasCardShift) return

    if (hasListShift) {
      listEl.style.transition = 'none'
      listEl.style.transform = `translateY(${listDeltaY}px)`
    }
    for (const el of shiftedCards) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${collapseDeltaY}px)`
    }

    // 強制同步 reflow，讓初始位移在第一幀生效後再啟動平滑過渡
    void listEl.offsetHeight

    if (hasListShift) {
      listEl.style.transition = 'transform 300ms ease-out'
      listEl.style.transform = 'translateY(0px)'
    }
    for (const el of shiftedCards) {
      el.style.transition = 'transform 300ms ease-out'
      el.style.transform = 'translateY(0px)'
    }

    flipTimerRef.current = window.setTimeout(clearFlipStyles, 320)
  }, [activeStopKey, alignSeq, orderedStops, clearFlipStyles])

  const mapCenter = useMemo(
    () => (Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null),
    [lat, lng],
  )

  const isLocating = locationStatus === 'locating'

  return (
    <div className="space-y-3 [overflow-anchor:none]">
      {/* 置頂常駐地圖：避開固定 Header 的高度（--app-header-h）後貼在其下緣 */}
      <div
        ref={mapStickyRef}
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
            onToggleCollapse={toggleCollapse}
          />
        </Suspense>
      </div>

      {/* 位置錯誤（例如拒絕授權的 iOS 提示）以單行提示顯示，不佔用大卡片 */}
      {(locationError || etaError) && (
        <p className="flex items-start gap-1 px-1 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{locationError || etaError}</span>
        </p>
      )}

      {status === 'loading' && stops.length === 0 && <StopSkeleton rows={4} />}

      {status === 'error' && stops.length === 0 && (
        <ErrorState message={error} onRetry={reloadAll} />
      )}

      {status === 'ready' && stops.length === 0 && (
        <EmptyState title={t('nearby.emptyTitle')} description={t('nearby.emptyDesc')} />
      )}

      {stops.length > 0 && (
        <div ref={listRef} className="space-y-2">
          {orderedStops.map((stop) => {
            const key = favoriteKey(stop)
            const isExpanded = activeStopKey === key
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
                  disableAutoScroll
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

      <footer className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 pb-2 text-center text-xs leading-relaxed text-slate-400 dark:text-slate-500">
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
