import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hkb:favorites:v1'

/** 收藏的唯一識別：業者 + 站點編號（同一位置可能同時有九巴與城巴站） */
export function favoriteKey(stop) {
  if (!stop?.id) return ''
  return `${stop.operator}:${stop.id}`
}

function isValidFavorite(item) {
  return Boolean(item && item.id && item.operator)
}

function readFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidFavorite)
  } catch {
    return []
  }
}

function writeFavorites(favorites) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  } catch {
    // 私密模式或 quota 不足時僅保留記憶體狀態
  }
}

/**
 * 收藏站點（localStorage 持久化，支援跨分頁同步）
 */
export default function useFavorites() {
  const [favorites, setFavorites] = useState(readFavorites)

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY) setFavorites(readFavorites())
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const isFavorite = useCallback(
    (stop) => {
      const key = favoriteKey(stop)
      return Boolean(key) && favorites.some((item) => favoriteKey(item) === key)
    },
    [favorites],
  )

  const toggleFavorite = useCallback((stop) => {
    if (!stop?.id) return
    setFavorites((prev) => {
      const key = favoriteKey(stop)
      const exists = prev.some((item) => favoriteKey(item) === key)
      const next = exists
        ? prev.filter((item) => favoriteKey(item) !== key)
        : [
            {
              operator: stop.operator,
              id: stop.id,
              nameTc: stop.nameTc ?? '',
              nameEn: stop.nameEn ?? '',
              lat: stop.lat ?? null,
              lng: stop.lng ?? null,
              // 城巴需要路線清單才能查 ETA，因此一併保存
              routes: stop.routes ?? [],
              savedAt: Date.now(),
            },
            ...prev,
          ]
      writeFavorites(next)
      return next
    })
  }, [])

  const removeFavorite = useCallback((stop) => {
    const key = favoriteKey(stop)
    setFavorites((prev) => {
      const next = prev.filter((item) => favoriteKey(item) !== key)
      writeFavorites(next)
      return next
    })
  }, [])

  const clearFavorites = useCallback(() => {
    writeFavorites([])
    setFavorites([])
  }, [])

  return { favorites, isFavorite, toggleFavorite, removeFavorite, clearFavorites, count: favorites.length }
}
