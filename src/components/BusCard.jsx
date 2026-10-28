import { ArrowUpRight, BusFront, ChevronDown } from 'lucide-react'
import OperatorBadge from './OperatorBadge.jsx'
import { formatClock, serviceTypeLabel } from '../utils/format.js'

function EtaSlot({ eta }) {
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
 * 巴士路線／ETA 顯示卡片
 * 內容：業者標籤、路線號碼、方向、上車收費，以及並排的最近三班車倒數
 *
 * 傳入 expandable 時整張卡片可點擊，由父層決定是否展開全路線站序（children）。
 *
 * @param {object} props
 * @param {object} props.entry ETA 路線資料
 * @param {boolean} [props.expandable] 是否可點擊展開全路線站序
 * @param {boolean} [props.expanded] 是否已展開
 * @param {() => void} [props.onToggle] 點擊卡片時的切換行為
 * @param {React.ReactNode} [props.children] 展開後顯示的內容（站序）
 */
export default function BusCard({ entry, expandable = false, expanded = false, onToggle, children }) {
  if (!entry) return null
  const { route, operator, direction, destination, fare, serviceType, etas = [] } = entry
  const lastBus = etas.some((eta) => eta.remark?.includes('最後'))
  const special = serviceTypeLabel(serviceType)
  const slots = [etas[0] ?? null, etas[1] ?? null, etas[2] ?? null]
  const detailId = `route-detail-${operator}-${route}-${direction}-${serviceType}`.replace(
    /[^A-Za-z0-9_-]+/g,
    '-',
  )

  const body = (
    <>
      <span className="flex items-start gap-2.5">
        <span className="flex w-16 shrink-0 flex-col items-center rounded-xl bg-slate-100/80 px-1 py-1.5 dark:bg-slate-800/80">
          <span className="text-lg font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
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

          <span className="mt-2 grid grid-cols-3 gap-1.5">
            {slots.map((eta, index) => (
              <EtaSlot key={`${route}-${index}`} eta={eta} />
            ))}
          </span>
        </span>
      </span>

      {expandable && (
        <span className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
          {expanded ? '收起全路線站序' : '查看全路線站序'}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      )}
    </>
  )

  return (
    <article
      className={`animate-fade-in rounded-xl border bg-white p-2.5 shadow-sm transition dark:bg-slate-900 ${
        expanded
          ? 'border-sky-300 dark:border-sky-700'
          : 'border-slate-200/80 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
      }`}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailId}
          className="block w-full text-left"
        >
          {body}
        </button>
      ) : (
        body
      )}

      {expandable && expanded && (
        <div
          id={detailId}
          className="animate-fade-in mt-2 border-t border-slate-100 pt-2 dark:border-slate-800"
        >
          {children}
        </div>
      )}
    </article>
  )
}
