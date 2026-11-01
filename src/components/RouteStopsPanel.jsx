import { useMemo, useState } from 'react'
import { ArrowLeft, Route as RouteIcon } from 'lucide-react'
import OperatorBadge from './OperatorBadge.jsx'
import StopSection from './StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from './StateViews.jsx'
import { TravelPlanBanner, TravelPlanToggle } from './TravelPlan.jsx'
import { favoriteKey } from '../hooks/useFavorites.js'
import { formatClock } from '../utils/format.js'
import { buildTravelPlan, pickBaseEta } from '../utils/travelPlan.js'

/**
 * 路線站序面板：顯示選定路線（含方向）的站點，可展開查看該站的實時到站時間
 *
 * 開啟「推算各站到站時間」後，會以「目前展開中、且已取得實時 ETA」的最前面站點
 * 作為基準站，往後推算每一站的累計車程與預計到達時間（算法見 src/utils/travelPlan.js）。
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
 * @param {number|null} [props.etaUpdatedAt] ETA 批次更新的時間戳（推算時用來判斷資料是否新鮮）
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
  etaUpdatedAt = null,
}) {
  const [planEnabled, setPlanEnabled] = useState(false)

  // 各站已取得的實時 ETA：只涵蓋「已展開」的站點（搜尋頁以批次查詢，不額外發請求）
  const liveEtasByStopId = useMemo(() => {
    const records = new Map()
    for (const stop of stops) {
      const group = etaGroupsByKey.get(favoriteKey(stop))
      const entry = group?.routes?.find((row) => row.direction === selected.direction)
      const etas = entry?.etas ?? []
      if (etas.length === 0) continue
      records.set(String(stop.id), { etas, updatedAt: etaUpdatedAt ?? 0 })
    }
    return records
  }, [stops, etaGroupsByKey, selected.direction, etaUpdatedAt])

  // 推算基準：已展開且取得實時 ETA 的最前面站點；都沒有時退回第一站（純車程推算）
  const planBaseStop = useMemo(() => {
    if (!planEnabled || stops.length === 0) return null
    return (
      stops.find((stop) => expandedIds.has(stop.id) && liveEtasByStopId.has(String(stop.id))) ??
      stops[0]
    )
  }, [planEnabled, stops, expandedIds, liveEtasByStopId])

  const travelPlan = useMemo(() => {
    if (!planBaseStop) return null
    const baseIndex = stops.findIndex((stop) => String(stop.id) === String(planBaseStop.id))
    const now = etaUpdatedAt ?? 0
    const base = pickBaseEta(liveEtasByStopId.get(String(planBaseStop.id)), 0, now)
    return buildTravelPlan({
      stops,
      baseIndex,
      baseTime: base?.time ?? null,
      liveEtas: liveEtasByStopId,
      now,
    })
  }, [planBaseStop, stops, liveEtasByStopId, etaUpdatedAt])

  // 基準站已展開、但 ETA 還沒回來（顯示「正在取得基準班次」而不是「暫無班次」）
  const planBaseLoading =
    planBaseStop != null &&
    expandedIds.has(planBaseStop.id) &&
    !etaGroupsByKey.has(favoriteKey(planBaseStop))

  const baseLabel =
    travelPlan?.baseTime != null
      ? `推算基準 · ${formatClock(travelPlan.baseTime)} 到站`
      : planBaseLoading
        ? '推算基準（正在取得班次…）'
        : '推算基準（暫無實時班次）'

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
          {selected.origEn && selected.destinationEn && (
            <p className="mt-0.5 truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">
              {selected.origEn} → {selected.destinationEn}
            </p>
          )}
        </div>
      </div>

      {status === 'loading' && <StopSkeleton rows={4} />}

      {status === 'error' && <ErrorState message={error} onRetry={onRetry} />}

      {status === 'ready' && stops.length === 0 && (
        <EmptyState title="此方向暫無站點資料" description="請返回上一頁選擇其他方向。" />
      )}

      {status === 'ready' && stops.length > 0 && (
        <>
          <div className="flex justify-end px-1">
            <TravelPlanToggle
              active={planEnabled}
              onClick={() => setPlanEnabled((current) => !current)}
            />
          </div>

          {planEnabled && travelPlan && (
            <TravelPlanBanner plan={travelPlan} baseLoading={planBaseLoading} />
          )}

          <div className="space-y-2">
            {stops.map((stop) => {
              const key = favoriteKey(stop)
              const isExpanded = expandedIds.has(stop.id)
              const group = etaGroupsByKey.get(key) ?? { stop, routes: [], error: null }
              // 已展開但 ETA 未回來先顯示骨架
              const isLoading = isExpanded && !etaGroupsByKey.has(key)
              const planEntry = travelPlan?.byStopId.get(String(stop.id)) ?? null
              const isPlanBase =
                planEnabled &&
                travelPlan != null &&
                String(travelPlan.baseStop?.id) === String(stop.id)

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
                  planChips={planEntry}
                  planBaseLabel={isPlanBase ? baseLabel : null}
                />
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
