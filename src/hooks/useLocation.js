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

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 60 * 1000,
}

function describeError(error) {
  switch (error?.code) {
    case 1:
      return '已拒絕定位權限，暫用預設位置。可在瀏覽器設定中重新允許。'
    case 2:
      return '無法取得定位訊號，暫用預設位置。'
    case 3:
      return '定位逾時，暫用預設位置。'
    default:
      return '定位失敗，暫用預設位置。'
  }
}

function geolocationSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

/**
 * 初始狀態：支援定位時直接標記為 locating，
 * 讓「掛載後自動定位」不必在 effect 內同步 setState（react/set-state-in-effect）。
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

  return {
    coords: null,
    status: 'locating',
    accuracy: null,
    error: null,
    isFallback: false,
    updatedAt: null,
    permission: 'unknown',
  }
}

/**
 * 處理 Geolocation 授權與經緯度
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
        setState({
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          status: 'success',
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          error: null,
          isFallback: false,
          updatedAt: Date.now(),
          permission: 'granted',
        })
      },
      (error) => {
        if (requestId.current !== currentRequest) return
        setState({
          coords: { lat: FALLBACK_LOCATION.lat, lng: FALLBACK_LOCATION.lng },
          status: 'fallback',
          accuracy: null,
          error: describeError(error),
          isFallback: true,
          updatedAt: Date.now(),
          permission: error?.code === 1 ? 'denied' : 'unknown',
        })
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

  // 進入頁面即請求定位（初始 state 已標記為 locating）
  useEffect(() => {
    if (!geolocationSupported()) return undefined
    requestPosition()
    return undefined
  }, [requestPosition])

  // 讀取權限狀態，讓 UI 可以提示「已封鎖定位」
  useEffect(() => {
    if (!navigator.permissions?.query) return undefined
    let cancelled = false
    let permissionStatus = null

    const syncPermission = () => {
      if (cancelled) return
      setState((prev) => ({ ...prev, permission: permissionStatus?.state ?? 'unknown' }))
    }

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled) return
        permissionStatus = status
        syncPermission()
        status.addEventListener?.('change', syncPermission)
      })
      .catch(() => {
        // 部分瀏覽器（例如 Safari）不支援 permissions.query，忽略即可
      })

    return () => {
      cancelled = true
      permissionStatus?.removeEventListener?.('change', syncPermission)
    }
  }, [])

  return { ...state, locate }
}
