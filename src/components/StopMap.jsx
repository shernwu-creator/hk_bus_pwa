import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed, RefreshCw } from 'lucide-react'
import useTheme from '../hooks/useTheme.js'
import useLanguage from '../hooks/useLanguage.js'
import { favoriteKey } from '../hooks/useFavorites.js'
import { formatClock } from '../utils/format.js'

/**
 * 官方 OpenStreetMap 圖磚：免費、免 API Key（不再使用會顯示 API KEY REQUIRED 浮水印的 CartoDB）。
 * OSM 只有淺色圖磚，深色模式另外以 CSS filter 反轉（見 index.css 的 .map-tiles-dark）。
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

/** 尚未取得定位時的預設視角（維多利亞港兩岸） */
const DEFAULT_CENTER = { lat: 22.3027, lng: 114.1772 }
const FOCUS_ZOOM = 16

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}

/**
 * 站點圖釘：選中的站點放大為琥珀色並顯示站名標籤，其餘為天藍色圓點。
 * 使用 divIcon 取代 Leaflet 預設圖片圖釘，避免 bundler 找不到 marker-icon.png。
 */
function createStopIcon({ name, selected, isDark }) {
  const size = selected ? 16 : 12
  const color = selected ? '#f59e0b' : isDark ? '#38bdf8' : '#0284c7'
  const pin = `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(15,23,42,.45)"></span>`
  const label = selected
    ? `<span style="position:absolute;left:${size + 6}px;top:50%;transform:translateY(-50%);white-space:nowrap;border-radius:9999px;padding:2px 8px;font-size:11px;font-weight:600;line-height:1.5;background:${
        isDark ? 'rgba(15,23,42,.92)' : 'rgba(255,255,255,.96)'
      };color:${isDark ? '#f8fafc' : '#0f172a'};box-shadow:0 2px 8px rgba(15,23,42,.25)">${escapeHtml(name)}</span>`
    : ''

  return L.divIcon({
    className: 'hkb-stop-pin',
    html: `<span style="position:relative;display:block;width:${size}px;height:${size}px">${pin}${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/**
 * 地圖必須跟著主題即時換底圖，但頁首的 useTheme 是獨立 hook 實例，
 * 切換主題不會令這個元件重新渲染，因此訂閱 <html class="dark"> 的變化。
 */
function useIsDark() {
  const { isDark } = useTheme()
  const [domDark, setDomDark] = useState(() =>
    typeof document === 'undefined' ? isDark : document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDomDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return domDark
}

/**
 * 附近站點互動地圖（Leaflet + OpenStreetMap）
 *
 * 款式 B：毛玻璃外框；地圖高度可在 `collapsed` 之間平滑切換（210px ↔ 138px，約縮小 1/3），
 * 由 `Nearby` 依 window.scrollY 控制，讓地圖在往下瀏覽站點時仍置頂常駐。
 *
 * - 底圖跟隨深淺色主題：淺色用官方 OSM 圖磚，深色以 CSS filter 反轉，免 API Key。
 * - 藍點為使用者目前位置；附近站點以圖釘標示，選中的站點為琥珀色並顯示站名。
 * - 點擊圖釘會呼叫 `onSelectStop(stop)`，由 Nearby 展開站點卡片並捲動到該卡片。
 * - 右上角「在 Google Maps 開啟 ↗」常駐（優先目前選中站點，其次使用者位置／地圖中心），
 *   以 `target="_blank" rel="noopener noreferrer"` 另開新頁／喚醒 Google Maps App。
 * - 地圖底部內嵌定位狀態膠囊：綠點、狀態文字、重新定位／更新按鈕；
 *   收起時多一顆「展開全圖」按鈕，讓使用者暫時恢復完整高度。
 *
 * @param {object} props
 * @param {{lat:number,lng:number}|null} [props.center] 使用者位置（地圖初始／更新視角）
 * @param {{lat:number,lng:number}|null} [props.userLocation] 藍點位置
 * @param {Array<object>} [props.stops] 附近站點（需含 lat／lng／nameTc）
 * @param {string|null} [props.selectedKey] 目前選中站點的 favoriteKey
 * @param {{key:string,lat:number,lng:number,seq:number}|null} [props.focus] 要 flyTo 的站點
 * @param {(stop:object) => void} [props.onSelectStop] 點擊站點圖釘
 * @param {() => void} [props.onLocate] 重新定位
 * @param {() => void} [props.onRefresh] 重新整理附近站點與 ETA
 * @param {boolean} [props.locating] 定位中
 * @param {boolean} [props.refreshing] 附近站點更新中
 * @param {boolean} [props.isFallback] 目前使用預設／上次位置
 * @param {number|null} [props.accuracy] 定位誤差（公尺）
 * @param {number|null} [props.updatedAt] 定位更新時間
 * @param {boolean} [props.collapsed] 是否縮小為 138px
 * @param {() => void} [props.onToggleCollapse] 點擊「展開全圖」時切換高度
 */
export default function StopMap({
  center = null,
  userLocation = null,
  stops = [],
  selectedKey = null,
  focus = null,
  onSelectStop,
  onLocate,
  onRefresh,
  locating = false,
  refreshing = false,
  isFallback = false,
  accuracy = null,
  updatedAt = null,
  collapsed = false,
  onToggleCollapse,
}) {
  const isDark = useIsDark()
  const { t, pickLang } = useLanguage()
  const mapElRef = useRef(null)
  const mapWrapRef = useRef(null)
  const mapRef = useRef(null)
  // 只有第一次掛載時需要初始視角，之後的移動交給 center／focus 兩個 effect
  const initialCenterRef = useRef(center)

  useEffect(() => {
    const container = mapElRef.current
    if (!container) return undefined
    const initialCenter = initialCenterRef.current ?? DEFAULT_CENTER
    const map = L.map(container, {
      center: [initialCenter.lat, initialCenter.lng],
      zoom: FOCUS_ZOOM,
      zoomControl: true,
      attributionControl: false,
      // 手機單指上下滑頁面時不要被地圖劫持；雙指縮放仍可用
      scrollWheelZoom: false,
    })
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map)
    mapRef.current = map

    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [])

  // OSM 只有淺色圖磚；深色模式加 .map-tiles-dark 以 CSS filter 反轉，主題改變時整層換掉
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const tiles = L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      className: isDark ? 'map-tiles-dark' : '',
    })
    tiles.addTo(map)
    return () => {
      if (map.hasLayer(tiles)) map.removeLayer(tiles)
    }
  }, [isDark])

  // 附近站點圖釘；選中站點高亮
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const layer = L.layerGroup().addTo(map)

    for (const stop of stops) {
      if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) continue
      const selected = favoriteKey(stop) === selectedKey
      const name = pickLang(stop.nameTc, stop.nameEn) || stop.id
      const marker = L.marker([stop.lat, stop.lng], {
        icon: createStopIcon({ name, selected, isDark }),
        title: name,
        alt: name,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0,
      })
      marker.on('click', () => onSelectStop?.(stop))
      marker.addTo(layer)
    }

    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [stops, selectedKey, isDark, onSelectStop, pickLang])

  // 使用者目前位置藍點
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const layer = L.layerGroup().addTo(map)
    if (userLocation) {
      L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 18,
        stroke: false,
        fillColor: '#2563eb',
        fillOpacity: 0.16,
        interactive: false,
      }).addTo(layer)
      L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 6,
        weight: 2.5,
        color: '#ffffff',
        fillColor: '#2563eb',
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer)
    }
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [userLocation])

  // 定位更新時把視角帶回使用者位置
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    map.setView([center.lat, center.lng], FOCUS_ZOOM, { animate: true })
  }, [center])

  // 列表點擊或預設站點變更時，平滑移動到該站點
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), FOCUS_ZOOM), { duration: 0.8 })
  }, [focus])

  // 高度切換（210px → 138px）後 Leaflet 必須重算容器尺寸，否則圖磚與中心點會偏移。
  // transitionend 與保險計時器各觸發一次（部分環境不會觸發 transitionend）。
  useEffect(() => {
    const element = mapWrapRef.current
    if (!element) return undefined
    const invalidate = () => mapRef.current?.invalidateSize()
    element.addEventListener('transitionend', invalidate)
    const timer = window.setTimeout(invalidate, 320)
    return () => {
      element.removeEventListener('transitionend', invalidate)
      window.clearTimeout(timer)
    }
  }, [collapsed])

  const selectedStop = useMemo(
    () => stops.find((stop) => favoriteKey(stop) === selectedKey) ?? null,
    [stops, selectedKey],
  )

  // Google Maps 常駐連結：優先目前選中站點 → 使用者位置 → 地圖中心 → 預設視角
  const mapsTarget = useMemo(() => {
    if (
      selectedStop &&
      Number.isFinite(selectedStop.lat) &&
      Number.isFinite(selectedStop.lng)
    ) {
      return selectedStop
    }
    if (userLocation) return userLocation
    if (center) return center
    return DEFAULT_CENTER
  }, [selectedStop, userLocation, center])

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsTarget.lat},${mapsTarget.lng}`

  const handleLocate = useCallback(() => {
    onLocate?.()
    const map = mapRef.current
    if (map && userLocation) {
      map.flyTo([userLocation.lat, userLocation.lng], FOCUS_ZOOM, { duration: 0.6 })
    }
  }, [onLocate, userLocation])

  const statusText = locating
    ? t('nearby.locating')
    : isFallback
      ? t('nearby.fallback')
      : t('nearby.located')
  const dotClass = locating
    ? 'animate-pulse bg-sky-500'
    : isFallback
      ? 'bg-amber-500'
      : 'bg-emerald-500'
  const details = [
    Number.isFinite(accuracy) ? t('nearby.accuracy', { n: Math.round(accuracy) }) : '',
    updatedAt ? t('nearby.updated', { time: formatClock(updatedAt) }) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section aria-label={t('map.label')} className="relative">
      <div
        ref={mapWrapRef}
        className={`relative overflow-hidden rounded-[22px] border border-white/80 bg-white/85 shadow-card backdrop-blur-xl transition-[height] duration-300 ease-out dark:border-slate-700/70 dark:bg-slate-800/80 ${
          collapsed ? 'h-[138px]' : 'h-[210px]'
        }`}
      >
        <div
          ref={mapElRef}
          className="hkb-map h-full w-full"
          style={{ background: isDark ? '#1e293b' : '#e2e8f0' }}
          aria-label={t('map.aria')}
        />

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t('map.googleMapsTitle')}
          className="absolute right-2 top-2 z-[1000] inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="truncate">{t('map.googleMaps')}</span>
          <span aria-hidden="true">↗</span>
        </a>

        {/* 底部內嵌定位狀態膠囊（單行）；收起時可點「展開全圖」暫時恢復完整高度 */}
        <div className="absolute inset-x-2.5 bottom-2 z-[400] flex items-center gap-1.5 rounded-full border border-white/70 bg-white/90 py-1 pl-3 pr-1 shadow-sm backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-800/90">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[11px] leading-4">
            <span className="font-semibold text-slate-700 dark:text-slate-100">
              {statusText}
            </span>
            {details && !collapsed && (
              <span className="ml-1 text-slate-500 dark:text-slate-400">· {details}</span>
            )}
          </span>
          {collapsed && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={t('map.expand')}
              title={t('map.expand')}
              className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 transition hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-200 dark:hover:bg-sky-500/30"
            >
              {t('map.expand')} ▼
            </button>
          )}
          <button
            type="button"
            onClick={handleLocate}
            disabled={locating}
            aria-label={t('nearby.relocate')}
            title={t('nearby.relocate')}
            className="shrink-0 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/60"
          >
            <LocateFixed className={`h-3.5 w-3.5 ${locating ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={t('nearby.refresh')}
              title={t('common.refresh')}
              className="shrink-0 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
