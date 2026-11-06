import { Keyboard, Search, X } from 'lucide-react'
import useLanguage from '../hooks/useLanguage.js'

/**
 * 路線搜尋框：支援數字與英文字母輸入（例如 1A、680X、A21）
 *
 * 手機上原生鍵盤體驗不佳，因此輸入框設為 `readOnly`＋`inputMode="none"`，
 * 焦點不會彈出系統鍵盤，改由 Search 頁置底的自訂虛擬鍵盤（VirtualKeyboard）輸入；
 * 點擊輸入框或右側鍵盤圖示會呼叫 `onActivate` 打開自訂鍵盤。
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(value:string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {string} [props.label]
 * @param {() => void} [props.onClear]
 * @param {() => void} [props.onActivate] 點擊輸入框／鍵盤圖示時開啟自訂鍵盤
 */
export default function SearchBar({ value, onChange, placeholder, label, onClear, onActivate }) {
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
        inputMode="none"
        readOnly
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        aria-label={label ?? t('search.label')}
        value={value}
        placeholder={placeholder ?? t('search.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onActivate}
        onClick={onActivate}
        className="w-full cursor-text rounded-[22px] border border-white/80 bg-white/90 py-3 pl-10 pr-10 text-sm text-slate-900 shadow-sm outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700/70 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-500/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label={t('search.clear')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onActivate}
          aria-label={t('keyboard.show')}
          title={t('keyboard.show')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800 dark:hover:text-sky-300"
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
