import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker：由 vite-plugin-pwa 產生，autoUpdate 模式會在背景自動更新
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // 每小時主動檢查是否有新版本（實時到站邏輯更新時可盡快套用）
    setInterval(
      () => {
        registration.update().catch(() => {})
      },
      60 * 60 * 1000,
    )
  },
  onOfflineReady() {
    console.info('[PWA] 靜態資源已快取，可離線開啟 App 外殼。')
  },
  onRegisterError(error) {
    console.warn('[PWA] Service Worker 註冊失敗：', error)
  },
})

