import { formatClock } from '../utils/format.js'

/**
 * 單一班次的倒數格：分鐘數字／即將到站／未有班次，下方是預計到站時間。
 *
 * `selectable` 為 true 時整格是可點擊的按鈕（站序頁的「推算各站到站時間」模式：
 * 點一下就把這一班車設為推算基準），呼叫端需提供 `onSelect`。
 *
 * @param {object} props
 * @param {{minutes:number|null, time:string|null, remark:string}|null} props.eta
 * @param {boolean} [props.selectable] 是否可點擊（作為推算基準）
 * @param {boolean} [props.selected] 是否為目前的推算基準班次
 * @param {() => void} [props.onSelect]
 */
export function EtaSlot({ eta, selectable = false, selected = false, onSelect }) {
  const minutes = eta?.minutes ?? null
  const isArriving = minutes != null && minutes <= 0
  const label = eta?.time ? `${formatClock(eta.time)} 到站` : '未有班次'
  const ringClass = selected
    ? 'bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-500/15 dark:ring-sky-400'
    : 'bg-slate-50 ring-1 ring-slate-100 dark:bg-slate-800/60 dark:ring-slate-700/60'
  const className = `block w-full rounded-xl px-1.5 py-1.5 text-center ring-inset transition ${ringClass}`

  const body = (
    <>
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
      {selected && (
        <span className="mt-0.5 block text-[9px] font-bold leading-none text-sky-600 dark:text-sky-300">
          推算基準
        </span>
      )}
    </>
  )

  if (!selectable) {
    return (
      <span className={className} title={eta?.remark || '實時預計到站時間'}>
        {body}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${label}，點擊以此班次推算後續各站到達時間`}
      title={selected ? '目前推算基準' : `以此班次（${label}）推算後續各站`}
      className={`${className} hover:ring-sky-400 active:scale-95`}
    >
      {body}
    </button>
  )
}

/**
 * 最近三班車的並排顯示（路線卡片與站序頁共用，取代原本各自複製的 ETA 格）。
 *
 * @param {object} props
 * @param {Array} [props.etas] 最多三筆 ETA（不足三筆以空格子顯示）
 * @param {string} [props.className] 外層追加樣式（例如 mt-2）
 * @param {boolean} [props.selectable] 三格是否可點擊切換推算基準
 * @param {number|null} [props.selectedIndex] 目前作為推算基準的班次索引（0-2）
 * @param {(index:number) => void} [props.onSelect] 點擊第 index 班時的回呼
 */
export default function EtaSlots({
  etas = [],
  className = '',
  selectable = false,
  selectedIndex = null,
  onSelect,
}) {
  const slots = [etas[0] ?? null, etas[1] ?? null, etas[2] ?? null]

  return (
    <span className={`grid grid-cols-3 gap-1.5 ${className}`}>
      {slots.map((eta, index) => (
        <EtaSlot
          key={index}
          eta={eta}
          selectable={selectable && Boolean(eta) && Boolean(onSelect)}
          selected={selectedIndex === index}
          onSelect={onSelect ? () => onSelect(index) : undefined}
        />
      ))}
    </span>
  )
}
