import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BusFront, Moon, Sun } from 'lucide-react'
import BottomNav from './components/BottomNav.jsx'
import Favorites from './pages/Favorites.jsx'
import Nearby from './pages/Nearby.jsx'
import Search from './pages/Search.jsx'
import useTheme from './hooks/useTheme.js'

function Header() {
  const { isDark, toggleTheme } = useTheme()

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/85 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900">
          <BusFront className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold leading-tight text-slate-900 dark:text-white">
            香港巴士實時到站
          </h1>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            九巴 KMB · 城巴 CTB · 票價與最近三班車
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="mx-auto w-full max-w-md flex-1 px-3 pb-24 pt-3">
          <Routes>
            <Route path="/" element={<Nearby />} />
            <Route path="/search" element={<Search />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
