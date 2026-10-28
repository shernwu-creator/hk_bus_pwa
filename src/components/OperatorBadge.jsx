import { OPERATORS } from '../services/api.js'

const BADGE_STYLES = {
  KMB: 'bg-kmb text-white shadow-sm',
  CTB: 'bg-ctb text-slate-900 shadow-sm',
  GMB: 'bg-emerald-500 text-white shadow-sm', // 新增綠色小巴樣式
}

/**
 * 業者標籤（以名稱縮寫代替官方 Logo，避免使用未授權的品牌圖檔）
 */
export default function OperatorBadge({ operator, className = '' }) {
  const info = OPERATORS[operator]
  if (!info) return null
  return (
    <span
      className={`chip ${BADGE_STYLES[operator] ?? 'bg-slate-200 text-slate-700'} ${className}`}
      title={info.fullName}
    >
      {info.code}
    </span>
  )
}
