import { OPERATORS } from '../services/api.js'

const BADGE_STYLES = {
  // 款式 B：柔和色系圓角膠囊（不用品牌實色，降低視覺壓迫）
  KMB: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  CTB: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  GMB: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
}

/**
 * 業者標籤（以名稱縮寫代替官方 Logo，避免使用未授權的品牌圖檔）
 */
export default function OperatorBadge({ operator, className = '' }) {
  const info = OPERATORS[operator]
  if (!info) return null
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold leading-4 ${
        BADGE_STYLES[operator] ?? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
      } ${className}`}
      title={info.fullName}
    >
      {info.code}
    </span>
  )
}
