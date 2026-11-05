import { useCallback, useEffect, useRef, useState } from 'react'

/** 往下捲超過這個位置就收起地圖 */
const COLLAPSE_AT = 36
/** 回到這個位置以下就展開地圖 */
const EXPAND_AT = 12
/** 手動「展開全圖」後，要再往下滑多少才重新自動收起 */
const MANUAL_SCROLL_DELTA = 120

/**
 * 置頂地圖的「捲動縮小 1/3」共用邏輯（Nearby／Search／RouteSequence 共用）。
 *
 * - 預設監聽 `window.scrollY`：`> 36` 收起地圖、`<= 12` 展開（passive scroll + rAF 防抖）。
 * - 若頁面是「固定高度 + 內部清單滾動」（例如站序頁的 `<ol>`），把 `handleScroll`
 *   直接綁到該容器的 `onScroll`，便會改用 `event.currentTarget.scrollTop` 判斷。
 * - 按「展開全圖」（`toggleCollapse`）後暫停自動收起，直到使用者再往下滑 >120px；
 *   回到頂部後恢復自動偵測。
 *
 * @returns {{collapsed: boolean, toggleCollapse: () => void, handleScroll: (event?: {currentTarget: HTMLElement}) => void, resetCollapse: () => void}}
 */
export default function useMapCollapse() {
  const [collapsed, setCollapsed] = useState(false)
  const manualExpandRef = useRef(false)
  const manualExpandYRef = useRef(0)
  const lastYRef = useRef(0)
  const frameRef = useRef(0)
  // 自動貼合（scrollIntoView smooth）期間暫停「滑動即收起」，避免地圖被自己捲走；
  // 貼合完成後（約 1.2 秒）恢復正常手勢偵測。
  const suppressUntilRef = useRef(0)

  const evaluate = useCallback((y) => {
    lastYRef.current = y
    if (Date.now() < suppressUntilRef.current) return
    if (y <= EXPAND_AT) {
      manualExpandRef.current = false
      setCollapsed(false)
      return
    }
    if (manualExpandRef.current) {
      if (y > manualExpandYRef.current + MANUAL_SCROLL_DELTA) {
        manualExpandRef.current = false
        setCollapsed(true)
      }
      return
    }
    if (y > COLLAPSE_AT) setCollapsed(true)
  }, [])

  const schedule = useCallback(
    (y) => {
      if (frameRef.current) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        evaluate(y)
      })
    },
    [evaluate],
  )

  // 頁面層級滾動（Nearby／Search）；站序頁的內部清單會另外呼叫 handleScroll(event)
  useEffect(() => {
    const handleWindowScroll = () => schedule(window.scrollY)
    handleWindowScroll()
    window.addEventListener('scroll', handleWindowScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleWindowScroll)
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    }
  }, [schedule])

  /** 綁在內部滾動容器：`<ol onScroll={handleScroll}>` */
  const handleScroll = useCallback(
    (event) => {
      const target = event?.currentTarget
      schedule(target && target !== window ? target.scrollTop : window.scrollY)
    },
    [schedule],
  )

  /** 點「展開全圖」：暫時恢復完整高度，並記住當下位置作為重新收起的基準 */
  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      if (prev) {
        manualExpandRef.current = true
        manualExpandYRef.current = lastYRef.current
        return false
      }
      manualExpandRef.current = false
      return true
    })
  }, [])

  /**
   * 強制回到展開狀態（切換路線／返回清單／點站點自動貼合時使用）。
   * 同時短暫抑制「捲動即收起」，讓後續的 scrollIntoView 平滑捲動不會立刻把地圖縮小；
   * 貼合完成後使用者再往下滑，縮小邏輯照常運作。
   */
  const resetCollapse = useCallback(() => {
    manualExpandRef.current = false
    suppressUntilRef.current = Date.now() + 1600
    setCollapsed(false)
  }, [])

  return { collapsed, toggleCollapse, handleScroll, resetCollapse }
}
