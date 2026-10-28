import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, Trash2 } from 'lucide-react'
import StopSection from '../components/StopSection.jsx'
import { EmptyState } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import { formatDateTime } from '../utils/format.js'

/**
 * 收藏頁：本機儲存的站點清單，展開即可查看實時到站
 */
export default function Favorites() {
  const { favorites, toggleFavorite, clearFavorites } = useFavorites()
  const [expandedKey, setExpandedKey] = useState(null)

  const expandedFavorite = useMemo(
    () => favorites.find((item) => favoriteKey(item) === expandedKey) ?? null,
    [favorites, expandedKey],
  )

  const etaRefs = useMemo(
    () =>
      expandedFavorite
        ? [
            {
              operator: expandedFavorite.operator,
              id: expandedFavorite.id,
              routes: expandedFavorite.routes ?? [],
            },
          ]
        : [],
    [expandedFavorite],
  )

  const { groups, loading: etaLoading, error: etaError, refresh } = useBusData(etaRefs, {
    enabled: Boolean(expandedFavorite),
  })

  const etaGroup = groups[0] ?? null

  const handleClear = () => {
    if (!favorites.length) return
    if (window.confirm('確定要清除全部收藏站點嗎？')) {
      clearFavorites()
      setExpandedKey(null)
    }
  }

  return (
    <div className="space-y-3">
      <section className="card flex items-center gap-2 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-500 dark:bg-amber-500/10">
          <Star className="h-4 w-4 fill-current" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            已收藏 {favorites.length} 個站點
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            收藏只儲存在此裝置，不會同步到其他裝置
          </p>
        </div>
        {favorites.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            清除
          </button>
        )}
      </section>

      {etaError && (
        <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">{etaError}</p>
      )}

      {favorites.length === 0 ? (
        <EmptyState
          title="尚未收藏站點"
          description="在附近或路線站序清單中點選星號，即可把常用站點加入收藏，下次開啟 App 立即查看。"
          action={
            <Link
              to="/"
              className="mt-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-900"
            >
              前往附近站點
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {favorites.map((favorite) => {
            const key = favoriteKey(favorite)
            const isExpanded = key === expandedKey
            const group = isExpanded
              ? (etaGroup ?? { stop: favorite, routes: [], error: null })
              : { stop: favorite, routes: [], error: null }

            return (
              <StopSection
                key={key}
                group={group}
                expanded={isExpanded}
                onToggle={() => setExpandedKey((prev) => (prev === key ? null : key))}
                isFavorite
                onToggleFavorite={() => {
                  toggleFavorite(favorite)
                  if (isExpanded) setExpandedKey(null)
                }}
                loading={isExpanded && etaLoading}
                onRetry={refresh}
              />
            )
          })}
        </div>
      )}

      {favorites.length > 0 && (
        <p className="px-1 pb-2 text-center text-[10px] text-slate-400 dark:text-slate-500">
          最近收藏：{formatDateTime(favorites[0].savedAt)}
        </p>
      )}
    </div>
  )
}
