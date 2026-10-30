# 香港巴士實時到站｜HK Bus ETA (PWA)

以 GPS 定位查詢香港 **九巴 (KMB)**、**城巴 (CTB)** 與 **專線小巴 (GMB)** 站點的 PWA：附近站點、路線搜尋、票價與最近三班車到站倒數，支援離線開啟（App Shell）與深色模式。

站點內點選任一路線，會**另開視窗**顯示該方向的全線站序：自動標示你開啟時所在的站點並展開最近三班車，其他站點可逐一展開查看，也可一鍵**反轉方向**查另一邊的車。

資料全部來自 [DATA.GOV.HK](https://data.gov.hk/) 的公開 API，本專案非官方產品。
開發規範（AI 代理必讀）見 [`AGENTS.md`](./AGENTS.md)：優先使用 CodeGraph 探索程式結構，禁止大範圍 grep 與讀檔。

- 線上版本：<https://shernwu-creator.github.io/hk_bus_pwa/>（GitHub Pages，子路徑 `/hk_bus_pwa/`）

---

## 1. 快速開始

```bash
npm ci               # 依 package-lock.json 安裝（CI 相同）
npm run dev          # http://localhost:5173
npm run build        # 產出 dist/（含 sw.js、manifest.webmanifest、404.html）
npm run preview      # 以靜態伺服器驗證 PWA（注意：會掛在 /hk_bus_pwa/ 子路徑）
npm run lint         # oxlint
```

> 定位功能只在 `https` 或 `localhost` 下可用；其他來源會自動退回預設座標（尖沙咀天星碼頭）。
> `npm run preview` 預設會開啟 `http://localhost:4173/hk_bus_pwa/`，因為建置時的 `base` 是子路徑。

### 資料同步腳本

```bash
npm run sync:data      # 重建城巴 + 小巴站點索引 ＋ 運輸署票價表（需連線，約 3～6 分鐘）
npm run sync:fares     # 只重建票價表（數秒）
node scripts/sync-data.mjs --gmb-only   # 只重建小巴索引
node scripts/sync-data.mjs --ctb-only   # 只重建城巴索引
npm run generate:icons # 重新產生 public/ 內的 PNG 圖示（純 Node，無外部依賴）
```

`sync:data` 會掃描 409 條城巴路線 × 2 方向、573 條小巴路線與其站序，並逐一查詢站點座標。
建議每季或發現站點有異動時執行一次；小巴座標會沿用既有快照，重跑時只補新站。

GitHub Actions 的 [`sync-data.yml`](./.github/workflows/sync-data.yml) 會每週日 04:00（香港時間）自動執行
`node scripts/sync-data.mjs`，並把 `public/data/`（站點索引）與 `src/data/`（票價表）一起 commit／push，
再觸發 Pages 部署，因此不必手動更新大檔。

---

## 2. GitHub Pages 部署

| 項目 | 設定 |
| --- | --- |
| 站台網址 | `https://shernwu-creator.github.io/hk_bus_pwa/` |
| 建置 base | `vite.config.js` 的 `DEFAULT_BASE = '/hk_bus_pwa/'`（可用 `VITE_BASE_PATH` 覆寫） |
| CI | `.github/workflows/deploy.yml`（push `main` → build → `actions/deploy-pages`） |
| Source | Repo → Settings → Pages → Source: **GitHub Actions**（workflow 內 `configure-pages` 的 `enablement: true` 會自動啟用） |
| SPA 深層連結 | 建置後自動複製 `dist/index.html` → `dist/404.html`，`/hk_bus_pwa/search` 也能直接開啟 |

**子路徑必須三處一致**，否則會出現「白屏」或資源 404：

1. `vite.config.js` 的 `base`（影響 JS/CSS/圖示/manifest 路徑）；
2. `src/App.jsx` 的 `<BrowserRouter basename={import.meta.env.BASE_URL}>`；
3. `vite.config.js` manifest 的 `start_url` / `scope`（安裝成 App 後從正確路徑啟動）。

改用自己的網域（或部署到 `<user>.github.io` 根目錄）時，只要在 CI 設定 `VITE_BASE_PATH=/`，其餘設定會自動跟隨。

---

## 3. 使用到的 API

| 業者 | 用途 | 端點 |
| --- | --- | --- |
| KMB | 全部站點 | `https://data.etabus.gov.hk/v1/transport/kmb/stop` |
| KMB | 路線清單 | `.../route/` |
| KMB | 路線站序 | `.../route-stop/{route}/{outbound\|inbound}/{serviceType}` |
| KMB | 站點 ETA（一站查全部路線） | `.../stop-eta/{stopId}` |
| CTB | 路線清單 | `https://rt.data.gov.hk/v2/transport/citybus/route/CTB` |
| CTB | 路線站序 | `.../route-stop/CTB/{route}/{outbound\|inbound}` |
| CTB | 單一站點 | `.../stop/{stopId}` |
| CTB | 站點全部路線 ETA（批次，前端主要使用） | `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/{stopId}?lang=zh-hant` |
| CTB | ETA（單一路線，批次失敗時備援） | `.../eta/CTB/{stopId}/{route}`（**順序是站點→路線**） |
| GMB | 路線清單 | `https://data.etagmb.gov.hk/route/`（`data.routes.{HKI,KLN,NT}`） |
| GMB | 路線細節（route_id / route_seq / 起訖站） | `.../route/{region}/{routeCode}` |
| GMB | 路線站序 | `.../route-stop/{routeId}/{routeSeq}` |
| GMB | 站點座標 | `.../stop/{stopId}` |
| GMB | 站點 ETA（一站查全部路線） | `.../eta/stop/{stopId}` |
| TD | 票價（KMB / CTB 全程收費） | `https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml` |

**三個業者的資料模型差異（重要）**

- **九巴**：有「全部站點」與「站點 → 全部路線 ETA」端點，一個站一次請求就拿到所有路線到站時間。
- **城巴**：沒有全站點端點，也**沒有**站點層級 ETA。站點清單由 `sync:data` 掃 `route-stop` 建索引；查 ETA 只能逐條路線打（前端上限 8 條、併發 4）。
- **小巴**：沒有全站點端點，但**有**站點層級 ETA（`/eta/stop/{id}`）。回應只帶 `route_id` / `route_seq`，
  路線號碼、方向與目的地要用 `public/data/gmb-routes.json` 對照，因此小巴的路線／站點索引同樣由 `sync:data` 產生。
- **小巴票價**：運輸署 `ROUTE_BUS.xml` 只含專營巴士，UI 對小巴一律顯示「票價待查」。

---

## 4. 靜態資料策略（public/data + IndexedDB）

城巴＋小巴的站點索引約 1 MB，若用 `import ... from './data/*.json'` 打包，會直接拖慢首次繪製 (FCP)。
因此改成「建置前產生、執行時延遲載入」：

```
npm run sync:data
      │
      ├─ public/data/citybus-stops.json   [[stopId, name_tc, name_en, lat, lng, [route...]], ...]
      ├─ public/data/gmb-routes.json      [[route_id, route_seq, route_code, region, orig_tc, dest_tc, ...], ...]
      ├─ public/data/gmb-stops.json       [[stopId, name_tc, name_en, lat, lng, [routeCode...]], ...]
      └─ src/data/fares.json              { generatedAt, operators: { KMB: { "1A|1": 8.2 }, CTB: {...} } }
```

`src/services/staticData.js` 提供 `loadStaticData(name)`：

```
記憶體 Map → IndexedDB（hkb-static / assets，6 小時 TTL）→ fetch(public/data/…)
```

- 只有「附近」或「搜尋」頁真的需要時才下載，主 JS bundle 不含站點索引。
- 抓到的內容寫入 IndexedDB，有效期內重新整理、離線開啟都不必再連網。
- 網路失敗但有舊快照時會沿用舊資料（寧可顯示略舊的站點，也不要整頁失敗）。
- Service Worker 另外以 `StaleWhileRevalidate` 快取 `/data/*.json`，形成第二層保險。
- 票價表體積小（約 13 KB）且需要同步查表，仍維持打包進 bundle。

---

## 5. 程式結構

```
src/
├─ main.jsx                  # 掛載 App、註冊 Service Worker（vite-plugin-pwa）
├─ App.jsx                   # Router（basename 跟隨 BASE_URL）＋版面；頁面以 React.lazy 分 chunk
├─ index.css                 # Tailwind 進入點與共用樣式（.card / .chip）
├─ pages/
│  ├─ Nearby.jsx             # 附近站點：定位 → 半徑篩選 → 展開查 ETA
│  ├─ Search.jsx             # 路線搜尋：路線 → 方向 → 站序 → ETA
│  ├─ Favorites.jsx          # 已收藏站點（localStorage）
│  └─ RouteSequence.jsx      # 新視窗站序頁：全線站序、各站三班 ETA、反轉方向（URL 可分享）
├─ components/
│  ├─ BusCard.jsx            # 路線卡片：業者、目的地、票價、三班倒數（點擊開新視窗看站序）
│  ├─ StopSection.jsx        # 可展開的站點區塊（收藏星星、站序徽章、各路線 ETA）
│  ├─ EtaSlots.jsx           # 最近三班車的 ETA 格（BusCard 與新視窗站序頁共用）
│  ├─ RouteStopsPanel.jsx    # 搜尋頁的站序清單
│  ├─ SearchBar.jsx / OperatorBadge.jsx / BottomNav.jsx
│  └─ StateViews.jsx         # Skeleton / ErrorState / EmptyState
├─ hooks/
│  ├─ useLocation.js         # Geolocation + 權限/錯誤狀態 + 預設座標
│  ├─ useBusData.js          # ETA 抓取與 30 秒輪詢（Promise.allSettled；切到背景停止、回前景立即更新）
│  ├─ useFavorites.js        # localStorage「hkb:favorites:v1」（含 routes / siblingIds）
│  └─ useTheme.js            # 深色模式「hkb:theme」＋ html.dark
├─ services/
│  ├─ api.js                 # 快取、站點、路線、票價、ETA（KMB / CTB / GMB）集中在這裡
│  └─ staticData.js          # public/data/*.json + IndexedDB 快取
├─ data/
│  └─ fares.json             # 由 sync:data 產生（請勿手改）
└─ utils/
   ├─ format.js              # 距離／時間／分鐘／服務類型文字
   └─ routeLinks.js          # 新視窗站序頁的 URL 組裝與 window.open（含 BASE_URL 前綴）

public/
├─ data/                     # 由 sync:data 產生（請勿手改）
└─ pwa-*.png / favicon.svg / apple-touch-icon.png

scripts/
├─ sync-data.mjs             # 城巴 + 小巴站點索引、運輸署票價表
└─ generate-icons.mjs        # 產生 PWA PNG 圖示（自製 PNG 編碼器）

.github/workflows/deploy.yml # GitHub Pages 建置與部署
```

---

## 6. 資料流與規則

### 6.1 快取層級

| 資料 | 來源 | 快取 |
| --- | --- | --- |
| 九巴全部站點 | 官方 API | 記憶體 → localStorage（`hkb:cache:kmb-stops`，12 小時） |
| 城巴／小巴站點索引 | `public/data/*.json` | 記憶體 → IndexedDB（6 小時）＋ SW `static-data` |
| 路線索引（KMB/CTB 官方 + 小巴靜態） | API + `gmb-routes.json` | 記憶體 → localStorage（`hkb:cache:route-index-v2`，12 小時） |
| 票價 | `src/data/fares.json` | 打包進 bundle |
| ETA | 官方 API | 不快取，每 30 秒輪詢（切到背景暫停） |

### 6.2 附近站點

`getNearbyStops({ lat, lng, radius, limit })`：

1. `Promise.allSettled` 同時取得九巴站點、城巴索引、小巴索引；任一業者失敗仍會顯示其他業者。
2. Haversine 計算距離，取半徑內站點。
3. **同業者 + 同站名 + 120 公尺內**視為同一車站的不同站牌/月台：
   - 站名去掉結尾的 `(YY123)` 月台代號再顯示；
   - 其餘站牌編號存進 `siblingIds`，查 ETA 時一併合併（每站最多再多查 5 個站牌）。
4. 不同業者即使座標相同也**不合併**，因為 ETA 來源不同。

### 6.3 ETA 合併

- `groupEtaRows()`：把「一列一班車」整理成「一條路線一筆」，key 為 `路線|方向`（刻意不含 `service_type`，避免 5C 這種多服務類型重複顯示）。
- `mergeEtaGroups()`：合併多個站牌的回應，同路線＋方向只留一筆，時間差 < 60 秒視為同一班車。
- **城巴**：`getCitybusStopEtas()` 先打批次端點（一站一次拿全部路線，含索引未收錄的新路線），失敗才逐路線查詢備援；批次回應的 `dest`／`rmk` 會正規化成 `dest_tc`／`rmk_tc` 後併入 `groupEtaRows()`。
- 小巴以 `route_id|route_seq` 對照路線號碼與方向（`route_seq` 1 = 去程、2 = 回程）。
- 每個站點的 ETA 都包在 `Promise.allSettled` 裡，單一 API timeout 只會讓那一張卡片顯示錯誤，不會讓整頁崩潰。

### 6.4 票價

`getFare(operator, route, serviceType)` 查 `fares.json`（key：`路線|service_type`），查不到回傳 `null`，UI 顯示「票價待查」。
共同營運的路線會同時提供 KMB 與 CTB 兩份資料；小巴沒有官方票價來源。

### 6.5 新視窗路線站序（RouteSequence）

站點展開後，每一張路線卡片都是「在新視窗查看全線站序」的按鈕（右下方有 ↗ 提示）：

1. `StopSection` 不再行內展開，改呼叫 `openRouteSequence(entry, stop)`；`routeLinks.js` 以 `import.meta.env.BASE_URL` 組出
   `{base}route/:operator/:route/:direction?stop=…`（query 可帶 `name`／`siblings`／`serviceType`／`routeId`／`routeSeq`／`orig`／`dest`）。
   `window.open(url, '_blank')` 被擋時退回同視窗導覽，因此 PWA／彈窗封鎖環境仍可開啟。
2. 新視窗頁 `RouteSequence.jsx` 註冊在 `App.jsx` 的 `/route/:operator/:route/:direction`（不經 AppShell，全螢幕、無底部導覽），
   所有狀態都從 URL 還原，因此**可直接分享、重新整理、上一頁**。
3. 頁面以 `getRouteStops()` 取得全線站序（KMB／CTB 用 `route + direction + serviceType`；GMB 需要 `routeId + routeSeq`）。
4. 來源站（query `stop`，並同時比對 `siblings` 月台 ID）會自動高亮並展開：
   - 以 `getStopEtas()` 查該站 ETA，再以「路線＋方向」過濾出最近三班（城巴一次批次請求即可）；
   - `EtaSlots` 與站點卡片共用同一套三班車 UI；這個展開面板每 30 秒自動更新，也可手動刷新；
   - 站序載入後會把來源站捲到清單中央。
5. **其他站點也可以點開**：任一列都是按鈕，點擊後展開該站的最近三班車（同時間只展開一站，再點收合），
   切站時舊請求與計時器會隨元件卸載一併取消。
6. **站點收藏**：每一列右側（摺疊箭頭左邊）都有星號，可即時收藏／取消收藏站點；收藏與主 App 共用
   `hkb:favorites:v1`，靠 `storage` 事件跨分頁同步（站序頁收藏後，主 App 的「收藏」頁立即出現）。
7. **返回**：標題列左上角「← 返回」會依序嘗試：
   - `window.opener` 存在 → `opener.focus()` 後 `window.close()`（回到原本的 App 分頁，原本展開的站點狀態仍在）；
     若瀏覽器不允許 script 關閉視窗，退回 App 首頁；
   - 同視窗 fallback（彈窗被擋）且 `document.referrer` 是同源 App → `history.back()`；
   - 其他（直接貼 URL 開新分頁）→ 返回 App 首頁。
   為此 `openRouteSequence()` 刻意不再清除 `window.opener`。
8. **反轉方向**：`getRouteIndex()` 找出同路線的另一方向（KMB 沿用 serviceType、優先 1；GMB 以起訖站對照＋相反 routeSeq 選出折返路線），
   以 `navigate(..., { replace: true })` 更新 URL（不新增瀏覽紀錄）並重新抓站序。
   反向站點 ID 通常不同，因此會先用站名、再用座標在反向站序中找回最接近的站點並自動展開；
   若另一方向不停靠附近位置，就只顯示站序、不標示「本站」。


---

## 7. PWA 設定

- `vite.config.js`：`registerType: 'autoUpdate'`、`injectRegister: null`（由 `src/main.jsx` 手動註冊，每小時檢查更新）。
- Manifest：`start_url` / `scope` / `id` 皆為建置 base（`/hk_bus_pwa/`），安裝後從正確路徑啟動。
- 執行期快取：
  - `data.etabus.gov.hk`（九巴）、`rt.data.gov.hk`（城巴）、`data.etagmb.gov.hk`（小巴）→ `NetworkFirst`（8 秒逾時），斷網時仍能看到最後一次資料；
  - 自家 `/data/*.json` 索引 → `StaleWhileRevalidate`。
- 圖示：`public/pwa-192x192.png`、`pwa-512x512.png`、`pwa-maskable-512x512.png`、`apple-touch-icon.png`，皆由 `npm run generate:icons` 產生。
- 驗證方式：`npm run build && npm run preview`，開啟 `http://localhost:4173/hk_bus_pwa/`，在 DevTools → Application 檢查 Manifest 與 Service Worker；`dist/404.html` 應存在。

---

## 8. 已知限制

- **城巴 ETA 已改走批次端點**：`/v1/transport/batch/stop-eta/CTB/{stopId}` 一次回傳該站所有路線的到站時間，請求數由最多 8 次降為 1 次；批次端點失敗時才退回逐路線查詢。**注意 v2 逐路線端點的正確順序是 `eta/CTB/{stopId}/{route}`，若寫反會回 200 但 `data` 永遠是空陣列**（這是舊版「城巴有站點卻沒有到站時間」的根因，已修正）。
- **九巴全站點清單偶爾讀取失敗**：`data.etabus.gov.hk/.../stop`（約 1 MB）少數情況下會因官方限流／WAF 而回 403，站名會退回站點編號（ETA、站序、反轉方向仍可運作）；站點清單成功後會快取 12 小時。重新整理或稍後再試通常可恢復。
- **新視窗可能被封鎖**：部分瀏覽器或「加入主畫面」的 PWA 環境會攔截 `window.open`，此時會自動退回同一視窗開啟站序頁，功能不變；站序頁的「返回」會優先回到原本的 App 分頁。
- **反轉方向的站點對應是「盡力而為」**：本車站（含月台）以站名、再用 200 公尺內座標在反向站序中找回；若另一方向不停靠附近位置，只顯示站序、不標示「本站」。九巴反轉後該站 ETA 只查單一月台（原方向仍會合併 `siblingIds` 月台）。
- **小巴反向 variant**：同一路線號碼可能有多個 `route_id`（不同班次描述），反轉時以起訖站互換＋相反 `route_seq` 評分挑選；單向行駛的 variant 會顯示「找不到另一方向」。
- **靜態索引是快照**：新開辦的路線／新站點要重跑 `npm run sync:data` 才會出現（前端 IndexedDB 6 小時後也會重新抓取）；GitHub Actions 每週日 04:00（香港時間）自動同步並提交 `public/data/` 與 `src/data/`。
- 小巴 ETA 只回傳 `route_id`，若靜態索引尚未收錄該路線，該班次會被略過（重跑 `sync:data` 即可）。
- 票價為運輸署提供的**全程收費**，非分段收費；小巴無票價。
- 只支援九巴、城巴與專線小巴，未包含龍運、新大嶼山巴士、港鐵巴士與居民巴士。

---

## 9. 後續可延伸

- 站點層級的分享連結（`/stop/:operator/:id`）；路線站序已可用 `/route/...` 直接分享。
- 收藏路線（目前只收藏站點）與到站提醒通知（Notification API）。
- 讓新視窗站序頁的 `useStopEtas` 與 `useBusData` 共用同一套背景暫停／可見性邏輯（目前各自實作）。
- 以 `IntersectionObserver` 延遲載入長站序清單。
- 小巴票價：改接運輸署「綠色專線小巴收費」資料集，補上 `getFare('GMB', route)`。
- `sync-data` workflow 已會自動提交 `public/data/`＋`src/data/` 並觸發部署；可再補上失敗通知或改以 PR 審核資料變動。

---

## 10. 修正與功能摘要

| 問題／需求 | 處理 |
| --- | --- |
| **城巴有站點但沒有到站時間** | 根因：v2 逐路線 ETA 路徑順序寫反（`eta/CTB/{route}/{stopId}`），官方回 200 但 `data` 永遠是空陣列。已改為主要使用批次端點 `batch/stop-eta/CTB/{stopId}`（一次取全站所有路線），備援路徑修正為 `eta/CTB/{stopId}/{route}`。 |
| **站序頁沒有返回方法（按 X 直接退出程式）** | 站序頁改為「返回」按鈕：優先用 `window.opener` 回到原本 App 分頁（同源自家頁面，保留原本站點展開狀態），否則 `history.back()`，最後回首頁；`openRouteSequence` 不再清除 opener。 |
| **路線站序也要能收藏站點** | 站序每一列加星號收藏按鈕（`useFavorites`，與主 App 共用 localStorage／storage 事件同步）。 |
| **附近站點排序：收藏優先、小巴最後** | `Nearby` 以「GMB 一律排最後 → 已收藏優先 → 距離」排序，收藏狀態改變即時重排。 |
| **參考 App 1933：站點內點路線要開新視窗看站序** | 新增 `RouteSequence` 頁（`/route/:operator/:route/:direction`，URL 可分享）與 `routeLinks.js`；`StopSection`／`BusCard` 點路線卡即開新視窗，新視窗顯示完整站序。 |
| **從哪個車站開啟就標示哪一站，並顯示三班即將到站** | 由 URL 帶入 `stop`／`siblings`／`name`，新視窗自動高亮「本站」、捲到清單中央並展開最近三班 ETA（`EtaSlots` 共用三格 UI、30 秒自動更新）。 |
| **其他車站也要可以點開** | 站序每一列都是按鈕，可逐一展開該站的最近三班車（一次展開一站，切站會取消舊請求與計時器）。 |
| **要有反轉序列按鈕查反方向** | 新視窗「反轉方向」以 `getRouteIndex()` 找同路線反向（KMB 沿用 serviceType、GMB 以起訖站＋routeSeq 評分），`replace` 更新 URL 並重新抓站序；再以站名／座標找回反向站點自動展開。 |
| **自動同步 workflow 只 commit 票價** | `sync-data.yml` 改為同時 `git add public/data/`（站點索引）並移除 `[skip ci]`，資料更新會觸發 Pages 重新部署。 |
| **效能：主程式一次載入所有頁面** | `App.jsx` 改為 `React.lazy` 分頁 chunk（主 chunk 約 330 kB → 272 kB raw／gzip 約 105 → 88 kB），新視窗頁獨立 chunk（約 15 kB）。 |
| **效能：重複的網絡請求** | `withCache()`／`loadStaticData()` 加入進行中請求去重（同 key 併發只 fetch 一次，失敗可重試）；城巴 ETA 改批次端點；`useBusData` 修正切到背景仍輪詢的漏洞，回前景立即更新。 |
| **AI 協作規範** | 新增 `AGENTS.md`（CodeGraph 優先探索、禁止大範圍 grep／讀檔）與 `codegraph init` 圖譜（`.codegraph/` 已列入 `.gitignore`）；刪除重複 JSDoc 並同步 README 快取 key。 |
| 展開站點後名稱變成站點編號 | 展開時傳給 `useBusData` 的 refs 只帶 `operator/id/routes`，`StopSection` 拿不到 `nameTc`。改為傳完整站點物件（Nearby / Search / Favorites 三處），並還原被臨時加上的 `name_tc` 猜測欄位。 |
| 小巴 ETA 端點錯 | `eta/route-stop/{routeId}/{stopId}` 並不存在（404）。正確用法是站點層級 `eta/stop/{stopId}`（一次拿全部路線），或 `eta/route-stop/{route_id}/{route_seq}/{stop_seq}`。 |
| 小巴索引是空的 | 舊腳本把 `route/` 的巢狀結構當成陣列、`route_id` 當路線號碼、錯誤全部吞掉，產出 `[]`。重寫為 `route/ → route/{region}/{code} → route-stop → stop` 四段流程，並統計失敗數。 |
| 小巴沒有進入 UI | `getNearbyStops` / `getStopInfo` / `getRouteIndex` / `getRouteStops` 都只認 KMB/CTB。已全部補上 GMB 分支，小巴可出現在附近站點、路線搜尋與收藏。 |
| GitHub Pages 白屏 | 建置未設定 `base`，資源全指向網站根目錄；Router 也沒有 basename。已補上 `base`、Router basename、manifest `start_url/scope`、`404.html` 與部署 workflow。 |
| 靜態 JSON 拖慢 FCP | 城巴索引（350 KB）原本打包進主 chunk。已搬到 `public/data/`，改由 IndexedDB 延遲載入，主 bundle 不再包含站點索引。 |
| 單一 ETA 失敗拖垮整頁 | `useBusData` 原本即使用 `Promise.allSettled`，本次補上站點索引的 `allSettled` 與更明確的錯誤訊息，確保部分失敗仍能顯示其他業者資料。 |

