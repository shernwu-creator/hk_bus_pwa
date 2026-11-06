import { ChevronDown, Delete, Keyboard, X } from 'lucide-react'
import useLanguage from '../hooks/useLanguage.js'

/**
 * 搜尋頁專用的自訂虛擬鍵盤（置底懸浮玻璃卡）
 *
 * 原生手機鍵盤在路線號碼搜尋時的體驗不佳（注音／拼音候選字、鍵盤高度與版面跳動），
 * 因此 `SearchBar` 的輸入框設為 `readOnly`，由這個鍵盤負責全部輸入：
 *   - 左側：3×4 數字鍵（1–9、清除全部、0、退格），符合路線號碼以數字為主的使用情境。
 *   - 右側：香港巴士路線常用的英文字母（A、B、C、E、H、K、N、P、S、X…），
 *     以雙欄列表呈現，超出高度可上下滑動。
 *
 * 元件只負責「按了什麼」，實際的字串狀態仍由 Search 持有（`value` / `onChange`）。
 *
 * @param {object} props
 * @param {string} [props.value] 目前搜尋字串
 * @param {(next:string) => void} props.onChange 輸入變更（已套用長度上限）
 * @param {() => void} [props.onClose] 收起鍵盤
 * @param {string} [props.className]
 */

/** 路線號碼最長輸入長度（例如 N281、680X、A21 都遠短於此） */
export const MAX_QUERY_LENGTH = 8

/** 香港巴士路線號碼常見的英文字母（依字母排序） */
const ROUTE_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'H',
  'K',
  'M',
  'N',
  'P',
  'R',
  'S',
  'T',
  'X',
  'Y',
]

/** 數字鍵盤的 3×4 配置：第三列是清除全部、0、退格 */
const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace']

const KEY_CLASS =
  'flex h-10 select-none items-center justify-center rounded-xl border border-white/70 bg-white/80 text-sm font-bold text-slate-700 shadow-sm transition active:scale-95 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100'

export default function VirtualKeyboard({ value = '', onChange, onClose, className = '' }) {
  const { t } = useLanguage()

  const commit = (next) => onChange(next.slice(0, MAX_QUERY_LENGTH))
  const append = (key) => {
    if (value.length >= MAX_QUERY_LENGTH) return
    commit(`${value}${key}`)
  }
  const backspace = () => commit(value.slice(0, -1))
  const clear = () => commit('')

  return (
    <div
      role="group"
      aria-label={t('keyboard.label')}
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      className={`animate-fade-in fixed inset-x-3 z-40 mx-auto max-w-md rounded-[22px] border border-white/80 bg-white/90 p-2 shadow-lg backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-800/90 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <p className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('keyboard.title')}</span>
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('keyboard.hide')}
            title={t('keyboard.hide')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700/70 dark:hover:text-slate-200"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)] gap-2">
        <div className="grid grid-cols-3 gap-1.5">
          {KEYPAD_KEYS.map((key) => {
            if (key === 'clear') {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={clear}
                  aria-label={t('keyboard.clear')}
                  title={t('keyboard.clear')}
                  className={`${KEY_CLASS} text-rose-600 dark:text-rose-300`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )
            }
            if (key === 'backspace') {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={backspace}
                  aria-label={t('keyboard.backspace')}
                  title={t('keyboard.backspace')}
                  className={KEY_CLASS}
                >
                  <Delete className="h-4 w-4" aria-hidden="true" />
                </button>
              )
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => append(key)}
                className={`${KEY_CLASS} tabular-nums`}
              >
                {key}
              </button>
            )
          })}
        </div>

        {/* 字母較多：雙欄列表，超出高度時可上下滑動 */}
        <div
          role="group"
          aria-label={t('keyboard.letters')}
          className="scrollbar-none max-h-[178px] overflow-y-auto overscroll-contain rounded-xl border border-white/70 bg-white/50 p-1 dark:border-slate-700/60 dark:bg-slate-900/40"
        >
          <div className="grid grid-cols-2 gap-1.5">
            {ROUTE_LETTERS.map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => append(letter)}
                className={KEY_CLASS}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
