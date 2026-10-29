import { ArrowUpRight, BusFront, ExternalLink } from 'lucide-react'
import EtaSlots from './EtaSlots.jsx'
import OperatorBadge from './OperatorBadge.jsx'
import { serviceTypeLabel } from '../utils/format.js'

/**
 * 巴士路線／ETA 顯示卡片
 * 內容：業者標籤、路線號碼、方向、上車收費，以及並排的最近三班車倒數
 *
 * 傳入 onClick 時整張卡片可點擊，由父層決定行為（目前是在新視窗開啟全線站序）。
 *
 * @param {object} props
 * @param {object} props.entry ETA 路線資料
 * @param {() => void} [props.onClick] 點擊卡片時的動作
 */
export default function BusCard({ entry, onClick }) {
  if (!entry) return null
  const { route, operator, destination, fare, serviceType, etas = [] } = entry
  const lastBus = etas.some((eta) => eta.remark?.includes('最後'))
  const special = serviceTypeLabel(serviceType)

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

          <EtaSlots etas={etas} className="mt-2" />
        </span>
      </span>

      {onClick && (
        <span className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          在新視窗查看全線站序
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
          aria-label={`${route} 往 ${destination || '目的地'}：在新視窗查看全線站序`}
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
