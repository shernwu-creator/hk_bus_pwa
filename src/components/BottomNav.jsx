import { NavLink } from 'react-router-dom'
import { MapPin, Star, Search } from 'lucide-react'
import useLanguage from '../hooks/useLanguage.js'

const TABS = [
  { to: '/', labelKey: 'nav.nearby', icon: MapPin, end: true },
  { to: '/search', labelKey: 'nav.search', icon: Search, end: false },
  { to: '/favorites', labelKey: 'nav.favorites', icon: Star, end: false },
]

/**
 * 款式 B 底部懸浮島 Dock：毛玻璃膠囊、距底部保留安全間距，
 * 選中的 Tab 套用藍紫漸層膠囊。
 */
export default function BottomNav() {
  const { t } = useLanguage()

  return (
    <nav
      aria-label={t('nav.main')}
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      className="fixed inset-x-4 bottom-3 z-30 mx-auto max-w-sm rounded-full border border-white/80 bg-white/90 p-1.5 shadow-lg backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-800/90"
    >
      <ul className="flex items-stretch gap-1">
        {TABS.map(({ to, labelKey, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center gap-0.5 rounded-full py-2 text-xs transition',
                  isActive
                    ? 'bg-gradient-to-r from-sky-500 to-indigo-500 font-extrabold text-white shadow-sm'
                    : 'font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`h-5 w-5 ${isActive ? 'stroke-[2.4]' : ''}`}
                    aria-hidden="true"
                  />
                  {t(labelKey)}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
