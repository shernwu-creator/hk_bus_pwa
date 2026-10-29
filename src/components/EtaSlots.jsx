import { formatClock } from '../utils/format.js'

/**
 * 單一班次的倒數格：分鐘數字／即將到站／未有班次，下方是預計到站時間。
 *
 * @param {object} props
 * @param {{minutes:number|null, time:string|null, remark:string}|null} props.eta
 */
export function EtaSlot({ eta }) {
  const minutes = eta?.minutes ?? null
  const isArriving = minutes != null && minutes <= 0

  return (
    <span
      className="block rounded-xl bg-slate-50 px-1.5 py-1.5 text-center ring-1 ring-inset ring-slate-100 dark:bg-slate-800/60 dark:ring-slate-700/60"
      title={eta?.remark || '實時預計到站時間'}
    >
      <span className="flex items-baseline justify-center gap-0.5 leading-none">
        {minutes == null ? (
          <span className="text-base font-semibold text-slate-400 dark:text-slate-500">—</span>
        ) : isArriving ? (
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">即將到站</span>
        ) : (
          <>
            <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              {minutes}
            </span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">分</span>
          </>
        )}
      </span>
      <span className="mt-1 block truncate text-[10px] text-slate-500 dark:text-slate-400">
        {eta?.time ? formatClock(eta.time) : '未有班次'}
      </span>
    </span>
  )
}

/**
 * 最近三班車的並排顯示（路線卡片與站序頁共用，取代原本各自複製的 ETA 格）。
 *
 * @param {object} props
 * @param {Array} [props.etas] 最多三筆 ETA（不足三筆以空格子顯示）
 * @param {string} [props.className] 外層追加樣式（例如 mt-2）
 */
export default function EtaSlots({ etas = [], className = '' }) {
  const slots = [etas[0] ?? null, etas[1] ?? null, etas[2] ?? null]

  return (
    <span className={`grid grid-cols-3 gap-1.5 ${className}`}>
      {slots.map((eta, index) => (
        <EtaSlot key={index} eta={eta} />
      ))}
    </span>
  )
}
