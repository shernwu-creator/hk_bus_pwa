import { Search, X } from 'lucide-react'
import useLanguage from '../hooks/useLanguage.js'

/**
 * 路線搜尋框：支援數字與英文字母輸入（例如 1A、680X、A21）
 */
export default function SearchBar({ value, onChange, placeholder, label, onClear }) {
  const { t } = useLanguage()
  const handleClear = () => {
    onChange('')
    onClear?.()
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        aria-label={label ?? t('search.label')}
        value={value}
        placeholder={placeholder ?? t('search.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/80 bg-white/90 py-3 pl-10 pr-10 text-sm text-slate-900 shadow-sm outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700/70 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-500/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label={t('search.clear')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
