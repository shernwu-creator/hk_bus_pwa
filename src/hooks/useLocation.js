import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 定位失敗時的後備座標（尖沙咀天星碼頭一帶），
 * 讓使用者在拒絕授權或室內收不到 GPS 時仍能試用 App。
 */
export const FALLBACK_LOCATION = {
  lat: 22.294639,
  lng: 114.169976,
  label: '尖沙咀（預設位置）',
}

/** 定位授權記憶：只有 'granted' 是有效值，其他值（含舊版沒有此 key）視為未授權 */
const CONSENT_KEY = 'hkb:location-consent'
/** 上次成功取得的座標快取：{ lat, lng, accuracy, updatedAt } */
const LAST_LOCATION_KEY = 'hkb:last-location'
const CONSENT_GRANTED = 'granted'

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 60 * 1000,
}

/** localStorage 在無痕模式／被停用時可能 throw：讀寫一律包 try / catch，失敗不影響定位 */
function readStorage(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 無法寫入時只是少了下次的定位記憶，定位功能不受影響
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // 忽略：無法清除時下次仍會嘗試自動定位，最壞情況只是多一次失敗
  }
}

/**
 * 讀取「已授權」記憶。
 * iOS Safari 不支援 `navigator.permissions.query({ name: 'geolocation' })`，
 * 是否還需要重新詢問系統權限全靠這個值。
 */
function readConsent() {
  return readStorage(CONSENT_KEY) === CONSENT_GRANTED
}

/** 讀取上次成功的座標；JSON 壞掉、欄位缺漏或數值不合理時回傳 null（不 throw） */
function readCachedLocation() {
  const raw = readStorage(LAST_LOCATION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const lat = Number(parsed?.lat)
    const lng = Number(parsed?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
    return {
      lat,
      lng,
      accuracy: Number.isFinite(parsed?.accuracy) ? parsed.accuracy : null,
      updatedAt: Number.isFinite(parsed?.updatedAt) ? parsed.updatedAt : null,
    }
  } catch {
    return null
  }
}

/** 成功取得定位時寫入授權記憶與最新座標 */
function rememberLocation(coords, accuracy, updatedAt) {
  writeStorage(CONSENT_KEY, CONSENT_GRANTED)
  writeStorage(
    LAST_LOCATION_KEY,
    JSON.stringify({ lat: coords.lat, lng: coords.lng, accuracy, updatedAt }),
  )
}

function describeError(error, hasCoords = false) {
  const suffix = hasCoords ? '暫用上次位置。' : '暫用預設位置。'
  switch (error?.code) {
    case 1:
      // 友善提示：iOS／PWA 的定位權限藏在 Safari 網站設定裡，加入主畫面後也會沿用系統授權
      return `已拒絕定位權限，${suffix}iOS 用戶可於 Safari 網址列左側「網站設定 › 位置 › 允許」，或把本站「加入主畫面」後重新允許定位，即可永久免除系統詢問。`
    case 2:
      return `無法取得定位訊號，${suffix}`
    case 3:
      return `定位逾時，${suffix}`
    default:
      return `定位失敗，${suffix}`
  }
}

function geolocationSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

/**
 * 定位失敗時的狀態：保留已快取的座標（若有），否則用預設位置；
 * 授權被拒（code 1）時同步清除「已授權」記憶，避免下次仍誤以為可以直接自動定位。
 */
function buildFailureState(prev, error) {
  if (error?.code === 1) removeStorage(CONSENT_KEY)
  const hasCoords = Number.isFinite(prev?.coords?.lat) && Number.isFinite(prev?.coords?.lng)
  return {
    ...prev,
    coords: hasCoords ? prev.coords : { lat: FALLBACK_LOCATION.lat, lng: FALLBACK_LOCATION.lng },
    status: 'fallback',
    accuracy: hasCoords ? prev.accuracy : null,
    error: describeError(error, hasCoords),
    isFallback: !hasCoords,
    updatedAt: hasCoords ? prev.updatedAt : Date.now(),
    permission: error?.code === 1 ? 'denied' : (prev?.permission ?? 'unknown'),
  }
}

/**
 * 初始狀態：
 * - 有上次成功的座標 → 立刻用快取座標渲染（附近站點不必等 GPS），背景再靜默更新。
 * - 沒有快取 → 標記 locating，讓掛載後的自動定位不必在 effect 內同步 setState。
 */
function getInitialLocationState() {
  if (!geolocationSupported()) {
    return {
      coords: { lat: FALLBACK_LOCATION.lat, lng: FALLBACK_LOCATION.lng },
      status: 'unsupported',
      accuracy: null,
      error: '此裝置或瀏覽器不支援定位，暫用預設位置。',
      isFallback: true,
      updatedAt: Date.now(),
      permission: 'unknown',
    }
  }

  const cached = readCachedLocation()
  if (cached) {
    return {
      coords: { lat: cached.lat, lng: cached.lng },
      status: 'success',
      accuracy: cached.accuracy,
      error: null,
      isFallback: false,
      updatedAt: cached.updatedAt,
      permission: readConsent() ? 'granted' : 'unknown',
    }
  }

  return {
    coords: null,
    status: 'locating',
    accuracy: null,
    error: null,
    isFallback: false,
    updatedAt: null,
    permission: readConsent() ? 'granted' : 'unknown',
  }
}

/**
 * 處理 Geolocation 授權與經緯度
 *
 * 以 localStorage 記憶授權與上次座標（向下相容：沒有資料時行為與舊版相同）：
 * - 成功定位 → 寫入 `hkb:location-consent = 'granted'` 與 `hkb:last-location`。
 * - 初始化 → 先以快取座標渲染，再自動靜默更新；已授權時不再要求手動點按鈕。
 * - 拒絕授權 → 清除 `hkb:location-consent`，並提示 iOS 使用者重新允許的方法。
 *
 * @returns {{coords: {lat:number,lng:number}|null, status: 'idle'|'locating'|'success'|'fallback'|'unsupported', accuracy: number|null, error: string|null, isFallback: boolean, updatedAt: number|null, permission: string, locate: () => void}}
 */
export default function useLocation() {
  const [state, setState] = useState(getInitialLocationState)
  const requestId = useRef(0)

  // 只送出定位請求；狀態更新一律在 geolocation 回呼中非同步發生
  const requestPosition = useCallback(() => {
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId.current !== currentRequest) return
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
        const updatedAt = Date.now()
        // 記住授權與最新座標：下次開啟可直接用快取渲染並自動更新
        rememberLocation(coords, accuracy, updatedAt)
        setState({
          coords,
          status: 'success',
          accuracy,
          error: null,
          isFallback: false,
          updatedAt,
          permission: 'granted',
        })
      },
      (error) => {
        if (requestId.current !== currentRequest) return
        setState((prev) => buildFailureState(prev, error))
      },
      GEO_OPTIONS,
    )
  }, [])

  // 使用者主動重新定位（事件處理器內同步 setState 是允許的）
  const locate = useCallback(() => {
    if (!geolocationSupported()) {
      setState((prev) => ({
        ...prev,
        coords: { lat: FALLBACK_LOCATION.lat, lng: FALLBACK_LOCATION.lng },
        status: 'unsupported',
        error: '此裝置或瀏覽器不支援定位，暫用預設位置。',
        isFallback: true,
        updatedAt: Date.now(),
      }))
      return
    }

    setState((prev) => ({ ...prev, status: 'locating', error: null }))
    requestPosition()
  }, [requestPosition])

  // 初始化：查詢瀏覽器權限狀態後自動定位。
  // - 有 `hkb:location-consent = 'granted'` 或瀏覽器回報 granted → 直接呼叫 getCurrentPosition，
  //   已授權的使用者不必再手動點「重新定位」。
  // - 權限是 prompt（首次使用）→ 仍自動請求一次，讓系統授權視窗有機會出現。
  // - 權限已被明確拒絕 → 不自動請求，改顯示友善提示（使用者仍可按按鈕重試）。
  // - Safari／iOS 不支援 permissions.query → 自動請求，並依賴 localStorage 的授權記憶。
  useEffect(() => {
    if (!geolocationSupported()) return undefined
    let cancelled = false
    let permissionStatus = null

    const applyPermission = (permissionState) => {
      if (cancelled) return
      if (permissionState === 'denied') {
        removeStorage(CONSENT_KEY)
        setState((prev) => buildFailureState(prev, { code: 1 }))
        return
      }
      setState((prev) => ({ ...prev, permission: permissionState }))
    }

    const autoLocate = (permissionState) => {
      if (cancelled || permissionState === 'denied') return
      requestPosition()
    }

    const handlePermissionChange = () => {
      if (cancelled || !permissionStatus) return
      applyPermission(permissionStatus.state)
      // 使用者到瀏覽器設定改成「允許」後回到 App：直接補一次定位
      if (permissionStatus.state === 'granted') requestPosition()
    }

    if (!navigator.permissions?.query) {
      autoLocate('unknown')
      return () => {
        cancelled = true
      }
    }

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled) return
        permissionStatus = status
        applyPermission(status.state)
        autoLocate(status.state)
        status.addEventListener?.('change', handlePermissionChange)
      })
      .catch(() => {
        // 部分瀏覽器（例如 Safari）不支援 permissions.query，忽略即可
        autoLocate('unknown')
      })

    return () => {
      cancelled = true
      permissionStatus?.removeEventListener?.('change', handlePermissionChange)
    }
  }, [requestPosition])

  return { ...state, locate }
}
