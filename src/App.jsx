import { lazy, Suspense, useEffect, useRef } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import { BusFront, Moon, Sun } from 'lucide-react'
import BottomNav from './components/BottomNav.jsx'
import useTheme from './hooks/useTheme.js'
import { LanguageProvider, useLanguage } from './hooks/useLanguage.js'

/**
 * 頁面層級 code splitting：主殼（Header／BottomNav）先載入，
 * 各頁面與「路線站序頁」各自成為獨立 chunk，縮短首次可互動時間。
 */
const Nearby = lazy(() => import('./pages/Nearby.jsx'))
const Search = lazy(() => import('./pages/Search.jsx'))
const Favorites = lazy(() => import('./pages/Favorites.jsx'))
const RouteSequence = lazy(() => import('./pages/RouteSequence.jsx'))

/**
 * 部署在子路徑（GitHub Pages：/hk_bus_pwa/）時，Router 必須與 Vite 的 base 一致，
 * 否則所有 <Link> 與巢狀路由都會指向網站根目錄。
 */
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

/** 頁面載入中的骨架屏（lazy chunk 下載期間） */
function PageFallback() {
  const { t } = useLanguage()
  return (
    <div className="space-y-2 pt-1" aria-busy="true" aria-label={t('app.loadingPage')}>
      <div className="skeleton h-16 w-full rounded-2xl" />
      <div className="skeleton h-14 w-full rounded-2xl" />
      <div className="skeleton h-14 w-full rounded-2xl" />
    </div>
  )
}

/** 路線站序頁的載入畫面（全螢幕、無底部導覽） */
function RouteWindowFallback() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3 px-3 py-4" aria-busy="true">
      <div className="skeleton h-20 w-full rounded-2xl" />
      <div className="skeleton h-12 w-full rounded-2xl" />
      <div className="skeleton h-12 w-full rounded-2xl" />
    </div>
  )
}

/**
 * 站內切換頁面（PUSH／REPLACE）時把視窗捲回頂部，避免新頁沿用上一頁的捲動位置。
 * 瀏覽器上一頁／下一頁（POP）交給瀏覽器還原原本的捲動位置，站序頁按「返回」才不會
 * 讓使用者回到附近頁頂端、要重新滑到原本的站點。
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (navigationType === 'POP') return
    window.scrollTo(0, 0)
  }, [pathname, navigationType])

  return null
}

/** `[中 | EN]` 膠囊分段切換：選中項用藍紫漸層，與日夜切換按鈕視覺高度一致 */
function LanguageToggle() {
  const { lang, setLang, t } = useLanguage()
  const options = [
    { value: 'zh', label: '中' },
    { value: 'en', label: 'EN' },
  ]

  return (
    <div
      role="group"
      aria-label={t('app.language')}
      className="flex h-8 shrink-0 items-center rounded-full bg-slate-100 p-0.5 dark:bg-slate-900"
    >
      {options.map((option) => {
        const active = lang === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLang(option.value)}
            aria-pressed={active}
            className={`flex h-7 min-w-8 items-center justify-center rounded-full px-2 text-xs leading-4 transition ${
              active
                ? 'bg-gradient-to-r from-sky-500 to-indigo-500 font-bold text-white shadow-sm'
                : 'font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** 款式 B 的頂部毛玻璃膠囊 Header（含語言與日夜切換） */
function Header() {
  const { isDark, toggleTheme } = useTheme()
  const { t } = useLanguage()
  const headerRef = useRef(null)

  // 把 Header 的實際高度寫進 CSS 變數 --app-header-h：頁面內的 sticky 工具列（例如搜尋頁站序的
  // 返回列）才能貼在 Header 下緣而不被蓋住。以量測取代硬編碼 px，日後改 Header 版面不必同步改其他頁。
  useEffect(() => {
    const element = headerRef.current
    if (!element) return undefined
    const sync = () => {
      document.documentElement.style.setProperty('--app-header-h', `${element.offsetHeight}px`)
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync)
      return () => window.removeEventListener('resize', sync)
    }
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <header ref={headerRef} className="sticky top-0 z-20 px-3 pt-2">
      <div className="mx-auto flex w-full max-w-md items-center gap-2 rounded-[22px] border border-white/80 bg-white/85 px-3 py-2 shadow-sm backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-800/80">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-sm">
          <BusFront className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold leading-tight text-slate-900 dark:text-white">
            {t('app.title')}
          </h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {t('app.subtitle')}
          </p>
        </div>
        <LanguageToggle />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? t('app.themeLight') : t('app.themeDark')}
          aria-pressed={isDark}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/70 text-slate-500 transition hover:bg-white hover:text-slate-800 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
        >
          {isDark ? (
            <Sun className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  )
}

/** 主要版面：漸層背景＋環境光暈＋毛玻璃 Header＋置中內容＋懸浮島 Dock */
function AppShell() {
  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-br from-sky-100 via-sky-50 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/90">
      {/* 背景光暈：只作裝飾，pointer-events-none 不干擾點擊 */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-sky-300/40 blur-3xl dark:bg-sky-500/10" />
        <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-500/10" />
        <div className="absolute -bottom-16 left-1/3 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl dark:bg-indigo-400/10" />
      </div>

      <Header />
      <main className="relative z-10 mx-auto w-full max-w-md flex-1 px-3 pb-28 pt-3">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter basename={BASENAME}>
        <ScrollToTop />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Nearby />} />
            <Route path="/search" element={<Search />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          {/* 由站點卡片以原視窗導覽切換：顯示整條路線站序、各站到站時間與反轉方向 */}
          <Route
            path="/route/:operator/:route/:direction"
            element={
              <Suspense fallback={<RouteWindowFallback />}>
                <RouteSequence />
              </Suspense>
            }
          />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  )
}
