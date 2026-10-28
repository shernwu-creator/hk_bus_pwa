import { useCallback, useEffect, useRef, useState } from 'react'
import { filterByRoute, getStopEtas } from '../services/api.js'

/** ETA 輪詢間隔：官方資料約每 30 秒更新一次 */
export const REFRESH_INTERVAL = 30000

const EMPTY_STATE = { groups: [], loading: false, refreshing: false, error: null, updatedAt: null }

/**
 * 整合 ETA 與票價的請求邏輯（含 30 秒輪詢）
 *
 * @param {Array<{operator:string,id:string,routes?:string[]}>} stopRefs
 *        要查詢的站點；請以 useMemo 保持陣列參照穩定，避免重複輪詢。
 * @param {{enabled?:boolean, intervalMs?:number, routeFilter?:string|null}} options
 * @returns {{groups:Array<{stop:object, routes:Array, error:string|null}>, loading:boolean, refreshing:boolean, error:string|null, updatedAt:number|null, refresh:() => void}}
 */
export default function useBusData(stopRefs = [], options = {}) {
  const { enabled = true, intervalMs = REFRESH_INTERVAL, routeFilter = null } = options
  const [state, setState] = useState(EMPTY_STATE)
  const [refreshToken, setRefreshToken] = useState(0)
  const stopsRef = useRef(stopRefs)
  stopsRef.current = stopRefs

  const key = stopRefs
    .map((stop) => `${stop.operator}:${stop.id}:${(stop.siblingIds ?? []).join(',')}`)
    .join('|')

  useEffect(() => {
    if (!enabled || !key) {
      setState(EMPTY_STATE)
      return undefined
    }

    let cancelled = false
    let timer = null
    const stops = stopsRef.current

    const load = async ({ silent }) => {
      if (!cancelled) {
        setState((prev) => ({
          ...prev,
          loading: !silent && prev.groups.length === 0,
          refreshing: silent || prev.groups.length > 0,
        }))
      }

      const results = await Promise.allSettled(stops.map((stop) => getStopEtas(stop)))
      if (cancelled) return

      const groups = stops.map((stop, index) => {
        const result = results[index]
        const routes = result.status === 'fulfilled' ? filterByRoute(result.value, routeFilter) : []
        return {
          stop,
          routes,
          error:
            result.status === 'rejected'
              ? result.reason?.message || '無法取得實時到站資料'
              : null,
        }
      })

      const allFailed = groups.length > 0 && groups.every((group) => group.error)
      setState({
        groups,
        loading: false,
        refreshing: false,
        error: allFailed ? '暫時無法取得到站資料，請稍後再試' : null,
        updatedAt: Date.now(),
      })

      timer = setTimeout(() => load({ silent: true }), intervalMs)
    }

    load({ silent: false })

    // 切到背景時停止輪詢，回到前景立即更新一次
    const handleVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer)
        timer = null
        return
      }
      if (!timer) load({ silent: true })
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
    // 站點清單以 key（operator:id）比對，避免父層每次 render 建立新陣列造成無限輪詢
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, intervalMs, routeFilter, refreshToken])

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), [])

  return { ...state, refresh }
}
