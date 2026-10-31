import { ArrowLeft, Route as RouteIcon } from 'lucide-react'
import OperatorBadge from './OperatorBadge.jsx'
import StopSection from './StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from './StateViews.jsx'
import { favoriteKey } from '../hooks/useFavorites.js'

/**
 * 路線站序面板：顯示選定路線（含方向）的站點，可展開查看該站的實時到站時間
 *
 * @param {object} props
 * @param {{operator:string, route:string, direction:string, orig:string, destination:string}} props.selected
 * @param {Array} props.stops
 * @param {'idle'|'loading'|'ready'|'error'} props.status
 * @param {string|null} props.error
 * @param {Map<string, {stop:object, routes:Array, error:string|null}>} props.etaGroupsByKey 以 favoriteKey(stop) 對應各站 ETA
 * @param {Set<string>} props.expandedIds 目前展開的站點 id（可同時多個）
 * @param {(id:string) => void} props.onToggleStop
 * @param {() => void} props.onBack
 * @param {(stop:object) => boolean} props.isFavorite
 * @param {(stop:object) => void} props.onToggleFavorite
 * @param {() => void} props.onRetry
 */
export default function RouteStopsPanel({
  selected,
  stops,
  status,
  error,
  etaGroupsByKey,
  expandedIds,
  onToggleStop,
  onBack,
  isFavorite,
  onToggleFavorite,
  onRetry,
}) {
  return (
    <section className="space-y-2">
      <div className="card flex items-start gap-2 p-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回路線搜尋"
          className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="text-lg font-extrabold leading-none text-slate-900 dark:text-white">
              {selected.route}
            </span>
            <OperatorBadge operator={selected.operator} />
            <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {selected.direction === 'inbound' ? '回程' : '去程'}
            </span>
          </p>
          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
            <RouteIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {selected.orig} → {selected.destination}
            </span>
            {status === 'ready' && <span className="shrink-0">· {stops.length} 站</span>}
          </p>
        </div>
      </div>

      {status === 'loading' && <StopSkeleton rows={4} />}

      {status === 'error' && <ErrorState message={error} onRetry={onRetry} />}

      {status === 'ready' && stops.length === 0 && (
        <EmptyState title="此方向暫無站點資料" description="請返回上一頁選擇其他方向。" />
      )}

      {status === 'ready' && stops.length > 0 && (
        <div className="space-y-2">
          {stops.map((stop) => {
            const key = favoriteKey(stop)
            const isExpanded = expandedIds.has(stop.id)
            const group = etaGroupsByKey.get(key) ?? { stop, routes: [], error: null }
            // 已展開但 ETA 未回來先顯示骨架
            const isLoading = isExpanded && !etaGroupsByKey.has(key)

            return (
              <StopSection
                key={`${stop.operator}-${stop.id}`}
                group={group}
                seq={stop.seq}
                expanded={isExpanded}
                onToggle={() => onToggleStop(stop.id)}
                isFavorite={isFavorite(stop)}
                onToggleFavorite={() => onToggleFavorite(stop)}
                loading={isLoading}
                onRetry={onRetry}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
