import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * 全站語言切換（'zh' 繁體中文／'en' 英文）
 *
 * - 以 React Context 提供，任何元件呼叫 `useLanguage()` 都會即時跟隨切換。
 * - 持久化在 localStorage 的 `hkb:lang`（讀寫以 try / catch 包覆，無痕模式失效時退回預設值）。
 * - `pickLang(tcText, enText)`：依目前語言挑選站名／目的地，避免中英雙語上下堆疊。
 * - `t(key, params)`：UI 字串字典，`{name}` 會被 params 取代。
 */

const STORAGE_KEY = 'hkb:lang'
const DEFAULT_LANG = 'zh'
const LANGUAGES = ['zh', 'en']

/** UI 字串字典：[繁體中文, English] */
const STRINGS = {
  'app.title': ['香港巴士實時到站', 'HK Bus Live ETA'],
  'app.subtitle': ['九巴 KMB · 城巴 CTB · 小巴 GMB · 票價與最近三班車', 'KMB · CTB · GMB · Fares & next 3 buses'],
  'app.language': ['語言', 'Language'],
  'app.themeDark': ['切換至深色模式', 'Switch to dark mode'],
  'app.themeLight': ['切換至淺色模式', 'Switch to light mode'],
  'app.loadingPage': ['頁面載入中', 'Loading page'],

  'nav.main': ['主要導覽', 'Main navigation'],
  'nav.nearby': ['附近', 'Nearby'],
  'nav.search': ['搜尋', 'Search'],
  'nav.favorites': ['收藏', 'Saved'],

  'common.retry': ['重試', 'Retry'],
  'common.reload': ['重新載入', 'Reload'],
  'common.errorTitle': ['資料讀取失敗', 'Failed to load data'],
  'common.refresh': ['更新', 'Refresh'],
  'common.stops': ['{n} 站', '{n} stops'],

  'direction.inbound': ['回程', 'Inbound'],
  'direction.outbound': ['去程', 'Outbound'],

  'nearby.locating': ['正在定位…', 'Locating…'],
  'nearby.fallback': ['使用預設位置', 'Using default location'],
  'nearby.located': ['已取得你的位置', 'Your location'],
  'nearby.waiting': ['等待定位結果…', 'Waiting for location…'],
  'nearby.accuracy': ['誤差約 {n} 公尺', '±{n} m'],
  'nearby.updated': ['{time} 更新', 'Updated {time}'],
  'nearby.relocate': ['重新定位', 'Relocate'],
  'nearby.refresh': ['更新附近站點', 'Refresh nearby stops'],
  'nearby.error': ['無法取得附近站點', 'Unable to load nearby stops'],
  'nearby.emptyTitle': ['附近找不到站點', 'No stops nearby'],
  'nearby.emptyDesc': [
    '500 公尺內沒有可查詢的九巴、城巴或小巴站點，請移動到其他位置或重新定位後再試。',
    'No KMB, CTB or GMB stops within 500 m. Move to another place or relocate and try again.',
  ],
  'nearby.source': [
    '資料來源：DATA.GOV.HK（九巴／城巴／小巴實時到站、運輸署票價）',
    'Source: DATA.GOV.HK (KMB / CTB / GMB arrivals, TD fares)',
  ],
  'nearby.etaData': ['到站資料 {time}', 'Arrivals {time}'],
  'nearby.fareData': ['票價表 {time}', 'Fare table {time}'],

  'map.label': ['附近站點地圖', 'Nearby stops map'],
  'map.aria': [
    '附近站點互動地圖，點擊圖釘可展開對應站點',
    'Interactive nearby stops map. Tap a pin to open its stop.',
  ],
  'map.googleMaps': ['在 Google Maps 開啟此站', 'Open this stop in Google Maps'],
  'map.googleMapsTitle': [
    '在 Google Maps 開啟此站（可查看街景與步行導航）',
    'Open this stop in Google Maps (Street View & walking directions)',
  ],

  'stop.platforms': ['{n} 個站位', '{n} platforms'],
  'stop.routes': ['{n} 條路線', '{n} routes'],
  'stop.favorite': ['收藏此站', 'Save this stop'],
  'stop.unfavorite': ['取消收藏此站', 'Remove this stop from saved'],
  'stop.unfavoriteGroup': ['取消收藏整個群組（{n} 個站位）', 'Remove the whole group ({n} platforms)'],
  'stop.groupTitle': ['此群組站位', 'Platforms in this group'],
  'stop.platform': ['站位 {n}', 'Platform {n}'],
  'stop.removeFavorite': ['取消收藏 {name}', 'Remove {name} from saved'],
  'stop.removeFavoriteTitle': ['取消收藏此站位', 'Remove this platform from saved'],
  'stop.expand': ['展開路線', 'Expand routes'],
  'stop.collapse': ['收起路線', 'Collapse routes'],
  'stop.errorTitle': ['此站點讀取失敗', 'Failed to load this stop'],
  'stop.emptyTitle': ['暫無到站資料', 'No arrivals'],
  'stop.emptyDesc': [
    '此站點目前沒有可查詢的路線，或所有路線均已收班。',
    'No routes available at this stop, or all services have ended.',
  ],
  'stop.showAll': ['顯示全部 {n} 條路線', 'Show all {n} routes'],
  'stop.showLess': ['只顯示最近 6 條路線', 'Show only the latest 6 routes'],

  'bus.destinationUnknown': ['目的地未提供', 'Destination unavailable'],
  'bus.fare': ['上車收費', 'Fare'],
  'bus.fareUnknown': ['票價待查', 'Fare unavailable'],
  'bus.last': ['最後班次', 'Last bus'],
  'bus.viewRoute': ['查看全線站序', 'View full route'],
  'bus.viewRouteAria': ['{route} 往 {dest}：查看全線站序', '{route} to {dest}: view full route'],

  'eta.min': ['分', 'min'],
  'eta.arriving': ['即將到站', 'Arriving'],
  'eta.noService': ['未有班次', 'No service'],
  'eta.arrival': ['{time} 到站', 'Arr. {time}'],
  'eta.base': ['推算基準', 'Base'],
  'eta.to': ['往 {dest}', 'To {dest}'],
  'eta.realtimeTitle': ['實時預計到站時間', 'Real-time arrival estimate'],
  'eta.selectAria': [
    '{label}，點擊以此班次推算後續各站到達時間',
    '{label}. Tap to estimate downstream arrivals from this bus.',
  ],
  'eta.selectedTitle': ['目前推算基準', 'Current base bus'],
  'eta.selectTitle': ['以此班次（{label}）推算後續各站', 'Estimate downstream stops from this bus ({label})'],

  'route.back': ['返回', 'Back'],
  'route.backAria': ['返回上一頁', 'Go back'],
  'route.full': ['全線站序', 'Full route'],
  'route.refreshNote': ['全線站序 · 到站資料每 30 秒自動更新', 'Full route · arrivals refresh every 30 s'],
  'route.reverse': ['反轉方向', 'Reverse'],
  'route.reversing': ['尋找反向…', 'Finding reverse…'],
  'route.reverseNotFound': [
    '找不到 {route} 的另一方向資料，這條路線可能只有單方向行駛。',
    'No reverse direction found for route {route}; it may only run one way.',
  ],
  'route.indexError': ['無法載入路線索引，請稍後再試。', 'Unable to load the route index. Please try again later.'],
  'route.missingParams': [
    '網址缺少業者或路線資料，請由站點的路線卡片重新開啟。',
    'The URL is missing operator or route data. Open it again from a stop route card.',
  ],
  'route.gmbMissing': [
    '此小巴路線缺少 routeId／routeSeq 參數，請由站點的路線卡片重新開啟。',
    'This GMB route is missing routeId/routeSeq. Open it again from a stop route card.',
  ],
  'route.loadError': ['無法取得站序資料', 'Unable to load the route stops'],
  'route.emptyTitle': ['此方向暫無站序資料', 'No stops for this direction'],
  'route.emptyDesc': [
    '官方目前沒有這條路線此方向的站點，請嘗試反轉方向或重新開啟。',
    'The operator has no stops for this direction. Try reversing the direction or open it again.',
  ],
  'route.missingMetaTitle': ['缺少小巴路線參數', 'Missing GMB route parameters'],
  'route.loadTitle': ['無法載入站序', 'Unable to load route stops'],
  'route.stopsLabel': ['全線站序 · {n} 站', 'Full route · {n} stops'],
  'route.current': ['本站', 'This stop'],
  'route.next3': ['最近三班車', 'Next 3 buses'],
  'route.viewNext3': ['查看最近三班車', 'Show next 3 buses'],
  'route.planBaseArrival': ['推算基準 · {time} 到站', 'Base · arr. {time}'],
  'route.planBaseLoading': ['推算基準（正在取得班次…）', 'Base (loading bus…)'],
  'route.planBaseNone': ['推算基準（暫無實時班次）', 'Base (no real-time bus)'],
  'route.etaError': ['無法取得實時到站資料', 'Unable to load real-time arrivals'],
  'route.noEta': [
    '此方向暫無實時到站資料，可能已收班或班次未開始。',
    'No real-time arrivals for this direction; service may have ended or not started yet.',
  ],
  'route.updated': ['資料更新 {time} · 每 30 秒自動更新', 'Updated {time} · auto-refresh every 30 s'],
  'route.loadingEta': ['正在取得實時到站資料…', 'Loading real-time arrivals…'],
  'route.refreshAria': ['立即更新到站時間', 'Refresh arrivals now'],
  'route.title': ['香港巴士站序', 'HK Bus Route'],
  'route.source': [
    '資料來源：DATA.GOV.HK · 九巴 KMB／城巴 CTB／專線小巴 GMB',
    'Source: DATA.GOV.HK · KMB / CTB / GMB',
  ],
  'route.expandStop': ['展開此站到站時間', 'Show arrivals for this stop'],
  'route.collapseStop': ['收合此站到站時間', 'Hide arrivals for this stop'],
  'route.origin': ['起點', 'Origin'],
  'route.destination': ['終點', 'Destination'],
  'route.to': ['往 {dest}', 'To {dest}'],

  'panel.backAria': ['返回路線搜尋', 'Back to route search'],
  'panel.emptyTitle': ['此方向暫無站點資料', 'No stops for this direction'],
  'panel.emptyDesc': ['請返回上一頁選擇其他方向。', 'Go back and choose another direction.'],

  'search.placeholder': ['輸入路線號碼，例如 1A、680、A21', 'Enter a route number, e.g. 1A, 680, A21'],
  'search.label': ['搜尋路線', 'Search routes'],
  'search.clear': ['清除搜尋', 'Clear search'],
  'search.popular': ['熱門路線', 'Popular routes'],
  'search.popularDesc': [
    '輸入完整或部分路線號碼即可同時搜尋九巴、城巴與專線小巴路線；選定方向後可展開任一站點，查看該路線最近三班車。',
    'Type a full or partial route number to search KMB, CTB and GMB routes. Pick a direction, then expand any stop to see the next 3 buses.',
  ],
  'search.notFound': ['找不到「{query}」路線', 'No routes found for “{query}”'],
  'search.notFoundDesc': [
    '請確認路線號碼，或改用部分號碼搜尋（例如 68、A2）。',
    'Check the route number, or search with a partial number (e.g. 68, A2).',
  ],
  'search.found': ['找到 {n} 個路線方向，點選後查看站序', '{n} route directions found. Tap one to view its stops.'],
  'search.to': ['往 {dest}', 'To {dest}'],
  'search.indexError': ['無法取得路線清單', 'Unable to load the route list'],
  'search.stopsError': ['無法取得站序資料', 'Unable to load route stops'],

  'saved.title': ['已收藏 {n} 個站點', '{n} saved stops'],
  'saved.grouped': ['（整合為 {n} 個車站）', ' ({n} stations)'],
  'saved.note': ['收藏只儲存在此裝置，不會同步到其他裝置', 'Saved only on this device; not synced.'],
  'saved.clear': ['清除', 'Clear'],
  'saved.confirm': ['確定要清除全部收藏站點嗎？', 'Remove all saved stops?'],
  'saved.emptyTitle': ['尚未收藏站點', 'No saved stops yet'],
  'saved.emptyDesc': [
    '在附近或路線站序清單中點選星號，即可把常用站點加入收藏，下次開啟 App 立即查看。',
    'Tap the star next to any stop in Nearby or route stops to save it for quick access next time.',
  ],
  'saved.goNearby': ['前往附近站點', 'Go to nearby stops'],
  'saved.latest': ['最近收藏：{time}', 'Latest saved: {time}'],
  'saved.partialFail': [
    '{n} 個站位暫時讀取失敗，僅顯示可用的班次',
    '{n} platforms failed to load; showing available buses only',
  ],

  'plan.toggleOn': ['推算各站到站時間', 'Estimate arrivals'],
  'plan.toggleOff': ['關閉到站推算', 'Hide arrival estimate'],
  'plan.toggleTitleOn': [
    '以本站最近一班車推算後續各站到達時間',
    'Estimate downstream arrival times from the next bus at this stop',
  ],
  'plan.toggleTitleOff': ['關閉推算，回到一般站序', 'Turn off estimates and return to the normal route list'],
  'plan.base': ['推算基準：{name}', 'Base: {name}'],
  'plan.terminusSuffix': ['（終點站）', ' (terminus)'],
  'plan.etaLabel': ['第 {n} 班', 'Bus {n}'],
  'plan.loadingBase': ['正在取得基準班次…', 'Loading base bus…'],
  'plan.noRealtime': ['暫無實時班次', 'No real-time bus'],
  'plan.noDownstream': [
    '此站已是路線終點，沒有後續站點可推算。',
    'This is the terminus; there are no downstream stops to estimate.',
  ],
  'plan.assumption': [
    '以每站約 {dwell} 秒停站、平均 {speed} km/h（直線距離 × {detour} 繞行係數）推算',
    'Assumes ~{dwell}s dwell per stop and {speed} km/h average (straight-line distance × {detour} detour factor)',
  ],
  'plan.terminusMinutes': ['，到終點約 {n} 分', ', about {n} min to the terminus'],
  'plan.clickHint': ['；點擊任一站點的班次可切換推算基準。', '; tap a bus slot at any stop to change the base.'],
  'plan.loadingBaseDesc': [
    '正在取得基準站的最近三班車，取得後會自動顯示預計到達時間。',
    'Loading the next 3 buses at the base stop; estimated arrival times will appear automatically.',
  ],
  'plan.pureEstimate': [
    '目前沒有實時班次，以下僅顯示純車程推算（未計候車時間）；展開任一站點可取得實時到站時間。',
    'No real-time buses right now. Only travel-time estimates are shown (excluding waiting time); expand any stop for real-time arrivals.',
  ],
  'plan.approximateSuffix': [
    '（部分站點缺少座標，以平均站距代替，數值僅供參考）',
    ' (Some stops lack coordinates; average stop spacing is used. Estimates are for reference only.)',
  ],
  'plan.chipTravel': ['+{n} 分鐘車程', '+{n} min travel'],
  'plan.chipTravelShort': ['+{n} 分', '+{n} min'],
  'plan.chipArrive': ['{time} 到達', 'Arr. {time}'],
  'plan.chipTravelTitle': [
    '依座標與平均車速推算的累計車程約 {n} 分鐘',
    'Estimated cumulative travel time ≈ {n} min based on coordinates and average speed',
  ],
  'plan.chipLiveTitle': [
    '依該站官方實時到站時間推算（推測為同一班車，仍可能有偏差）',
    'Estimated from that stop’s official real-time arrival (assumed same bus; may still vary)',
  ],
  'plan.chipEstimateTitle': [
    '依車程推算的預計到達時間，實際仍受路況影響',
    'Estimated arrival based on travel time; traffic may affect it',
  ],
}

function interpolate(template, params) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    params[key] == null ? match : String(params[key]),
  )
}

/** 依語言取出字典字串（供 Provider 與非 React 情境共用） */
export function translate(lang, key, params) {
  const entry = STRINGS[key]
  if (!entry) return key
  return interpolate(lang === 'en' ? entry[1] : entry[0], params)
}

function readLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (LANGUAGES.includes(stored)) return stored
  } catch {
    // localStorage 不可用時使用預設語言
  }
  return DEFAULT_LANG
}

const LanguageContext = createContext(null)

/**
 * 語言 Provider：放在 Router 外層，讓所有頁面與元件即時響應切換。
 */
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readLang)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // 無法寫入時僅本回合有效
    }
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-HK'
  }, [lang])

  const setLang = useCallback((next) => {
    setLangState(LANGUAGES.includes(next) ? next : DEFAULT_LANG)
  }, [])

  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'en' ? 'zh' : 'en'))
  }, [])

  const value = useMemo(() => {
    const pickLang = (tcText, enText) => {
      if (lang === 'en') return enText || tcText || ''
      return tcText || enText || ''
    }
    const t = (key, params) => translate(lang, key, params)
    return { lang, isEn: lang === 'en', setLang, toggleLang, pickLang, t }
  }, [lang, setLang, toggleLang])

  return createElement(LanguageContext.Provider, { value }, children)
}

/**
 * @returns {{lang: 'zh'|'en', isEn: boolean, setLang: (next: 'zh'|'en') => void, toggleLang: () => void, pickLang: (tcText?: string, enText?: string) => string, t: (key: string, params?: object) => string}}
 */
export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage 必須在 <LanguageProvider> 內使用')
  return context
}

export default useLanguage
