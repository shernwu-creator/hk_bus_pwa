import { ArrowUpRight, BusFront } from 'lucide-react'
import OperatorBadge from './OperatorBadge.jsx'
import { formatClock, serviceTypeLabel } from '../utils/format.js'

function EtaSlot({ eta }) {
  const minutes = eta?.minutes ?? null
  const isArriving = minutes != null && minutes <= 0

  return (
    <div
      className="rounded-xl bg-slate-50 px-1.5 py-1.5 text-center ring-1 ring-inset ring-slate-100 dark:bg-slate-800/60 dark:ring-slate-700/60"
      title={eta?.remark || '實時預計到站時間'}
    >
      <p className="flex items-baseline justify-center gap-0.5 leading-none">
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
      </p>
      <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
        {eta?.time ? formatClock(eta.time) : '未有班次'}
      </p>
    </div>
  )
}

/**
 * 巴士路線／ETA 顯示卡片
 * 內容：業者標籤、路線號碼、方向、上車收費，以及並排的最近三班車倒數
 */
export default function BusCard({ entry }) {
  if (!entry) return null
  const { route, operator, destination, fare, serviceType, etas = [] } = entry
  const lastBus = etas.some((eta) => eta.remark?.includes('最後'))
  const special = serviceTypeLabel(serviceType)
  const slots = [etas[0] ?? null, etas[1] ?? null, etas[2] ?? null]

  return (
    <article className="animate-fade-in rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      <div className="flex items-start gap-2.5">
        <div className="flex w-16 shrink-0 flex-col items-center rounded-xl bg-slate-100/80 px-1 py-1.5 dark:bg-slate-800/80">
          <span className="text-lg font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
            {route}
          </span>
          <OperatorBadge operator={operator} className="mt-1" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <BusFront
              className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
              aria-hidden="true"
            />
            <p className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <span className="truncate">{destination || '目的地未提供'}</span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
            </p>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
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
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {slots.map((eta, index) => (
              <EtaSlot key={`${route}-${index}`} eta={eta} />
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}
