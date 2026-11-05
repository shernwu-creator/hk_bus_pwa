import { ArrowUpRight, BusFront, ChevronRight } from 'lucide-react'
import EtaSlots from './EtaSlots.jsx'
import OperatorBadge from './OperatorBadge.jsx'
import { serviceTypeLabel } from '../utils/format.js'

/**
 * 多目的地的色調：同一站點同一路線出現不同目的地時（例如循環線去程／回程），
 * 用不同顏色加上「往 [目的地]」標籤，讓使用者一眼分辨要搭哪一邊。
 * 顏色順序固定，同時提供深色模式樣式。
 */
const DESTINATION_TONES = [
  {
    badge: 'bg-sky-100/80 ring-1 ring-sky-200 dark:bg-sky-500/15 dark:ring-sky-500/30',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    slot: 'bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/25',
    dot: 'bg-sky-500',
  },
  {
    badge: 'bg-amber-100/80 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:ring-amber-500/30',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    slot: 'bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/25',
    dot: 'bg-amber-500',
  },
  {
    badge: 'bg-violet-100/80 ring-1 ring-violet-200 dark:bg-violet-500/15 dark:ring-violet-500/30',
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    slot: 'bg-violet-50 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:ring-violet-500/25',
    dot: 'bg-violet-500',
  },
  {
    badge: 'bg-emerald-100/80 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:ring-emerald-500/30',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    slot: 'bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/25',
    dot: 'bg-emerald-500',
  },
]

/**
 * 巴士路線／ETA 顯示卡片
 * 內容：業者標籤、路線號碼、方向、上車收費，以及並排的最近三班車倒數
 *
 * 傳入 onClick 時整張卡片可點擊，由父層決定行為（目前是在原視窗切換到全線站序頁）。
 *
 * @param {object} props
 * @param {object} props.entry ETA 路線資料
 * @param {() => void} [props.onClick] 點擊卡片時的動作
 * @param {number|null} [props.destinationVariant]
 *        同一站點同一路線有多個目的地時，這個目的地分組的索引（0 起）；
 *        傳 null／不傳代表只有單一目的地，維持原本簡潔的 UI。
 */
export default function BusCard({ entry, onClick, destinationVariant = null }) {
  if (!entry) return null
  const { route, operator, destination, fare, serviceType, etas = [] } = entry
  const lastBus = etas.some((eta) => eta.remark?.includes('最後'))
  const special = serviceTypeLabel(serviceType)
  const variant = Number.isInteger(destinationVariant) ? destinationVariant : null
  const tone = variant == null ? null : DESTINATION_TONES[variant % DESTINATION_TONES.length]
  const showDestination = variant != null

  const body = (
    <>
      <span className="flex items-start gap-2.5">
        <span
          className={`flex w-16 shrink-0 flex-col items-center rounded-xl px-1 py-1.5 ${
            tone ? tone.badge : 'bg-slate-100/80 dark:bg-slate-800/80'
          }`}
        >
          <span className="whitespace-nowrap text-xl font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
            {route}
          </span>
          <OperatorBadge operator={operator} className="mt-1" />
        </span>

        <span className="block min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <BusFront
              className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
              aria-hidden="true"
            />
            <span className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <span className="truncate">{destination || '目的地未提供'}</span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
            </span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              上車收費{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {Number.isFinite(fare) ? `HK$${fare.toFixed(1)}` : '票價待查'}
              </span>
            </span>
            {special && (
              <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {special}
              </span>
            )}
            {lastBus && (
              <span className="chip bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
                最後班次
              </span>
            )}
          </span>

          <EtaSlots
            etas={etas}
            className="mt-2"
            destination={destination}
            showDestination={showDestination}
            tone={tone}
          />
        </span>
      </span>

      {onClick && (
        <span className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          查看全線站序
        </span>
      )}
    </>
  )

  return (
    <article
      className={`animate-fade-in rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 ${
        onClick ? 'hover:border-slate-300 dark:hover:border-slate-700' : ''
      }`}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={`${route} 往 ${destination || '目的地'}：查看全線站序`}
          className="block w-full text-left"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </article>
  )
}
