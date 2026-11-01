import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, Trash2 } from 'lucide-react'
import StopSection from '../components/StopSection.jsx'
import { EmptyState } from '../components/StateViews.jsx'
import useBusData from '../hooks/useBusData.js'
import useFavorites, { favoriteKey } from '../hooks/useFavorites.js'
import { distanceInMeters } from '../services/api.js'
import { formatDateTime, normalizeStopName } from '../utils/format.js'

/** 同名站點仍分開的最大距離：同名但相隔很遠（不同地點）時不應合併 */
const SAME_NAME_MAX_DISTANCE = 500
/** 不同站名要靠「座標 ≤ 100 公尺 ＋ 站名高度相似」才合併 */
const NEARBY_DISTANCE = 100
const NAME_SIMILARITY_THRESHOLD = 0.95
/** 其中一方站名包含另一方時，至少要有這麼多字才算同一站（避免短字串亂併） */
const CONTAINMENT_MIN_LENGTH = 4

const NAME_SEPARATORS = /[\s,，.。·・\-–—_/\\()（）「」【】:：;；'"]/g
/** 站名常用「地點, 道路」格式；比對時把逗號分隔的片段排序，讓順序顛倒的寫法視為同一站 */
const NAME_TOKEN_SEPARATORS = /[,，、/／]+/

/** 比較站名時忽略空白與標點，讓「中環 (交易廣場)」與「中環(交易廣場)」視為同名 */
function compactName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(NAME_SEPARATORS, '')
}

/** 編輯距離（站名很短，直接兩層迴圈；用於判斷站名相似度） */
function editDistance(a, b) {
  const columns = b.length + 1
  let previous = Array.from({ length: columns }, (_, index) => index)

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitution)
    }
    previous = current
  }

  return previous[b.length]
}

/** 依逗號等分隔站名片段並排序，用於「順序無關」的站名比對 */
function sortedNameTokens(name) {
  return String(name ?? '')
    .split(NAME_TOKEN_SEPARATORS)
    .map((token) => compactName(token))
    .filter(Boolean)
    .sort()
    .join('|')
}

/** 站名相似度 0～1（1 代表完全相同） */
function nameSimilarity(a, b) {
  const left = compactName(a)
  const right = compactName(b)
  if (!left || !right) return 0
  if (left === right) return 1
  return 1 - editDistance(left, right) / Math.max(left.length, right.length)
}

/**
 * 不同寫法的站名是否「高度相符」：
 *   1. 去掉空白標點後完全相同（例：中環(交易廣場) vs 中環 (交易廣場)）
 *   2. 一方是另一方的完整子字串（例：東九龍總區警察總部 vs 東九龍總區警察總部, 協調道）
 *   3. 以逗號分隔的片段順序顛倒（例：山翠苑, 柴灣道 vs 柴灣道, 山翠苑）
 *   4. 編輯距離相似度 ≥ 0.95（門檻太高會漏併、太低會把 F 座／G 座等不同站位誤併）
 */
function isHighlySimilarName(a, b) {
  const left = compactName(a)
  const right = compactName(b)
  if (!left || !right) return false
  if (left === right) return true
  const leftTokens = sortedNameTokens(a)
  if (leftTokens.includes('|') && leftTokens === sortedNameTokens(b)) return true
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  if (shorter.length >= CONTAINMENT_MIN_LENGTH && longer.includes(shorter)) return true
  return nameSimilarity(left, right) >= NAME_SIMILARITY_THRESHOLD
}

/** 去掉尾端站牌代號／月台後綴後的顯示用站名（中文優先） */
function cleanStopNames(stop) {
  const nameTc = normalizeStopName(stop?.nameTc)
  const nameEn = normalizeStopName(stop?.nameEn)
  if (nameTc) return { nameTc, nameEn }
  return { nameTc: nameEn, nameEn: '' }
}

function favoriteNameKey(stop) {
  const names = cleanStopNames(stop)
  return names.nameTc || names.nameEn
}

function hasCoordinates(stop) {
  return Number.isFinite(stop?.lat) && Number.isFinite(stop?.lng)
}

/** 兩站距離（公尺）；缺少座標時回傳 null */
function distanceBetween(a, b) {
  return hasCoordinates(a) && hasCoordinates(b) ? distanceInMeters(a, b) : null
}

/** 這個收藏是否可以併入既有群組 */
function canJoinGroup(group, favorite) {
  const favoriteName = favoriteNameKey(favorite)
  if (!favoriteName) return false

  // 同名（忽略大小寫與標點）：合併；但兩站都有座標且相距太遠時視為不同地點
  if (compactName(group.nameKey) === compactName(favoriteName)) {
    const distances = group.members
      .map((member) => distanceBetween(member, favorite))
      .filter((meters) => meters != null)
    // 舊收藏可能沒有座標：此時只靠同名合併
    return distances.length === 0 || Math.min(...distances) <= SAME_NAME_MAX_DISTANCE
  }

  // 不同站名：必須與群組內某個站位相距 ≤ 100 公尺，且兩者站名高度相似
  return group.members.some((member) => {
    const meters = distanceBetween(member, favorite)
    if (meters == null || meters > NEARBY_DISTANCE) return false
    return isHighlySimilarName(favoriteNameKey(member), favoriteName)
  })
}

function buildGroup(members, nameKey) {
  const source = members.find((member) => normalizeStopName(member.nameTc)) ?? members[0]
  const nameTc = normalizeStopName(source.nameTc) || nameKey
  const nameEn =
    normalizeStopName(source.nameEn) ||
    members.map((member) => normalizeStopName(member.nameEn)).find(Boolean) ||
    ''

  return {
    key: members.map(favoriteKey).sort().join('|'),
    nameKey,
    members,
    // 顯示用的站點：清掉代號／月台後綴，讓同站不同代號只出現一次
    stop: { ...source, nameTc, nameEn: nameEn === nameTc ? '' : nameEn },
  }
}

/** 把收藏依「標準化站名相同」或「座標接近且站名相似」分組 */
function groupFavorites(favorites) {
  const groups = []
  const seen = new Set()
  for (const favorite of favorites) {
    const key = favoriteKey(favorite)
    // 舊資料容許重複項目：顯示時只保留第一筆，避免同一站位出現兩次
    if (!key || seen.has(key)) continue
    seen.add(key)
    const target = groups.find((group) => canJoinGroup(group, favorite))
    if (target) {
      target.members.push(favorite)
      continue
    }
    groups.push({ nameKey: favoriteNameKey(favorite), members: [favorite] })
  }
  return groups.map((group) => buildGroup(group.members, group.nameKey))
}

/** 路線卡片的識別 key（同一路線可能有不同方向／服務類型） */
function routeEntryKey(entry) {
  return `${entry.operator}-${entry.route}-${entry.direction}-${entry.serviceType}`
}

/**
 * 合併群組內各站位的 ETA：
 * 同一條路線只保留最近一班較早的卡片，並記住它來自哪個站位（點擊站序時要高亮正確的月台）。
 * routeStops 以「路線 entry 物件本身」作 key，避免另一個檔案要用相同的字串 key 才對得上。
 */
function mergeEtaResults(results) {
  const routes = new Map()
  const routeStops = new Map()

  for (const result of results) {
    if (!result) continue
    for (const entry of result.routes ?? []) {
      const key = routeEntryKey(entry)
      const existing = routes.get(key)
      const better =
        !existing ||
        (entry.nextMinutes ?? Number.POSITIVE_INFINITY) <
          (existing.nextMinutes ?? Number.POSITIVE_INFINITY)
      if (better) {
        if (existing) routeStops.delete(existing)
        routes.set(key, entry)
        routeStops.set(entry, result.stop)
      }
    }
  }

  return { routes: [...routes.values()], routeStops }
}

/**
 * 收藏頁：本機儲存的站點清單，展開即可查看實時到站
 *
 * localStorage 格式維持不變（`hkb:favorites:v1`）；同名或座標接近的收藏只在「顯示時」合併成群組，
 * 不會改寫使用者已儲存的資料。
 */
export default function Favorites() {
  const { favorites, removeFavorite, clearFavorites } = useFavorites()
  // 可同時展開多個收藏站點群組
  const [expandedKeys, setExpandedKeys] = useState(() => new Set())

  const groups = useMemo(() => groupFavorites(favorites), [favorites])
  const uniqueCount = useMemo(
    () => groups.reduce((total, group) => total + group.members.length, 0),
    [groups],
  )

  // 展開的群組會一次抓取群組內所有站位的 ETA（收藏站點可能跨業者／多月台）
  const etaRefs = useMemo(
    () =>
      groups
        .filter((group) => expandedKeys.has(group.key))
        .flatMap((group) =>
          group.members.map((member) => ({
            ...member,
            nameTc: normalizeStopName(member.nameTc),
            nameEn: normalizeStopName(member.nameEn),
          })),
        ),
    [groups, expandedKeys],
  )

  const { groups: etaGroups, error: etaError, refresh } = useBusData(etaRefs, {
    enabled: etaRefs.length > 0,
  })

  const etaByKey = useMemo(
    () => new Map(etaGroups.map((group) => [favoriteKey(group.stop), group])),
    [etaGroups],
  )

  const displayGroups = useMemo(
    () =>
      groups.map((group) => {
        const expanded = expandedKeys.has(group.key)
        const results = expanded
          ? group.members.map((member) => etaByKey.get(favoriteKey(member)) ?? null)
          : []
        const failed = results.filter((result) => result?.error)
        const error = results.length > 0 && failed.length === results.length ? failed[0].error : null
        const warning =
          failed.length > 0 && failed.length < results.length
            ? `${failed.length} 個站位暫時讀取失敗，僅顯示可用的班次`
            : null
        const merged = mergeEtaResults(results)

        return {
          ...group,
          expanded,
          loading: expanded && results.some((result) => !result),
          etaGroup: {
            stop: group.stop,
            routes: merged.routes,
            routeStops: merged.routeStops,
            error,
            warning,
          },
        }
      }),
    [groups, expandedKeys, etaByKey],
  )

  const handleToggleGroup = useCallback((key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 取消收藏整個群組（群組內所有站位一起移除）
  const handleRemoveGroup = useCallback(
    (group) => {
      // 用 removeFavorite 而非 toggle，避免收藏已被其他分頁移除時又把它加回來
      for (const member of group.members) removeFavorite(member)
      setExpandedKeys((prev) => {
        if (!prev.has(group.key)) return prev
        const next = new Set(prev)
        next.delete(group.key)
        return next
      })
    },
    [removeFavorite],
  )

  // 只移除群組內某一個站位，其餘站位保持展開
  const handleRemoveMember = useCallback(
    (group, member) => {
      const remainingKey = group.members
        .filter((item) => favoriteKey(item) !== favoriteKey(member))
        .map(favoriteKey)
        .sort()
        .join('|')
      removeFavorite(member)
      setExpandedKeys((prev) => {
        if (!prev.has(group.key)) return prev
        const next = new Set(prev)
        next.delete(group.key)
        if (remainingKey) next.add(remainingKey)
        return next
      })
    },
    [removeFavorite],
  )

  const handleClear = () => {
    if (!favorites.length) return
    if (window.confirm('確定要清除全部收藏站點嗎？')) {
      clearFavorites()
      setExpandedKeys(new Set())
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
            已收藏 {uniqueCount} 個站點
            {groups.length > 0 && groups.length < uniqueCount
              ? `（整合為 ${groups.length} 個車站）`
              : ''}
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
          {displayGroups.map((item) => (
            <StopSection
              key={item.key}
              group={item.etaGroup}
              stops={item.members}
              expanded={item.expanded}
              onToggle={() => handleToggleGroup(item.key)}
              isFavorite
              onToggleFavorite={() => handleRemoveGroup(item)}
              onRemoveStop={(member) => handleRemoveMember(item, member)}
              loading={item.loading}
              onRetry={refresh}
            />
          ))}
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
