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
  return (
    <div className="space-y-2 pt-1" aria-busy="true" aria-label="頁面載入中">
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

function Header() {
  const { isDark, toggleTheme } = useTheme()
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
    <header
      ref={headerRef}
      className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/85 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-950/80"
    >
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900">
          <BusFront className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold leading-tight text-slate-900 dark:text-white">
            香港巴士實時到站
          </h1>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            九巴 KMB · 城巴 CTB · 小巴 GMB · 票價與最近三班車
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? '切換至淺色模式' : '切換至深色模式'}
          aria-pressed={isDark}
          className="rounded-full p-2 text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          {isDark ? (
            <Sun className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Moon className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  )
}

/** 主要版面：Header + 置中內容 + 底部導覽（不含路線站序頁） */
function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-md flex-1 px-3 pb-24 pt-3">
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
  )
}
