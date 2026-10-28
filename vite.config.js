import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate：Service Worker 偵測到新版本時自動接管，適合實時到站這種需要最新邏輯的 App
      registerType: 'autoUpdate',
      // 交由 src/main.jsx 手動註冊，方便集中處理更新/離線狀態
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '香港巴士實時到站｜HK Bus ETA',
        short_name: 'HK Bus',
        description:
          '以 GPS 定位查詢 500 公尺內九巴 (KMB) 與城巴 (CTB) 站點的路線、上車收費與最近三班車到站時間。',
        lang: 'zh-HK',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        categories: ['travel', 'navigation', 'utilities'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 九巴 ETA／站點 API：先取網絡，短時間內可離線讀快取
            urlPattern: ({ url }) => url.hostname === 'data.etabus.gov.hk',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kmb-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 城巴 ETA／站點 API
            urlPattern: ({ url }) => url.hostname === 'rt.data.gov.hk',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'citybus-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // 開發時不啟用 SW，避免 HMR 與快取互相干擾；請用 npm run build && npm run preview 驗證 PWA
        enabled: false,
      },
    }),
  ],
})

