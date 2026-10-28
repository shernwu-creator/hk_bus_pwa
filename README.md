# 香港巴士實時到站｜HK Bus ETA (PWA)

以 GPS 定位查詢香港 **九巴 (KMB)**、**城巴 (CTB)** 與 **專線小巴 (GMB)** 站點的 PWA：附近站點、路線搜尋、票價與最近三班車到站倒數，支援離線開啟（App Shell）與深色模式。

資料全部來自 [DATA.GOV.HK](https://data.gov.hk/) 的公開 API，本專案非官方產品。

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
| CTB | ETA（一次一條路線） | `.../eta/CTB/{route}/{stopId}` |
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
├─ App.jsx                   # Router（basename 跟隨 BASE_URL）+ 版面（Header／BottomNav）
├─ index.css                 # Tailwind 進入點與共用樣式（.card / .chip）
├─ pages/
│  ├─ Nearby.jsx             # 附近站點：定位 → 半徑篩選 → 展開查 ETA
│  ├─ Search.jsx             # 路線搜尋：路線 → 方向 → 站序 → ETA
│  └─ Favorites.jsx          # 已收藏站點（localStorage）
├─ components/
│  ├─ BusCard.jsx            # 路線卡片：業者、目的地、票價、三班倒數（可點擊展開全路線站序）
│  ├─ StopSection.jsx        # 可展開的站點區塊（收藏星星、站序徽章、展開路線站序）
│  ├─ RouteDetail.jsx        # 站點卡片內展開的路線全站序（標示「本站」）
│  ├─ RouteStopsPanel.jsx    # 搜尋頁的站序清單
│  ├─ SearchBar.jsx / OperatorBadge.jsx / BottomNav.jsx
│  └─ StateViews.jsx         # Skeleton / ErrorState / EmptyState
├─ hooks/
│  ├─ useLocation.js         # Geolocation + 權限/錯誤狀態 + 預設座標
│  ├─ useBusData.js          # ETA 抓取與 30 秒輪詢（Promise.allSettled，單站失敗不影響其他站）
│  ├─ useFavorites.js        # localStorage「hkb:favorites:v1」（含 routes / siblingIds）
│  └─ useTheme.js            # 深色模式「hkb:theme」＋ html.dark
├─ services/
│  ├─ api.js                 # 快取、站點、路線、票價、ETA（KMB / CTB / GMB）集中在這裡
│  └─ staticData.js          # public/data/*.json + IndexedDB 快取
├─ data/
│  └─ fares.json             # 由 sync:data 產生（請勿手改）
└─ utils/format.js           # 距離／時間／分鐘／服務類型文字

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
| 路線索引（KMB/CTB 官方 + 小巴靜態） | API + `gmb-routes.json` | 記憶體 → localStorage（`hkb:cache:route-index`，12 小時） |
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
- 小巴以 `route_id|route_seq` 對照路線號碼與方向（`route_seq` 1 = 去程、2 = 回程）。
- 每個站點的 ETA 都包在 `Promise.allSettled` 裡，單一 API timeout 只會讓那一張卡片顯示錯誤，不會讓整頁崩潰。

### 6.4 票價

`getFare(operator, route, serviceType)` 查 `fares.json`（key：`路線|service_type`），查不到回傳 `null`，UI 顯示「票價待查」。
共同營運的路線會同時提供 KMB 與 CTB 兩份資料；小巴沒有官方票價來源。

### 6.5 站點卡片內查看全路線站序

站點展開後，每一張路線卡片本身就是按鈕（卡片底部有「查看全路線站序」提示）：

1. `StopSection` 記錄被展開的路線（key：`operator-route-direction-serviceType`），同時只展開一條，再點一次即收合；收起站點時會一併重置。
2. `RouteDetail` 以該筆 ETA 的欄位呼叫 `getRouteStops()`：
   - KMB／CTB 用 `route + direction + serviceType`；
   - GMB 需要 `routeId + routeSeq`，因此 `toGmbEntry()` 會把小巴對照表的這兩個值放進 ETA entry（合併同號路線時以「有班次」的那筆為準），否則 `/route-stop/{routeId}/{routeSeq}` 無從查起。
3. 站序清單會標示「本站」；比對時同時帶入 `siblingIds`，所以九巴同一車站的其他月台也能正確標示。
4. 資料只在展開時才抓（`RouteDetail` 未展開就不會 mount），不影響首次載入。


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

- **城巴 ETA 偶爾整批空白**：`rt.data.gov.hk` 的城巴 ETA 曾回傳空 `data`（UI 顯示「暫無到站資料」），屬 API 端問題；九巴與小巴不受影響。
- **靜態索引是快照**：新開辦的路線／新站點要重跑 `npm run sync:data` 才會出現（前端 IndexedDB 6 小時後也會重新抓取）。
- 城巴站點若在索引中缺少路線清單，`getCitybusStopEtas()` 會拋出「缺少路線資料」錯誤（重新同步即可）。
- 小巴 ETA 只回傳 `route_id`，若靜態索引尚未收錄該路線，該班次會被略過（重跑 `sync:data` 即可）。
- 票價為運輸署提供的**全程收費**，非分段收費；小巴無票價。
- 只支援九巴、城巴與專線小巴，未包含龍運、新大嶼山巴士、港鐵巴士與居民巴士。

---

## 9. 後續可延伸

- 站點／路線分享連結（`/stop/:operator/:id`）。
- 收藏路線（目前只收藏站點）與到站提醒通知（Notification API）。
- 以 `IntersectionObserver` 延遲載入長站序清單。
- 小巴票價：改接運輸署「綠色專線小巴收費」資料集，補上 `getFare('GMB', route)`。
- 將 `public/data/*.json` 的同步搬進 GitHub Actions（定期更新站點索引，不必手動 commit 大檔）。

---

## 10. 本次修正摘要

| 問題 | 處理 |
| --- | --- |
| 展開站點後名稱變成站點編號 | 展開時傳給 `useBusData` 的 refs 只帶 `operator/id/routes`，`StopSection` 拿不到 `nameTc`。改為傳完整站點物件（Nearby / Search / Favorites 三處），並還原被臨時加上的 `name_tc` 猜測欄位。 |
| 小巴 ETA 端點錯 | `eta/route-stop/{routeId}/{stopId}` 並不存在（404）。正確用法是站點層級 `eta/stop/{stopId}`（一次拿全部路線），或 `eta/route-stop/{route_id}/{route_seq}/{stop_seq}`。 |
| 小巴索引是空的 | 舊腳本把 `route/` 的巢狀結構當成陣列、`route_id` 當路線號碼、錯誤全部吞掉，產出 `[]`。重寫為 `route/ → route/{region}/{code} → route-stop → stop` 四段流程，並統計失敗數。 |
| 小巴沒有進入 UI | `getNearbyStops` / `getStopInfo` / `getRouteIndex` / `getRouteStops` 都只認 KMB/CTB。已全部補上 GMB 分支，小巴可出現在附近站點、路線搜尋與收藏。 |
| GitHub Pages 白屏 | 建置未設定 `base`，資源全指向網站根目錄；Router 也沒有 basename。已補上 `base`、Router basename、manifest `start_url/scope`、`404.html` 與部署 workflow。 |
| 靜態 JSON 拖慢 FCP | 城巴索引（350 KB）原本打包進主 chunk。已搬到 `public/data/`，改由 IndexedDB 延遲載入，主 bundle 不再包含站點索引。 |
| 單一 ETA 失敗拖垮整頁 | `useBusData` 原本即使用 `Promise.allSettled`，本次補上站點索引的 `allSettled` 與更明確的錯誤訊息，確保部分失敗仍能顯示其他業者資料。 |
| 站點內的路線卡片不能點開 | 卡片原本是純顯示。改為可點擊的按鈕（`BusCard` 的 `expandable` / `expanded`），展開時由新的 `RouteDetail` 呼叫 `getRouteStops()` 顯示全線站序並標示「本站」；小巴同時補上 `routeId` / `routeSeq` 才查得到站序。 |

