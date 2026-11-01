import { useMemo, useState } from 'react'
import { ChevronDown, MapPin, Star, X } from 'lucide-react'
import BusCard from './BusCard.jsx'
import OperatorBadge from './OperatorBadge.jsx'
import { EmptyState, ErrorState, RouteSkeleton } from './StateViews.jsx'
import { TravelPlanChips } from './TravelPlan.jsx'
import { favoriteKey } from '../hooks/useFavorites.js'
import { formatDistance, stopPlatformCode } from '../utils/format.js'
import { openRouteSequence } from '../utils/routeLinks.js'

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
 * 點路線卡片會用新視窗開啟完整站序（見 src/utils/routeLinks.js），不再行內展開。
 *
 * 傳入 `stops`（同一車站的多個已收藏站位）時會以「群組」形式顯示：
 * 標題只顯示乾淨站名，月台代號以低調 chip 呈現，展開後可逐一移除個別站位。
 *
 * @param {object} props
 * @param {{stop:object, routes:Array, routeStops?:Map<object, object>, error:string|null, warning?:string|null}} props.group
 * @param {number|null} [props.distance] 距離（公尺）
 * @param {number|null} [props.seq] 站序（路線站序清單使用）
 * @param {boolean} props.expanded
 * @param {() => void} props.onToggle
 * @param {boolean} [props.isFavorite]
 * @param {() => void} [props.onToggleFavorite]
 * @param {boolean} [props.loading] ETA 載入中
 * @param {() => void} [props.onRetry]
 * @param {Array|null} [props.stops] 群組內所有已收藏站位（收藏頁分組用；不傳時視為單一站點）
 * @param {(stop:object) => void} [props.onRemoveStop] 移除群組內特定站位
 * @param {{travelMinutes:number, arrivalMs:number|null, source:'geometry'|'live'}|null} [props.planChips]
 *        站序推算模式下這一站的車程／預計到達（見 src/utils/travelPlan.js）
 * @param {string|null} [props.planBaseLabel] 這一站是推算基準站時的標籤文字
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
  stops = null,
  onRemoveStop,
  planChips = null,
  planBaseLabel = null,
}) {
  const [showAll, setShowAll] = useState(false)
  const sortedRoutes = useMemo(() => sortByArrival(group?.routes ?? []), [group?.routes])
  const routeStops = group?.routeStops
  const stop = group?.stop ?? {}
  const visibleRoutes = showAll ? sortedRoutes : sortedRoutes.slice(0, 6)
  const bodyId = `stop-body-${stop.operator}-${stop.id}`

  // 分組顯示：同一車站的多個站位共用一個標題，代號／業者以 chip 區分
  const grouped = Boolean(stops && stops.length > 0)
  const members = grouped ? stops : [stop]
  const multiStop = members.length > 1
  const platformCodes = []
  for (const member of members) {
    const code = stopPlatformCode(member.nameTc)
    if (code && !platformCodes.includes(code)) platformCodes.push(code)
  }
  const operators = [...new Set(members.map((member) => member.operator).filter(Boolean))]
  const favoriteLabel = isFavorite
    ? multiStop
      ? `取消收藏整個群組（${members.length} 個站位）`
      : '取消收藏此站'
    : '收藏此站'

  const handleToggle = () => {
    onToggle?.()
  }

  const handleShowAll = () => {
    setShowAll((prev) => !prev)
  }

  // 群組內同一條路線可能來自不同的月台／業者，點擊站序時用它的來源站
  // （routeStops 由收藏頁以 entry 物件本身作 key，見 Favorites.jsx 的 mergeEtaResults）
  const openSequence = (entry) => openRouteSequence(entry, routeStops?.get(entry) ?? stop)

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
            <span className="block truncate text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">
              {stop.nameTc || stop.nameEn || stop.id}
            </span>
            {stop.nameTc && stop.nameEn && (
              <span className="block truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">
                {stop.nameEn}
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {operators.map((operator) => (
                <OperatorBadge key={operator} operator={operator} />
              ))}
              {Number.isFinite(distance) && <span>· {formatDistance(distance)}</span>}
              {multiStop ? (
                <span>· {members.length} 個站位</span>
              ) : (
                stop.routes?.length > 0 && <span>· {stop.routes.length} 條路線</span>
              )}
            </span>
            {grouped && platformCodes.length > 0 && (
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {platformCodes.map((code) => (
                  <span
                    key={code}
                    className="chip bg-slate-100 px-1.5 py-0 text-[10px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  >
                    {code}
                  </span>
                ))}
              </span>
            )}
            {(planBaseLabel || planChips) && (
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {planBaseLabel ? (
                  <span className="chip bg-sky-600 px-1.5 py-0 text-[9px] text-white dark:bg-sky-500">
                    {planBaseLabel}
                  </span>
                ) : (
                  <TravelPlanChips entry={planChips} />
                )}
              </span>
            )}
          </span>
        </button>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(stop)}
            aria-label={favoriteLabel}
            aria-pressed={isFavorite}
            title={multiStop && isFavorite ? '取消收藏整個群組' : undefined}
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
          {multiStop && onRemoveStop && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 dark:text-slate-500">此群組站位</span>
              {members.map((member, index) => {
                const code = stopPlatformCode(member.nameTc)
                const memberLabel = code || `站位 ${index + 1}`
                return (
                  <span
                    key={favoriteKey(member)}
                    title={member.nameTc || member.nameEn || member.id}
                    className="chip gap-1 bg-white pl-1.5 pr-0.5 text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-300"
                  >
                    <OperatorBadge operator={member.operator} />
                    <span className="tabular-nums">{memberLabel}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveStop(member)}
                      aria-label={`取消收藏 ${member.nameTc || member.nameEn || member.id}`}
                      title="取消收藏此站位"
                      className="rounded-full p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {loading && sortedRoutes.length === 0 && <RouteSkeleton rows={2} />}

          {!loading && group.error && (
            <ErrorState title="此站點讀取失敗" message={group.error} onRetry={onRetry} />
          )}

          {!loading && group.warning && (
            <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {group.warning}
            </p>
          )}

          {!loading && !group.error && sortedRoutes.length === 0 && (
            <EmptyState
              title="暫無到站資料"
              description="此站點目前沒有可查詢的路線，或所有路線均已收班。"
            />
          )}

          {sortedRoutes.length > 0 && (
            <>
              {visibleRoutes.map((entry) => (
                <BusCard
                  key={routeEntryKey(entry)}
                  entry={entry}
                  onClick={() => openSequence(entry)}
                />
              ))}
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
