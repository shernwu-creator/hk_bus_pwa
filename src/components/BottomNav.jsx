import { NavLink } from 'react-router-dom'
import { MapPin, Star, Search } from 'lucide-react'

const TABS = [
  { to: '/', label: '附近', icon: MapPin, end: true },
  { to: '/search', label: '搜尋', icon: Search, end: false },
  { to: '/favorites', label: '收藏', icon: Star, end: false },
]

/**
 * 手機優先的底部導覽列（固定在安全區域上方）
 */
export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/90 pb-safe backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/90"
      aria-label="主要導覽"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition',
                  isActive
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`h-5 w-5 ${isActive ? 'stroke-[2.4]' : ''}`}
                    aria-hidden="true"
                  />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
