import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hkb:theme'

function readTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // localStorage 不可用時改用系統偏好
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/**
 * 深色模式：以 html.dark class 切換（Tailwind darkMode: 'class'）
 * index.html 的 inline script 已在首次繪製前套用，這裡負責後續同步與持久化。
 */
export default function useTheme() {
  const [theme, setTheme] = useState(readTheme)

  useEffect(() => {
    const isDark = theme === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#020617' : '#f8fafc')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // 忽略無法寫入的情況
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, isDark: theme === 'dark', toggleTheme }
}
