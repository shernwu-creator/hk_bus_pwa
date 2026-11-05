import { formatClock } from '../utils/format.js'
import useLanguage from '../hooks/useLanguage.js'

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
 * @param {boolean} [props.first] 是否為三班之中的第一班（第一班用「即將到站」高光樣式）
 * @param {() => void} [props.onSelect]
 * @param {string} [props.toneClass] 多目的地時的底色／外框色調（由呼叫端依目的地分組提供）
 */
export function EtaSlot({
  eta,
  selectable = false,
  selected = false,
  first = false,
  onSelect,
  toneClass = '',
}) {
  const { t } = useLanguage()
  const minutes = eta?.minutes ?? null
  const isArriving = minutes != null && minutes <= 0
  // 款式 B：≤3 分鐘或三班之中的首班用薄荷綠高光；其餘為柔和內嵌毛玻璃塊
  const isUrgent = Boolean(eta) && minutes != null && (minutes <= 3 || first)
  const label = eta?.time
    ? t('eta.arrival', { time: formatClock(eta.time) })
    : t('eta.noService')
  const ringClass = selected
    ? 'bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-500/15 dark:ring-sky-400'
    : isUrgent
      ? 'border border-emerald-500/60 bg-emerald-500/15 font-black text-emerald-700 dark:text-emerald-300'
      : toneClass ||
        'bg-slate-50/80 shadow-sm ring-1 ring-inset ring-white/70 dark:bg-slate-800/60 dark:ring-slate-700/60'
  const className = `block w-full rounded-[14px] px-1.5 py-1.5 text-center transition ${ringClass}`

  const body = (
    <>
      <span className="flex items-baseline justify-center gap-0.5 leading-none">
        {minutes == null ? (
          <span className="text-base font-semibold text-slate-400 dark:text-slate-500">—</span>
        ) : isArriving ? (
          <span className="text-sm font-black text-emerald-700 dark:text-emerald-300">
            {t('eta.arriving')}
          </span>
        ) : (
          <>
            <span
              className={`text-lg tabular-nums ${
                isUrgent
                  ? 'font-black text-emerald-700 dark:text-emerald-300'
                  : 'font-bold text-slate-900 dark:text-white'
              }`}
            >
              {minutes}
            </span>
            <span
              className={`text-[10px] font-semibold ${
                isUrgent ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {t('eta.min')}
            </span>
          </>
        )}
      </span>
      <span className="mt-1 block truncate text-[10px] text-slate-500 dark:text-slate-400">
        {eta?.time ? formatClock(eta.time) : t('eta.noService')}
      </span>
      {selected && (
        <span className="mt-0.5 block text-[9px] font-bold leading-none text-sky-600 dark:text-sky-300">
          {t('eta.base')}
        </span>
      )}
    </>
  )

  if (!selectable) {
    return (
      <span className={className} title={eta?.remark || t('eta.realtimeTitle')}>
        {body}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={t('eta.selectAria', { label })}
      title={selected ? t('eta.selectedTitle') : t('eta.selectTitle', { label })}
      className={`${className} hover:ring-sky-400 active:scale-95`}
    >
      {body}
    </button>
  )
}

/**
 * 最近三班車的並排顯示（路線卡片與站序頁共用，取代原本各自複製的 ETA 格）。
 *
 * 同一站點同一路線有多個目的地時，呼叫端傳入 showDestination 與 tone，
 * 三格上方會顯示「往 [目的地]」標籤並以同色底色區隔方向；
 * 只有單一目的地時保持原本簡潔的 UI（不顯示額外標籤）。
 *
 * @param {object} props
 * @param {Array} [props.etas] 最多三筆 ETA（不足三筆以空格子顯示）
 * @param {string} [props.className] 外層追加樣式（例如 mt-2）
 * @param {boolean} [props.selectable] 三格是否可點擊切換推算基準
 * @param {number|null} [props.selectedIndex] 目前作為推算基準的班次索引（0-2）
 * @param {(index:number) => void} [props.onSelect] 點擊第 index 班時的回呼
 * @param {string} [props.destination] 目的地名稱（多目的地時顯示；呼叫端已依語言挑選）
 * @param {boolean} [props.showDestination] 是否顯示「往 [目的地]」標籤
 * @param {{chip:string, slot:string, dot:string}|null} [props.tone] 目的地色調
 */
export default function EtaSlots({
  etas = [],
  className = '',
  selectable = false,
  selectedIndex = null,
  onSelect,
  destination = '',
  showDestination = false,
  tone = null,
}) {
  const { t } = useLanguage()
  const slots = [etas[0] ?? null, etas[1] ?? null, etas[2] ?? null]
  const showHeading = showDestination && Boolean(destination)

  return (
    <span className={`block ${className}`}>
      {showHeading && (
        <span className="mb-1 flex">
          <span
            className={`chip ${tone?.chip ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${tone?.dot ?? 'bg-slate-400'}`}
              aria-hidden="true"
            />
            {t('eta.to', { dest: destination })}
          </span>
        </span>
      )}
      <span className="grid grid-cols-3 gap-1.5">
        {slots.map((eta, index) => (
          <EtaSlot
            key={index}
            eta={eta}
            first={index === 0}
            selectable={selectable && Boolean(eta) && Boolean(onSelect)}
            selected={selectedIndex === index}
            onSelect={onSelect ? () => onSelect(index) : undefined}
            toneClass={showHeading ? tone?.slot : undefined}
          />
        ))}
      </span>
    </span>
  )
}
