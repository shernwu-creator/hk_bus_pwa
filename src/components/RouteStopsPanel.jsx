import { ArrowLeft, Route as RouteIcon } from 'lucide-react'
import OperatorBadge from './OperatorBadge.jsx'
import StopSection from './StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from './StateViews.jsx'

/**
 * 路線站序面板：顯示選定路線（含方向）的站點，可展開查看該站的實時到站時間
 *
 * @param {object} props
 * @param {{operator:string, route:string, direction:string, orig:string, destination:string}} props.selected
 * @param {Array} props.stops
 * @param {'idle'|'loading'|'ready'|'error'} props.status
 * @param {string|null} props.error
 * @param {{stop:object, routes:Array, error:string|null}|null} props.etaGroup
 * @param {string|null} props.expandedId
 * @param {boolean} props.etaLoading
 * @param {(id:string|null) => void} props.onToggleStop
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
  etaGroup,
  expandedId,
  etaLoading,
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
            <span className="text-base font-extrabold leading-none text-slate-900 dark:text-white">
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
            const isExpanded = stop.id === expandedId
            const group = isExpanded
              ? (etaGroup ?? { stop, routes: [], error: null })
              : { stop, routes: [], error: null }

            return (
              <StopSection
                key={`${stop.operator}-${stop.id}`}
                group={group}
                seq={stop.seq}
                expanded={isExpanded}
                onToggle={() => onToggleStop(isExpanded ? null : stop.id)}
                isFavorite={isFavorite(stop)}
                onToggleFavorite={() => onToggleFavorite(stop)}
                loading={isExpanded && etaLoading}
                onRetry={onRetry}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
