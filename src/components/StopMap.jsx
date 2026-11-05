import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExternalLink, LocateFixed } from 'lucide-react'
import useTheme from '../hooks/useTheme.js'
import { favoriteKey } from '../hooks/useFavorites.js'

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
 * - 底圖跟隨深淺色主題：淺色用官方 OSM 圖磚，深色以 CSS filter 反轉，免 API Key。
 * - 藍點為使用者目前位置；附近站點以圖釘標示，選中的站點為琥珀色並顯示站名。
 * - 點擊圖釘會呼叫 `onSelectStop(stop)`，由 Nearby 展開站點卡片並捲動到該卡片。
 * - 右上角「在 Google Maps 開啟此站」為外部輔助（街景／步行導航），
 *   以 `target="_blank" rel="noopener noreferrer"` 另開新頁／喚醒 Google Maps App，
 *   不影響站內原視窗的瀏覽狀態；右下角為重新定位。
 *
 * @param {object} props
 * @param {{lat:number,lng:number}|null} [props.center] 使用者位置（地圖初始／更新視角）
 * @param {{lat:number,lng:number}|null} [props.userLocation] 藍點位置
 * @param {Array<object>} [props.stops] 附近站點（需含 lat／lng／nameTc）
 * @param {string|null} [props.selectedKey] 目前選中站點的 favoriteKey
 * @param {{key:string,lat:number,lng:number,seq:number}|null} [props.focus] 要 flyTo 的站點
 * @param {(stop:object) => void} [props.onSelectStop] 點擊站點圖釘
 * @param {() => void} [props.onLocate] 重新定位
 * @param {boolean} [props.locating] 定位中
 */
export default function StopMap({
  center = null,
  userLocation = null,
  stops = [],
  selectedKey = null,
  focus = null,
  onSelectStop,
  onLocate,
  locating = false,
}) {
  const isDark = useIsDark()
  const mapElRef = useRef(null)
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

  // 附近站點圖釘；選中站點高亮，並準備「在 Google Maps 開啟此站」的連結
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const layer = L.layerGroup().addTo(map)

    for (const stop of stops) {
      if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) continue
      const selected = favoriteKey(stop) === selectedKey
      const name = stop.nameTc || stop.nameEn || stop.id
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
  }, [stops, selectedKey, isDark, onSelectStop])

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

  const selectedStop = useMemo(
    () => stops.find((stop) => favoriteKey(stop) === selectedKey) ?? null,
    [stops, selectedKey],
  )

  const mapsUrl =
    selectedStop && Number.isFinite(selectedStop.lat) && Number.isFinite(selectedStop.lng)
      ? `https://www.google.com/maps/search/?api=1&query=${selectedStop.lat},${selectedStop.lng}`
      : null

  const handleLocate = useCallback(() => {
    onLocate?.()
    const map = mapRef.current
    if (map && userLocation) {
      map.flyTo([userLocation.lat, userLocation.lng], FOCUS_ZOOM, { duration: 0.6 })
    }
  }, [onLocate, userLocation])

  return (
    <section className="card overflow-hidden" aria-label="附近站點地圖">
      <div className="relative">
        <div
          ref={mapElRef}
          className="h-52 w-full"
          style={{ background: isDark ? '#1e293b' : '#e2e8f0' }}
          aria-label="附近站點互動地圖，點擊圖釘可展開對應站點"
        />

        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="在 Google Maps 開啟此站（可查看街景與步行導航）"
            className="absolute right-2 top-2 z-[1000] inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">在 Google Maps 開啟此站</span>
          </a>
        )}

        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          aria-label="重新定位"
          title="重新定位"
          className="absolute bottom-2 right-2 z-[1000] flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-600 shadow-md backdrop-blur transition hover:bg-white hover:text-sky-600 disabled:opacity-50 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-sky-400"
        >
          <LocateFixed className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
