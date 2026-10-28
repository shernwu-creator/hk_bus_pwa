import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Route as RouteIcon } from 'lucide-react'
import { getRouteStops } from '../services/api.js'

/**
 * 路線全站序（嵌在 ETA 卡片內，由 StopSection 控制展開／收合）
 *
 * 用途：在「附近站點 / 收藏 / 路線站序」的站點卡片裡，點一下某條路線，
 * 就能看到這條路線（含方向）的完整站序，並標示使用者目前所在的站點。
 *
 * @param {object} props
 * @param {{operator:string, route:string, direction:string, serviceType:string, routeId?:number, routeSeq?:number, orig?:string, destination?:string}} props.entry
 * @param {Array<string>} [props.currentStopIds] 目前展開的站點編號（含同一車站的其他月台），會標示「本站」
 */
export default function RouteDetail({ entry, currentStopIds = [] }) {
  const [stops, setStops] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const listRef = useRef(null)
  const currentRef = useRef(null)

  const { operator, route, direction, serviceType, routeId, routeSeq } = entry ?? {}

  // 只取基本型別當依賴，避免 30 秒輪詢換掉 entry 物件參照時重複請求
  const params = useMemo(
    () => ({ operator, route, direction, serviceType, routeId, routeSeq }),
    [operator, route, direction, serviceType, routeId, routeSeq],
  )

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)

    getRouteStops(params)
      .then((list) => {
        if (cancelled) return
        setStops(list)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setStops([])
        setStatus('error')
        setError(err?.message ?? '無法取得站序資料')
      })

    return () => {
      cancelled = true
    }
  }, [params, reloadToken])

  const orig = stops[0]?.nameTc || entry?.orig || ''
  const destination = entry?.destination || ''
  const hasStops = status === 'ready' && stops.length > 0
  const currentIds = new Set(currentStopIds.filter(Boolean))

  // 站序較長時把「本站」捲到清單中央（只捲動清單本身，不用 scrollIntoView 以免整頁跳動）
  useEffect(() => {
    const list = listRef.current
    const item = currentRef.current
    if (!list || !item) return
    list.scrollTop = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2)
  }, [stops])

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1 px-1 text-[11px] text-slate-500 dark:text-slate-400">
        <RouteIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {orig || '起點'} → {destination || '終點'}
        </span>
        <span className="chip shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {direction === 'inbound' ? '回程' : '去程'}
        </span>
        {status === 'ready' && <span className="shrink-0">· {stops.length} 站</span>}
      </p>

      {status === 'loading' && (
        <div className="space-y-1.5 px-1 py-1" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-3.5" />
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="chip shrink-0 bg-white px-2 py-0.5 text-rose-600 transition hover:bg-rose-100 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            重試
          </button>
        </div>
      )}

      {status === 'ready' && stops.length === 0 && (
        <p className="px-1 text-[11px] text-slate-400 dark:text-slate-500">此方向暫無站點資料。</p>
      )}

      {hasStops && (
        <ol
          ref={listRef}
          className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl bg-slate-50/80 p-1 dark:bg-slate-800/40"
        >
          {stops.map((stop) => {
            const isCurrent = currentIds.has(stop.id)
            return (
              <li
                key={`${stop.id}-${stop.seq}`}
                ref={isCurrent ? currentRef : null}
                className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs ${
                  isCurrent
                    ? 'bg-sky-600 font-semibold text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <span
                  className={`w-5 shrink-0 text-right text-[10px] font-semibold tabular-nums ${
                    isCurrent ? 'text-sky-100' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {stop.seq}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {stop.nameTc || stop.nameEn || stop.id}
                </span>
                {isCurrent && (
                  <span className="chip shrink-0 bg-white/20 px-1.5 py-0.5 text-[10px] text-white">
                    本站
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
