import { Clock, Timer, TriangleAlert } from 'lucide-react'
import { formatClock } from '../utils/format.js'
import useLanguage from '../hooks/useLanguage.js'
import {
  AVG_BUS_SPEED_KMH,
  DWELL_SECONDS_PER_STOP,
  ROAD_DETOUR_FACTOR,
} from '../utils/travelPlan.js'

/**
 * 「推算各站到站時間」模式的共用 UI
 *
 * 三個小元件都只做呈現，推算本身在 `src/utils/travelPlan.js`：
 *   - TravelPlanToggle：開啟／關閉推算模式的膠囊按鈕（時鐘圖示）
 *   - TravelPlanBanner：標示推算基準站、基準班次時間與推算假設
 *   - TravelPlanChips：後續各站右側／下方的「+X 分」「HH:mm 到達」膠囊
 *
 * 注意：`TravelPlanChips` 只用 `<span>`，因為站點列本身常是 `<button>`，
 * 裡面不能再放按鈕（HTML 不允許嵌套 button，會讓點擊行為與無障礙樹錯亂）。
 */

/**
 * @param {object} props
 * @param {boolean} props.active 目前是否已開啟推算模式
 * @param {() => void} props.onClick 切換模式
 * @param {string} [props.className]
 */
export function TravelPlanToggle({ active, onClick, className = '' }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? t('plan.toggleTitleOff') : t('plan.toggleTitleOn')}
      className={`chip shrink-0 border transition active:scale-95 ${
        active
          ? 'border-sky-600 bg-sky-600 text-white shadow-sm hover:bg-sky-700 dark:border-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400'
          : 'border-sky-200 bg-white/90 text-sky-700 hover:border-sky-300 hover:bg-sky-50 dark:border-sky-500/40 dark:bg-slate-900/90 dark:text-sky-300 dark:hover:bg-sky-500/10'
      } ${className}`}
    >
      <Timer className="h-3.5 w-3.5" aria-hidden="true" />
      {active ? t('plan.toggleOff') : t('plan.toggleOn')}
    </button>
  )
}

/**
 * 推算基準說明列：哪一站、哪一班車、用什麼假設推算。
 *
 * @param {object} props
 * @param {object} props.plan `buildTravelPlan()` 的回傳值
 * @param {string} [props.etaLabel] 基準班次描述，例如「第 2 班」
 * @param {boolean} [props.baseLoading] 基準站的 ETA 還在載入（顯示「正在取得」而不是「暫無班次」）
 * @param {string} [props.className]
 */
export function TravelPlanBanner({ plan, etaLabel, baseLoading = false, className = '' }) {
  const { t, pickLang } = useLanguage()
  if (!plan?.baseStop) return null
  const hasRealtime = plan.baseTime != null
  const baseName = pickLang(plan.baseStop.nameTc, plan.baseStop.nameEn) || plan.baseStop.id
  const busLabel = etaLabel ?? t('plan.etaLabel', { n: 1 })
  const noDownstream = plan.entries.length === 0
  const tone =
    hasRealtime || baseLoading
      ? 'bg-sky-50 text-sky-800 ring-sky-100 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20'
      : 'bg-amber-50 text-amber-800 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20'

  return (
    <div
      className={`animate-fade-in rounded-xl px-2.5 py-2 ring-1 ring-inset ${tone} ${className}`}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold leading-4">
        {hasRealtime ? (
          <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">
          {t('plan.base', { name: baseName })}
          {noDownstream ? t('plan.terminusSuffix') : ''}
        </span>
        {hasRealtime ? (
          <span className="chip bg-white/80 px-1.5 py-0 tabular-nums text-sky-700 dark:bg-slate-900/80 dark:text-sky-300">
            {busLabel} · {formatClock(plan.baseTime)}
          </span>
        ) : (
          <span className="chip bg-white/80 px-1.5 py-0 text-amber-700 dark:bg-slate-900/80 dark:text-amber-300">
            {baseLoading ? t('plan.loadingBase') : t('plan.noRealtime')}
          </span>
        )}
      </p>

      <p className="mt-1 text-[10px] leading-relaxed opacity-80">
        {noDownstream
          ? t('plan.noDownstream')
          : hasRealtime
            ? (
                <>
                  {t('plan.assumption', {
                    dwell: DWELL_SECONDS_PER_STOP,
                    speed: AVG_BUS_SPEED_KMH,
                    detour: ROAD_DETOUR_FACTOR,
                  })}
                  {plan.terminusMinutes != null &&
                    t('plan.terminusMinutes', { n: plan.terminusMinutes })}
                  {t('plan.clickHint')}
                </>
              )
            : baseLoading
              ? t('plan.loadingBaseDesc')
              : t('plan.pureEstimate')}
        {plan.approximate && t('plan.approximateSuffix')}
      </p>
    </div>
  )
}

/**
 * 單一站點的車程／預計到達膠囊。
 *
 * @param {object} props
 * @param {{travelMinutes:number, arrivalMs:number|null, source:'geometry'|'live'}} props.entry
 * @param {string} [props.className]
 */
export function TravelPlanChips({ entry, className = '' }) {
  const { t } = useLanguage()
  if (!entry) return null
  const travelTitle = t('plan.chipTravelTitle', { n: entry.travelMinutes })

  if (entry.arrivalMs == null) {
    return (
      <span className={`flex flex-wrap items-center gap-1 ${className}`}>
        <span
          title={travelTitle}
          className="chip bg-sky-50 px-1.5 py-0 tabular-nums text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
        >
          {t('plan.chipTravel', { n: entry.travelMinutes })}
        </span>
      </span>
    )
  }

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      <span
        title={travelTitle}
        className="chip bg-sky-50 px-1.5 py-0 tabular-nums text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
      >
        {t('plan.chipTravelShort', { n: entry.travelMinutes })}
      </span>
      <span
        title={
          entry.source === 'live' ? t('plan.chipLiveTitle') : t('plan.chipEstimateTitle')
        }
        className="chip bg-emerald-50 px-1.5 py-0 tabular-nums text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      >
        <Clock className="h-3 w-3" aria-hidden="true" />
        {t('plan.chipArrive', { time: formatClock(entry.arrivalMs) })}
      </span>
    </span>
  )
}
