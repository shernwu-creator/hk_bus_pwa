import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Star, X } from 'lucide-react'
import BusCard from './BusCard.jsx'
import OperatorBadge from './OperatorBadge.jsx'
import { EmptyState, ErrorState, RouteSkeleton } from './StateViews.jsx'
import { TravelPlanChips } from './TravelPlan.jsx'
import { favoriteKey } from '../hooks/useFavorites.js'
import useLanguage from '../hooks/useLanguage.js'
import { formatDistance, stopPlatformCode } from '../utils/format.js'
import { buildRouteSequencePath } from '../utils/routeLinks.js'
import { sortRoutes } from '../utils/routeOrder.js'

/** 路線卡片的識別 key（同一路線可能有不同方向／目的地／服務類型） */
function routeEntryKey(entry) {
  return `${entry.operator}-${entry.route}-${entry.direction}-${entry.destination ?? ''}-${entry.serviceType}`
}

/**
 * 單一站點區塊：站名＋距離＋收藏，展開後列出各路線 ETA
 * 站名只顯示目前語言（`pickLang`），不再中英上下堆疊；
 * 點路線卡片會在原視窗切換到完整站序頁（見 src/utils/routeLinks.js），不再行內展開。
 *
 * 傳入 `stops`（同一車站的多個已收藏站位）時會以「群組」形式顯示：
 * 標題只顯示乾淨站名，月台代號以低調 chip 呈現，展開後可逐一移除個別站位。
 *
 * @param {object} props
 * @param {{stop:object, routes:Array, routeStops?:Map<object, object>, error:string|null, warning?:string|null}} props.group
 * @param {number|null} [props.distance] 距離（公尺）
 * @param {number|null} [props.seq] 站序（路線站序清單使用）
 * @param {boolean} props.expanded
 * @param {() => void} props.onToggle
 * @param {boolean} [props.isFavorite]
 * @param {() => void} [props.onToggleFavorite]
 * @param {boolean} [props.loading] ETA 載入中
 * @param {() => void} [props.onRetry]
 * @param {Array|null} [props.stops] 群組內所有已收藏站位（收藏頁分組用；不傳時視為單一站點）
 * @param {(stop:object) => void} [props.onRemoveStop] 移除群組內特定站位
 * @param {{travelMinutes:number, arrivalMs:number|null, source:'geometry'|'live'}|null} [props.planChips]
 *        站序推算模式下這一站的車程／預計到達（見 src/utils/travelPlan.js）
 * @param {string|null} [props.planBaseLabel] 這一站是推算基準站時的標籤文字
 */
export default function StopSection({
  group,
  distance = null,
  seq = null,
  expanded,
  onToggle,
  isFavorite = false,
  onToggleFavorite,
  loading = false,
  onRetry,
  stops = null,
  onRemoveStop,
  planChips = null,
  planBaseLabel = null,
}) {
  const navigate = useNavigate()
  const { lang, t, pickLang } = useLanguage()
  const [showAll, setShowAll] = useState(false)
  const sortedRoutes = useMemo(() => sortRoutes(group?.routes ?? []), [group?.routes])
  // 同一站點同一路線若有多個目的地（例如循環線去程／回程、特別班次），
  // 卡片要加上「往 X」標示並以顏色區隔；只有一個目的地時維持原本簡潔的 UI。
  const destinationsByRoute = useMemo(() => {
    const byRoute = new Map()
    for (const entry of sortedRoutes) {
      const routeKey = `${entry.operator}-${entry.route}`
      const destinationKey = `${entry.direction}|${entry.destination ?? ''}`
      const list = byRoute.get(routeKey) ?? []
      if (!list.includes(destinationKey)) list.push(destinationKey)
      byRoute.set(routeKey, list)
    }
    // 依目的地字串排序決定固定色調順序，避免班次更新、到站時間改變時同一目的地換色
    for (const destinations of byRoute.values()) {
      destinations.sort((a, b) => a.localeCompare(b, lang === 'en' ? 'en' : 'zh-Hant'))
    }
    return byRoute
  }, [sortedRoutes, lang])
  const routeStops = group?.routeStops
  const stop = group?.stop ?? {}
  const stopName = pickLang(stop.nameTc, stop.nameEn) || stop.id || ''
  const visibleRoutes = showAll ? sortedRoutes : sortedRoutes.slice(0, 6)
  // 同一路線號碼同時有兩個業者（聯營）時，路線號碼框改用藍紫漸層作焦點標示
  const jointRoutes = useMemo(() => {
    const operatorsByRoute = new Map()
    for (const entry of sortedRoutes) {
      const set = operatorsByRoute.get(entry.route) ?? new Set()
      set.add(entry.operator)
      operatorsByRoute.set(entry.route, set)
    }
    return new Set(
      [...operatorsByRoute.entries()]
        .filter(([, operators]) => operators.size > 1)
        .map(([route]) => route),
    )
  }, [sortedRoutes])
  // 循環線同一站名可能出現兩次（站序不同），DOM id 帶上 seq 才不會重複
  const bodyId = `stop-body-${stop.operator}-${stop.id}-${seq ?? ''}`

  // 分組顯示：同一車站的多個站位共用一個標題，代號／業者以 chip 區分
  const grouped = Boolean(stops && stops.length > 0)
  const members = grouped ? stops : [stop]
  const multiStop = members.length > 1
  const platformCodes = []
  for (const member of members) {
    const code = stopPlatformCode(member.nameTc)
    if (code && !platformCodes.includes(code)) platformCodes.push(code)
  }
  const operators = [...new Set(members.map((member) => member.operator).filter(Boolean))]
  const favoriteLabel = isFavorite
    ? multiStop
      ? t('stop.unfavoriteGroup', { n: members.length })
      : t('stop.unfavorite')
    : t('stop.favorite')

  const handleToggle = () => {
    onToggle?.()
  }

  const handleShowAll = () => {
    setShowAll((prev) => !prev)
  }

  // 群組內同一條路線可能來自不同的月台／業者，點擊站序時用它的來源站
  // （routeStops 由收藏頁以 entry 物件本身作 key，見 Favorites.jsx 的 mergeEtaResults）。
  // 站內導覽一律原視窗切換，不再開新視窗。
  const openSequence = (entry) => {
    const path = buildRouteSequencePath(entry, routeStops?.get(entry) ?? stop)
    if (path) navigate(path)
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {Number.isFinite(seq) && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
              <span className="text-xs font-bold tabular-nums">{seq}</span>
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xl font-extrabold leading-snug text-slate-900 dark:text-slate-100">
              {stopName}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {operators.map((operator) => (
                <OperatorBadge key={operator} operator={operator} />
              ))}
              {Number.isFinite(distance) && <span>· {formatDistance(distance, lang)}</span>}
              {multiStop ? (
                <span>· {t('stop.platforms', { n: members.length })}</span>
              ) : (
                stop.routes?.length > 0 && (
                  <span>· {t('stop.routes', { n: stop.routes.length })}</span>
                )
              )}
            </span>
            {grouped && platformCodes.length > 0 && (
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {platformCodes.map((code) => (
                  <span
                    key={code}
                    className="chip bg-slate-100 px-1.5 py-0 text-[10px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  >
                    {code}
                  </span>
                ))}
              </span>
            )}
            {(planBaseLabel || planChips) && (
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {planBaseLabel ? (
                  <span className="chip bg-sky-600 px-1.5 py-0 text-[9px] text-white dark:bg-sky-500">
                    {planBaseLabel}
                  </span>
                ) : (
                  <TravelPlanChips entry={planChips} />
                )}
              </span>
            )}
          </span>
        </button>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(stop)}
            aria-label={favoriteLabel}
            aria-pressed={isFavorite}
            title={multiStop && isFavorite ? t('stop.unfavoriteGroup', { n: members.length }) : undefined}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800"
          >
            <Star
              className={`h-4 w-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}

        <button
          type="button"
          onClick={handleToggle}
          aria-label={expanded ? t('stop.collapse') : t('stop.expand')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {expanded && (
        <div id={bodyId} className="space-y-2 border-t border-white/60 px-3 py-2.5 dark:border-slate-700/60">
          {multiStop && onRemoveStop && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {t('stop.groupTitle')}
              </span>
              {members.map((member, index) => {
                const code = stopPlatformCode(member.nameTc)
                const memberLabel = code || t('stop.platform', { n: index + 1 })
                const memberName = pickLang(member.nameTc, member.nameEn) || member.id
                return (
                  <span
                    key={favoriteKey(member)}
                    title={memberName}
                    className="chip gap-1 bg-white pl-1.5 pr-0.5 text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-300"
                  >
                    <OperatorBadge operator={member.operator} />
                    <span className="tabular-nums">{memberLabel}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveStop(member)}
                      aria-label={t('stop.removeFavorite', { name: memberName })}
                      title={t('stop.removeFavoriteTitle')}
                      className="rounded-full p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {loading && sortedRoutes.length === 0 && <RouteSkeleton rows={2} />}

          {!loading && group.error && (
            <ErrorState title={t('stop.errorTitle')} message={group.error} onRetry={onRetry} />
          )}

          {!loading && group.warning && (
            <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {group.warning}
            </p>
          )}

          {!loading && !group.error && sortedRoutes.length === 0 && (
            <EmptyState title={t('stop.emptyTitle')} description={t('stop.emptyDesc')} />
          )}

          {sortedRoutes.length > 0 && (
            <>
              {visibleRoutes.map((entry) => {
                const destinationKeys =
                  destinationsByRoute.get(`${entry.operator}-${entry.route}`) ?? []
                const destinationKey = `${entry.direction}|${entry.destination ?? ''}`
                const variantIndex = destinationKeys.indexOf(destinationKey)
                return (
                  <BusCard
                    key={routeEntryKey(entry)}
                    entry={entry}
                    destinationVariant={
                      destinationKeys.length > 1 && variantIndex >= 0 ? variantIndex : null
                    }
                    featured={jointRoutes.has(entry.route)}
                    onClick={() => openSequence(entry)}
                  />
                )
              })}
              {sortedRoutes.length > 6 && (
                <button
                  type="button"
                  onClick={handleShowAll}
                  className="w-full rounded-xl border border-dashed border-slate-200 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {showAll ? t('stop.showLess') : t('stop.showAll', { n: sortedRoutes.length })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
