import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages 專案站台預設發佈在 https://<user>.github.io/<repo>/，
 * 因此建置時必須使用子路徑；改用自己的網域時可在 CI 設定 VITE_BASE_PATH=/。
 */
const DEFAULT_BASE = '/hk_bus_pwa/'

/**
 * PWA 專屬 ID（manifest `id`）：瀏覽器判斷「是否為同一個 App」只看這個值，
 * 不是 name、也不是 start_url。這裡刻意寫成「不跟隨 base」的固定路徑，原因：
 *   1. 同一 origin（例如 shernwu-creator.github.io）下的其他 PWA 專案各有自己的 id，
 *      即使本站改用自訂網域／部署到網站根目錄（VITE_BASE_PATH=/），也不會撞身分，
 *      因此多個 PWA 可以同時安裝在同一部裝置；
 *   2. Service Worker 更新時 id 不變，安裝的 App 才會被視為「同一個 App 的升級」。
 * ⚠️ 一旦發佈就不要改：改了會被視為另一個 App，使用者需要重新安裝。
 */
const APP_ID = '/hk-bus-eta/'

/**
 * CacheStorage 與 IndexedDB 都是以「origin」為單位共用，GitHub Pages 上同一個帳號的
 * 所有專案共用同一個 origin，因此快取名稱一律加上本專案專屬前綴，
 * 避免和其他 PWA 專案的 `static-data`、`assets` 之類通用名稱互相覆蓋。
 */
const CACHE_PREFIX = 'hkbus-'

function withTrailingSlash(value) {
  if (!value) return '/'
  return value.endsWith('/') ? value : `${value}/`
}

/**
 * GitHub Pages 對 /hk_bus_pwa/search 這類深層連結會直接回 404，
 * 這裡在建置後複製一份 index.html 成 404.html，讓 SPA 仍能啟動再由 Router 接手。
 */
function spaFallbackPlugin() {
  let outDir = 'dist'
  return {
    name: 'hk-bus-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const indexFile = path.resolve(outDir, 'index.html')
      if (!fs.existsSync(indexFile)) return
      fs.copyFileSync(indexFile, path.resolve(outDir, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => {
  // `vite preview` 也要沿用與建置相同的子路徑，否則 dist/index.html 內的
  // /hk_bus_pwa/assets/* 會找不到（dev 仍用根路徑 '/'）。
  const base = withTrailingSlash(
    process.env.VITE_BASE_PATH ?? (command === 'build' || isPreview ? DEFAULT_BASE : '/'),
  )

  return {
    base,
    plugins: [
      react(),
      spaFallbackPlugin(),
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
            '以 GPS 定位查詢 500 公尺內九巴 (KMB)、城巴 (CTB) 與專線小巴 (GMB) 站點的路線、上車收費與最近三班車到站時間。',
          lang: 'zh-HK',
          dir: 'ltr',
          // 專屬安裝身分（固定值，不隨 base 變動）：可與其他 PWA 專案並存在同一部裝置
          id: APP_ID,
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f8fafc',
          theme_color: '#0f172a',
          categories: ['travel', 'navigation', 'utilities'],
          icons: [
            { src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${base}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${base}pwa-maskable-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          // 子路徑部署時導覽回退必須指向正確的 index.html
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // 九巴 ETA／站點 API：先取網絡，短時間內可離線讀快取
              urlPattern: ({ url }) => url.hostname === 'data.etabus.gov.hk',
              handler: 'NetworkFirst',
              options: {
                cacheName: `${CACHE_PREFIX}kmb-api`,
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
                cacheName: `${CACHE_PREFIX}citybus-api`,
                networkTimeoutSeconds: 8,
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // 小巴 ETA API
              urlPattern: ({ url }) => url.hostname === 'data.etagmb.gov.hk',
              handler: 'NetworkFirst',
              options: {
                cacheName: `${CACHE_PREFIX}gmb-api`,
                networkTimeoutSeconds: 8,
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // 站點／路線索引（public/data/*.json）：體積較大，改用 SWR 避免每次重抓
              urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.includes('/data/'),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: `${CACHE_PREFIX}static-data`,
                expiration: { maxEntries: 12, maxAgeSeconds: 7 * 24 * 60 * 60 },
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
  }
})


