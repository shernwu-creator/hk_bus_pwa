import { CircleAlert, Info, RefreshCw } from 'lucide-react'

/** 路線卡片的骨架屏（載入中） */
export function RouteSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-xl border border-slate-200/70 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex gap-2.5">
            <div className="skeleton h-12 w-16 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-2/3" />
              <div className="skeleton h-3 w-1/3" />
              <div className="grid grid-cols-3 gap-1.5">
                <div className="skeleton h-9" />
                <div className="skeleton h-9" />
                <div className="skeleton h-9" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 站點列表的骨架屏（定位／站點載入中） */
export function StopSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="card flex items-center gap-3 p-3">
          <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** API 失敗狀態（含重試） */
export function ErrorState({ title = '資料讀取失敗', message, onRetry }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-5 text-center">
      <CircleAlert className="h-6 w-6 text-rose-500" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {message && <p className="text-xs text-slate-500 dark:text-slate-400">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          重新載入
        </button>
      )}
    </div>
  )
}

/** 空資料狀態 */
export function EmptyState({ title, description, action }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-6 text-center">
      <Info className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {description && (
        <p className="max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      {action}
    </div>
  )
}
