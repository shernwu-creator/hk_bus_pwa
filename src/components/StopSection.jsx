import { useMemo, useState } from 'react'
import { ChevronDown, MapPin, Star } from 'lucide-react'
import BusCard from './BusCard.jsx'
import OperatorBadge from './OperatorBadge.jsx'
import RouteDetail from './RouteDetail.jsx'
import { EmptyState, ErrorState, RouteSkeleton } from './StateViews.jsx'
import { formatDistance } from '../utils/format.js'

function sortByArrival(routes) {
  return [...routes].sort((a, b) => {
    const aMinutes = a.nextMinutes ?? Number.POSITIVE_INFINITY
    const bMinutes = b.nextMinutes ?? Number.POSITIVE_INFINITY
    if (aMinutes !== bMinutes) return aMinutes - bMinutes
    return a.route.localeCompare(b.route, 'en', { numeric: true })
  })
}

/** 路線卡片的識別 key（同一路線可能有不同方向／服務類型） */
function routeEntryKey(entry) {
  return `${entry.operator}-${entry.route}-${entry.direction}-${entry.serviceType}`
}

/**
 * 單一站點區塊：站名＋距離＋收藏，展開後列出各路線 ETA
 * 路線卡片可再往下展開，顯示該條路線的完整站序（與搜尋頁的路線面板一致）。
 *
 * @param {object} props
 * @param {{stop:object, routes:Array, error:string|null}} props.group
 * @param {number|null} [props.distance] 距離（公尺）
 * @param {number|null} [props.seq] 站序（路線站序清單使用）
 * @param {boolean} props.expanded
 * @param {() => void} props.onToggle
 * @param {boolean} [props.isFavorite]
 * @param {() => void} [props.onToggleFavorite]
 * @param {boolean} [props.loading] ETA 載入中
 * @param {() => void} [props.onRetry]
 */
export default function StopSection({
  group,
  distance = null,
  seq = null,
  expanded,
  onToggle,
  isFavorite = false,
  onToggleFavorite,
  loading = false,
  onRetry,
}) {
  const [showAll, setShowAll] = useState(false)
  const [expandedRouteKey, setExpandedRouteKey] = useState(null)
  const sortedRoutes = useMemo(() => sortByArrival(group?.routes ?? []), [group?.routes])
  const stop = group?.stop ?? {}
  const visibleRoutes = showAll ? sortedRoutes : sortedRoutes.slice(0, 6)
  const bodyId = `stop-body-${stop.operator}-${stop.id}`

  // 收起站點時一併把展開的路線收起來，避免下次開啟時莫名停在展開狀態
  const handleToggle = () => {
    if (expanded) setExpandedRouteKey(null)
    onToggle?.()
  }

  const handleShowAll = () => {
    setExpandedRouteKey(null)
    setShowAll((prev) => !prev)
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            {Number.isFinite(seq) ? (
              <span className="text-xs font-bold tabular-nums">{seq}</span>
            ) : (
              <MapPin className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {stop.nameTc || stop.nameEn || stop.id}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <OperatorBadge operator={stop.operator} />
              {Number.isFinite(distance) && <span>· {formatDistance(distance)}</span>}
              {stop.routes?.length > 0 && <span>· {stop.routes.length} 條路線</span>}
            </span>
          </span>
        </button>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(stop)}
            aria-label={isFavorite ? '取消收藏此站' : '收藏此站'}
            aria-pressed={isFavorite}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800"
          >
            <Star
              className={`h-4 w-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}

        <button
          type="button"
          onClick={handleToggle}
          aria-label={expanded ? '收起路線' : '展開路線'}
          className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {expanded && (
        <div id={bodyId} className="space-y-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800">
          {loading && sortedRoutes.length === 0 && <RouteSkeleton rows={2} />}

          {!loading && group.error && (
            <ErrorState title="此站點讀取失敗" message={group.error} onRetry={onRetry} />
          )}

          {!loading && !group.error && sortedRoutes.length === 0 && (
            <EmptyState
              title="暫無到站資料"
              description="此站點目前沒有可查詢的路線，或所有路線均已收班。"
            />
          )}

          {sortedRoutes.length > 0 && (
            <>
              {visibleRoutes.map((entry) => {
                const entryKey = routeEntryKey(entry)
                const isRouteExpanded = expandedRouteKey === entryKey

                return (
                  <BusCard
                    key={entryKey}
                    entry={entry}
                    expandable
                    expanded={isRouteExpanded}
                    onToggle={() =>
                      setExpandedRouteKey((prev) => (prev === entryKey ? null : entryKey))
                    }
                  >
                    <RouteDetail
                      entry={entry}
                      currentStopIds={[stop.id, ...(stop.siblingIds ?? [])]}
                    />
                  </BusCard>
                )
              })}
              {sortedRoutes.length > 6 && (
                <button
                  type="button"
                  onClick={handleShowAll}
                  className="w-full rounded-xl border border-dashed border-slate-200 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {showAll ? '只顯示最近 6 條路線' : `顯示全部 ${sortedRoutes.length} 條路線`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
