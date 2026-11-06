import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Route as RouteIcon } from 'lucide-react'
import OperatorBadge from './OperatorBadge.jsx'
import StopSection from './StopSection.jsx'
import { EmptyState, ErrorState, StopSkeleton } from './StateViews.jsx'
import { TravelPlanBanner, TravelPlanToggle } from './TravelPlan.jsx'
import { favoriteKey } from '../hooks/useFavorites.js'
import useLanguage from '../hooks/useLanguage.js'
import { formatClock } from '../utils/format.js'
import { buildTravelPlan, pickBaseEta } from '../utils/travelPlan.js'

/**
 * 路線站序面板：顯示選定路線（含方向）的站點，可展開查看該站的實時到站時間
 *
 * 開啟「推算各站到站時間」後，會以「開啟推算時固定下來的基準站」的實時 ETA 作為
 * 時間原點，往後逐站推算累計車程與預計到達時間（算法見 src/utils/travelPlan.js）。
 *
 * 推算狀態（`planEnabled`／`planBaseStopId`）由頁面持有，本元件只負責呈現：
 * 展開／收合任何站點都不會改變基準站或推算輸入，避免 ETA 數值隨 UI 狀態跳動。
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
 * @param {boolean} [props.planEnabled] 是否開啟推算（由頁面控制，確保基準站固定）
 * @param {() => void} [props.onTogglePlan] 切換推算模式
 * @param {string|number|null} [props.planBaseStopId] 固定的推算基準站 id
 * @param {string|null} [props.topOffset] 置頂地圖高度（例如 '146px'）；有值時返回列貼在地圖下方
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
  planEnabled = false,
  onTogglePlan,
  planBaseStopId = null,
  topOffset = null,
}) {
  const { t, pickLang } = useLanguage()
  const sectionRef = useRef(null)
  const toolbarRef = useRef(null)

  // 把 sticky 返回列高度寫進 CSS 變數：StopSection 展開時的 scroll-margin-top 需要
  // 同時避開置頂地圖與這條工具列，才能精準貼合在地圖下方。
  useEffect(() => {
    const section = sectionRef.current
    const toolbar = toolbarRef.current
    if (!section || !toolbar) return undefined
    const sync = () => {
      section.style.setProperty('--stop-scroll-extra', `${toolbar.offsetHeight + 8}px`)
    }
    sync()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(sync)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  // 推算基準站：id 由頁面在「開啟推算」時固定，這裡只負責在站序中找回該站。
  // 不再讀取 expandedIds，因此展開／收合任何站點都不會改變推算的時間原點。
  const planBaseStop = useMemo(() => {
    if (!planEnabled || stops.length === 0) return null
    return stops.find((stop) => String(stop.id) === String(planBaseStopId)) ?? stops[0]
  }, [planEnabled, stops, planBaseStopId])

  // 推算只採用「基準站」的官方實時 ETA 作為時間原點；下游各站一律以相鄰路段耗時逐站推算。
  // 這樣推算輸入只有基準站（由頁面持續輪詢）＋固定站序，不受其他站點是否展開影響，
  // 也就不會因為多開一站而累加或重複計算基準時間。
  const planEtasByStopId = useMemo(() => {
    const records = new Map()
    if (!planBaseStop) return records
    const group = etaGroupsByKey.get(favoriteKey(planBaseStop))
    const directionRows = (group?.routes ?? []).filter(
      (row) => row.direction === selected.direction,
    )
    // 同一方向可能已依目的地分成多組（循環線去程／回程）：
    // 用 ETA 站序挑出屬於基準站的那一組，避免取到反方向的班次
    const stopSeq = Number(planBaseStop.seq)
    const entry =
      (Number.isFinite(stopSeq) &&
        directionRows.find((row) =>
          row.etas.some((eta) => Number(eta.stopSeq) === stopSeq),
        )) ||
      directionRows[0]
    const etas = entry?.etas ?? []
    if (etas.length > 0) {
      records.set(String(planBaseStop.id), { etas, updatedAt: etaUpdatedAt ?? 0 })
    }
    return records
  }, [planBaseStop, etaGroupsByKey, selected.direction, etaUpdatedAt])

  const travelPlan = useMemo(() => {
    if (!planBaseStop) return null
    const baseIndex = stops.findIndex((stop) => String(stop.id) === String(planBaseStop.id))
    const now = etaUpdatedAt ?? 0
    const base = pickBaseEta(planEtasByStopId.get(String(planBaseStop.id)), 0, now)
    return buildTravelPlan({
      stops,
      baseIndex,
      baseTime: base?.time ?? null,
      liveEtas: planEtasByStopId,
      now,
    })
  }, [planBaseStop, stops, planEtasByStopId, etaUpdatedAt])

  // 基準站的 ETA 還沒回來（顯示「正在取得基準班次」而不是「暫無班次」）。
  // 基準站由頁面持續輪詢，即使被收合也會更新，所以不需再檢查 expandedIds。
  const planBaseLoading = planBaseStop != null && !etaGroupsByKey.has(favoriteKey(planBaseStop))

  const baseLabel =
    travelPlan?.baseTime != null
      ? t('route.planBaseArrival', { time: formatClock(travelPlan.baseTime) })
      : planBaseLoading
        ? t('route.planBaseLoading')
        : t('route.planBaseNone')

  return (
    <section ref={sectionRef} className="space-y-2">
      {/* 返回列（路線資訊）與推算切換鈕固定在 Header 下方：站序很長時不管滑到哪裡，
          都能隨時返回路線清單或開關「推算各站到站時間」，與首頁 sticky Header 同一套邏輯。
          有置頂地圖時（topOffset）改貼在地圖下緣；否則以負 margin 抵銷 main 的 padding，
          讓背景色貼齊左右邊緣、內容從下面滑過。 */}
      <div
        ref={toolbarRef}
        className={`sticky z-10 -mx-3 space-y-2 border-b border-slate-200/70 bg-slate-50/90 px-3 pb-2 pt-3 backdrop-blur-lg dark:border-slate-800/80 dark:bg-slate-950/85 ${
          topOffset ? '' : '-mt-3'
        }`}
        style={{ top: topOffset ? `calc(var(--app-header-h) + ${topOffset})` : 'var(--app-header-h)' }}
      >
        <div className="card flex items-start gap-2 p-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('panel.backAria')}
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
                {selected.direction === 'inbound'
                  ? t('direction.inbound')
                  : t('direction.outbound')}
              </span>
            </p>
            <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
              <RouteIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {pickLang(selected.orig, selected.origEn)} →{' '}
                {pickLang(selected.destination, selected.destinationEn)}
              </span>
              {status === 'ready' && (
                <span className="shrink-0">· {t('common.stops', { n: stops.length })}</span>
              )}
            </p>
          </div>
        </div>

        {status === 'ready' && stops.length > 0 && (
          <div className="flex justify-end px-1">
            <TravelPlanToggle
              active={planEnabled}
              onClick={onTogglePlan}
            />
          </div>
        )}
      </div>

      {status === 'loading' && <StopSkeleton rows={4} />}

      {status === 'error' && <ErrorState message={error} onRetry={onRetry} />}

      {status === 'ready' && stops.length === 0 && (
        <EmptyState title={t('panel.emptyTitle')} description={t('panel.emptyDesc')} />
      )}

      {status === 'ready' && stops.length > 0 && (
        <>
          {planEnabled && travelPlan && (
            <TravelPlanBanner
              plan={travelPlan}
              baseLoading={planBaseLoading}
              hint={t('plan.fixedBaseHint')}
            />
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
                  key={`${stop.operator}-${stop.id}-${stop.seq ?? ''}`}
                  group={group}
                  seq={stop.seq}
                  isExpanded={isExpanded}
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
